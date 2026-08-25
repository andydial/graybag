# PostHog — the decision, before anything is wired

Andy asked for two answers before events are built: **where the data lives**, and **whether the
React Native SDK drags in native code**. Both below, with the event schema after them.

**Nothing is wired yet.** The guard (`analytics/redact.ts` and its test) exists, because it is a
precondition of any answer and does not depend on which one is chosen.

---

## 1. Where the data lives — **PostHog Cloud EU**, not self-hosted

### The recommendation

**PostHog Cloud EU (Frankfurt).** There is no India region; the choice is US, EU, or run it
ourselves.

### The DPDP position, stated properly

**Transfer is lawful.** The DPDP Act 2023 takes a *blacklist* approach at **s.16**: personal data
may be transferred outside India **except** to countries the Central Government notifies as
restricted. **No restricted list has been notified.** So an EU transfer is permitted today, and
Germany is a GDPR jurisdiction — if the list ever appears, the EU is the least likely entry on it.
Choosing EU over US is deliberate for that reason.

**The clause that actually matters is s.9, not s.16.** Children's data attracts verifiable
parental consent, and **s.9(3) prohibits tracking and behavioural monitoring of children** and
targeted advertising directed at them. That is not a transfer question at all — it is a question
about *what we send*, and it is why the constraints in this document are absolute rather than
tidy-minded:

> The Data Principal here is the **parent**, an adult, and the funnel measures **their** journey
> — installed, signed in, added a child, browsed, ordered. The moment an event carries a child's
> name, class, section, allergy, or which dishes *that child* eats, parent-analytics becomes
> **behavioural monitoring of a child**, and no amount of consent makes s.9(3) go away.

So the residency answer and the payload answer are linked: **Cloud EU is defensible precisely
because the payload contains no child data and no direct identifiers.** A parent's `user_id` and
a funnel step, and nothing else.

### Why not self-hosted, honestly

Self-hosting in India is the belt-and-braces answer and I am not pretending otherwise. It would
remove the transfer question entirely and would be **required** if the payload ever needed to
carry child-linked data.

It costs a ClickHouse deployment, its backups, its upgrades and its on-call — against a product
currently doing tens of orders a week with two people. That is a poor trade **for this payload**.

**It stops being a poor trade the moment the payload changes.** If anyone ever wants an event
property describing a child, the correct response is not "self-host so we can" — it is *no*.
Self-hosting is the fallback if the law changes (a restricted-country notification), not a
licence to send more.

**Recorded as a decision so it is revisited deliberately:** Cloud EU, on condition of the payload
constraints below. If those constraints are ever relaxed, the hosting decision reopens first.

---

## 2. The React Native SDK needs a native build — so we should not use it

### The finding

`posthog-react-native` requires **either** the Expo set — `expo-file-system`,
`expo-application`, `expo-device`, `expo-localization` — **or** `@react-native-async-storage/
async-storage` plus `react-native-device-info`.

**We have none of them.** Every one is a native module, so adding the SDK means a new binary, a
new App Store review, and a build gate on something that should ship in seconds.

### The recommendation: a JS-only client against PostHog's HTTP API

PostHog's capture endpoint is a plain `POST` of JSON. A small `fetch`-based client:

- **ships over the air** — no native code, no build, no review;
- sends **only** what we explicitly pass, which is what the constraints demand anyway;
- is ours to test, which the guard below depends on.

**The features we would lose are the features Andy is switching off.** Autocapture: off by
requirement. Session replay: off by requirement — it would photograph a child's name on the
menu screen. Automatic device/OS properties: not wanted, they add fingerprinting surface for
nothing. What genuinely remains is offline queueing and retry, which is perhaps forty lines.

So the SDK is not a compromise we are declining; it is a worse fit than the alternative. **This
is not a build-gated item.**

---

## 3. The event list and property schema

Seven events, one per funnel step Andy named. **Every event and every property is declared here.
Autocapture is off; nothing is sent that is not on this list.**

| Event | When | Properties beyond the common set |
|---|---|---|
| `app_opened` | Cold start, once per launch | `is_first_open` (bool) |
| `signin_started` | The sign-in screen is reached | `method` (`google` \| `apple` \| `email_otp`) |
| `signin_completed` | A session exists | `method` |
| `child_added` | `POST /recipients` returns 201 | *(none — see below)* |
| `menu_browsed` | A school's menu renders with items | `item_count` (int, bucketed) |
| `cart_started` | First line added to an empty cart | `line_count` (int) |
| `payment_started` | The Razorpay sheet opens | `attempt_no` (int), `resumed` (bool) |
| `payment_completed` | `checkout-status` returns `paid` | `attempt_no` (int) |
| `payment_abandoned` | Sheet dismissed, or checkout expired | `reason` (`dismissed` \| `expired` \| `failed`) |

### The common set, on every event

| Property | Example | Why it is safe |
|---|---|---|
| `distinct_id` | the parent's `app_user.id` | An opaque uuid. **Never an email** — Andy can join to the database when he needs a person |
| `app_version` | `4.0.0` | Which build |
| `platform` | `ios` \| `android` | |
| `app_env` | `production` \| `staging` | So staging noise never pollutes a funnel |

### `child_added` carries nothing about the child, deliberately

It is the one event whose name invites a property — a class, a school, an age band, "how many
children now". **All of them are the child's attributes**, and the funnel question is only
*whether the step happened*. The count of children a parent has is the closest to defensible and
is still a fact about a household's children, so it is out too.

### Not sent, ever

- **Any child field**: name, class, section, allergies, allergy note, date of birth, recipient id.
- **Which dishes a specific child eats.** Dish popularity is a menu question and belongs in our
  own database, where the child is not the subject of an analytics profile.
- **Email addresses**, parent or otherwise. Phone numbers. Postcodes.
- **Money amounts tied to an identifiable order.** `payment_completed` carries no total; revenue
  lives in the ledger, which is authoritative and does not leave the country.
- **Free text of any kind.** Notes are where a child's name ends up when somebody is in a hurry.

### Volume at 5,000 orders a day

Nine events, of which a parent triggers perhaps six on an ordering day. At 5,000 orders/day
that is ~30k events/day — around 1M/month, comfortably inside PostHog's paid tiers and not worth
sampling. **`menu_browsed` is the one that could run away** if it fired per scroll or per school
switch; it is specified as *once per rendered menu*, and if that proves noisy the sampling goes
there first. Nothing else is high-cardinality: no per-dish events, no per-tap events.

Deliberately **no** sampling on the payment events. They are the funnel's bottom and the reason
this exists; sampling them to save money would be paying for analytics and then blinding the one
part that matters.

---

## 4. What this must never become

This section exists because the failure mode is not malice — it is a convenient property added in
six months by someone solving a real problem.

- **Autocapture stays off.** It sends every tap and screen, including screens with a child's name
  on them, and it is one config flag away at all times.
- **Session replay stays off.** It is a video of the app. The menu screen has a child's name on it.
- **`identify()` takes the parent's user id and nothing else.** Person profiles accumulate: a
  property set once is attached to every future event.
- **No new event property ships without adding it to the table above**, and
  `analytics/redact.test.ts` fails if a denied field can reach an event, a property, or a person
  profile.

If a question genuinely needs a child's attribute to answer, the answer is our own database, not
this. We hold that data lawfully for meal service; we do not hold it to build behavioural profiles
of children, and s.9(3) is not a formality.
