# PostHog — the decision, before anything is wired

Andy asked for two answers before events are built: **where the data lives**, and **whether the
React Native SDK drags in native code**. Both below, with the event schema after them.

> **Status: approved and built.** Andy approved the recommendation on 2026-08-25 — JS-only fetch
> client, Cloud EU, one project shared with the web thread. §5 records what was built. The
> analysis below is preserved as the reasoning, because the *conditions* it sets are what keep the
> hosting choice defensible.

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
| `payment_completed` | `checkout-status` returns `paid` | *(none — the settlement response does not carry the attempt, and a hardcoded `1` would be a lie for a resumed payment; ask `payment_started`)* |
| `payment_abandoned` | Sheet dismissed, or checkout expired | `reason` (`dismissed` \| `expired` \| `failed`) |

### `E15-21` — the path, not just the milestones

Andy, 2026-08-26: *"so I can read a parent's whole path in sequence, not just the funnel
milestones … enough that I can see someone reach checkout and turn back."*

| Event | When | Properties beyond the common set |
|---|---|---|
| `screen_viewed` | Every screen, on focus | `screen` — a **closed vocabulary**, see below |
| `add_to_cart_tapped` | Add control pressed | `line_count` (resulting) |
| `remove_from_cart_tapped` | Remove pressed | `line_count` (resulting) |
| `break_time_selected` | A break window chosen | *(none)* |
| `place_order_tapped` | Place order pressed | `line_count` |
| `payment_sheet_closed` | The Razorpay sheet closes, however it closes | `outcome` (`completed` \| `dismissed` \| `failed`) |
| `add_child_submitted` | Add-child form submitted | *(none)* |
| `pack_offer_opened` | A meal pack offer opened | *(none)* |
| `pack_purchase_started` | Buy pressed on an offer | *(none)* |
| `pack_plan_confirmed` | A multi-day pack plan confirmed | *(none)* |

**Turning back is `payment_sheet_closed` with `outcome: dismissed`**, followed by whatever
`screen_viewed` comes next. That pair is the shape Andy asked to be able to see, and neither
half is visible from the funnel milestones alone.

#### Property VALUES are now checked, not just keys

`screen` is the first string property in the schema, and a screen name is exactly where a
child's name would reach a vendor — `screen: "Aarav's orders"` passes a key check perfectly. So
enumerated properties are validated against a closed vocabulary and anything else is refused:

- `screen`: `home`, `menu`, `school_picker`, `dish_detail`, `cart`, `orders`, `order_detail`,
  `account`, `children`, `add_child`, `sign_in`, `sign_in_code`, `support`, `policy`,
  `policy_gate`, `delete_account`, `payment_waiting`, `order_placed`, `update_required`,
  `cant_connect`, `packs`, `my_packs`
- `method`: `google`, `apple`, `email_otp`
- `reason`: `dismissed`, `expired`, `failed`
- `outcome`: `completed`, `dismissed`, `failed`

This also catches the subtler version — a screen name built by interpolation rather than chosen
from the list.

#### Where `screen_viewed` is emitted from — two places, not one

Fourteen screens are navigator routes, and one `onStateChange` listener in `RootNavigator`
reports all of them. **Five are not routes at all** — `payment_waiting` and `order_placed` are
states of the checkout flow, `update_required` and `cant_connect` are gates rendered above the
whole app, and `school_picker` replaces the menu's body until a school is chosen — plus
`sign_in_code`, which is a state of the sign-in screen. Those six emit themselves, through
`useScreenView`.

**`onStateChange` alone is not enough, and this cost a real bug.** It fires on navigation
*changes* and never on arrival, so the screen a parent lands on — Home, on every app open — was
the one screen absent from their path. `onReady` is the only place the initial route is
observable, and both handlers now go through one `emitScreen`. The emitter read as correct; it
was correct about every screen except the first, and only writing the test found it.

`screens.test.ts` asserts both directions: every name in the vocabulary is reachable from some
emitter, and every route the navigator can reach has a name. A declared-but-unemitted screen
would read on the dashboard as *a screen no parent ever visited*, which is worse than a missing
row because it looks like data.

#### Reading a zero: `cant_connect` will almost never arrive

`App.tsx` renders that screen when the environment is incomplete — and that is the same
condition that makes `readExpoClientEnv()` throw, which puts the analytics client on its no-op
fallback. **The screen meaning "this build is misconfigured" is reported by a client the same
misconfiguration switched off.** It is emitted anyway, because it costs nothing and becomes
correct if the environment check ever becomes partial rather than all-or-nothing.

Written down because an absent event and an impossible event look identical on a dashboard.
Zero `cant_connect` rows is not evidence that nobody hit it.

#### The pack events carry no money at all

`pack_offer_opened`, `pack_purchase_started` and `pack_plan_confirmed` carry the common set and
nothing else — no amount, no meals count, no offer id, no child, no dish.

`pack_plan_confirmed` is the one worth explaining. *How many days does a parent plan at once* is a
genuinely useful product number, and it is exactly the one to refuse: a plan is a set of children
and dates, so that count sits one join away from **which child eats on which days**, which is the
food profile `s.9(3)` forbids building. What remains knowable is the funnel — reached the offers,
opened one, started a purchase, confirmed a plan — and every amount is in the ledger, which does
not leave the country.

#### What the cart events deliberately do NOT carry

`add_to_cart_tapped` is the event that would most naturally carry a dish, and *"which dish did
they add"* is the obvious product question. It carries a **count**. `dish_name` and `dish_id`
are in `FORBIDDEN_KEYS`, and the reason is that a cart belongs to a **child** — the parent is
only the account holder. Dish-by-dish popularity is answerable from our own database, where the
child is not the subject of an analytics profile.

`break_time_selected` carries neither the break nor the school, for the same reason: *whether* a
choice was made is the stall signal; *which* one is a detail about a child's day.

#### Session replay remains OFF

Andy, again, and it is worth repeating next to a change that adds screen tracking: replay
records the screen, which on this app means **children's names and allergy notes as video**.
`screen_viewed` sends a name from a fixed list of twenty strings. Those are not the same thing
and the second is not a step towards the first.

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

---

## 5. Wiring, as built (2026-08-25)

Approved by Andy: **JS-only fetch client, PostHog Cloud EU, one project shared with the web
thread.** The web thread reached the same conclusion independently — the native SDK cost them
88 KB gzipped and blew their performance budget, so they post directly too.

`packages/shared/src/analytics/`:

| File | What |
|---|---|
| `events.ts` | The allowlist — nine events, their exact properties, and the forbidden keys |
| `client.ts` | `POST {host}/batch/`, a bounded offline buffer, and nothing else |

**The key.** `PUBLIC_POSTHOG_KEY` is Andy's to set — it is a write-only project key, not a
secret, and the same value serves both apps because it is one project. Until it is set,
`createAnalytics` returns a **no-op**: a build with no key sends nothing at all. That is
deliberate for staging and local builds, where a developer's tap-through would look like data.

**Analytics never blocks a parent.** Every failure path — network error, non-200, blocked host,
an ad-blocker on the school wifi — ends as a dropped event. `capture` returns `void`, is not
awaited at any call site, and never throws. There is no retry storm.

**The buffer is bounded at 50.** Unbounded is the obvious version and the wrong one: a parent on
a bad connection all day would accumulate events until the app was killed, and the oldest funnel
step is the least interesting to keep.

32 tests across the two files.

### Still to do

Emitters at the nine call sites, which is `E15-20`'s remaining half. The contract, the client and
the guard are in place, so each is one `analytics.capture(...)` line at the point the step
happens — and the allowlist refuses anything that drifts from the table in §3.

---

## 6. The key, and how to turn this on

**Blocked on the key.** `~/.graybag-secrets/prod.env` holds eleven variables and none of them is
a PostHog key — no `POSTHOG_KEY`, and nothing matching `*posthog*` under any name. So the
emitters are built, tested and shipped, and they are **sending nothing**.

That is the designed state rather than a broken one: with no key `createAnalytics` returns a
no-op that makes no network call, which is what keeps staging and local builds out of the funnel.

### Turning it on takes two steps, not one

`EXPO_PUBLIC_*` variables are **inlined by Metro at bundle time**, not read at runtime. Setting
the key in EAS does nothing on its own — the JS already on phones has no key baked into it.

```sh
# 1. put the key in the EAS production environment (Andy, once)
npx eas env:create --scope project --environment production \
  --name EXPO_PUBLIC_POSTHOG_KEY --value "phc_…" --type string --visibility plaintext

# 2. republish, so the key is inlined into the bundle
npm run ship:ota -- "enable PostHog"
```

Then confirm arrival — the check that actually proves it, rather than assuming:

```sh
curl -s -H "Authorization: Bearer <personal-api-key>" \
  "https://eu.posthog.com/api/projects/<id>/events/?limit=5" | jq '.results[].event'
```

### Sharing with the web thread

**One project, one key.** `PUBLIC_POSTHOG_KEY` for them, `EXPO_PUBLIC_POSTHOG_KEY` for the app —
different names because each framework has its own prefix for "safe to ship to the client", same
value. It is a *write-only project* key: it can send events and cannot read them, which is why
it belongs in a bundle at all.

`app_env` is on every event from both apps, so one project can still separate production from
staging without separate keys.
