# GrayBag — UX specification

The whole product, written down: every screen, every state, every path between them.

**Status:** draft 1, for Andy's review. Sections marked **[NEEDS ANDY]** are decisions I have
made a recommendation on but must not settle myself.

**How to read this.** §2 is the set of rules that constrain every screen; if a screen here
contradicts §2, §2 wins and the screen is wrong. §5 is the screen catalogue. §6 is the flow
map, including the awkward paths. §7 maps every server error code to a specific UI response.

**Where the flows come from.** Not invented. Derived from `docs/order-lifecycle.md`
(states, cutoff, failure paths, error codes), `docs/authorization-model.md`, and the
migrations. Where this spec describes a behaviour, it cites the source so a reviewer can
check it rather than trust it.

---

## 1. Why this document exists

E13 delivered design tokens, a motion system and an accessibility audit, and we both treated
that as "design done". It wasn't. Tokens are a vocabulary, not a product. The result was an
app of centred system-font text with dead ends in it, built screen by screen with no map.

This spec is the map. It is written before any React Native, and a clickable HTML prototype
is built from it before any React Native, because a wrong screen costs minutes here and days
once it is a component tree.

---

## 2. Rules that constrain every screen

These are settled. They are not re-litigated per screen.

| # | Rule | Source | Consequence for UI |
|---|---|---|---|
| R1 | **Browsing never requires a session. The only gate is checkout.** | `AR7`, `docs/mvp-scope.md` | Splash → school picker → menu → dish → cart all work signed out. Sign-in appears once, at "Place order". No screen may show a sign-in wall before that. |
| R2 | **Adding a child is not a wall in front of the menu.** | `AR7` | Add Child is reachable from checkout and from Profile, never as a forced step after sign-in. |
| R3 | **No passwords, and in v1 no OAuth either — email OTP only.** No phone OTP. | non-negotiable #7 | Reference screen `03.png` — email + password + "Forgot Password?" — **is not built.** Google and Apple sign-in need client ids that **do not exist**, so until they do, offering the buttons is offering a dead end. This rule was previously written as "Google, Apple, email OTP", which is what led Andy to believe he was blocked on OAuth when the screen was working. **First sign-in IS registration (`AR4`)** — the screen must say so, or it reads as broken to a new user. See §4.1. |
| R4 | **Menu prices are GST-exclusive.** 5% added at checkout as CGST 2.5% + SGST 2.5%. | `docs/mvp-scope.md`, confirmed 2026-08-07 | Dish cards and dish detail show the ex-GST price. The tax lines appear once, in the cart/checkout total block. A dish card price and the cart line price are the same number. |
| R5 | **All money is integer paise.** | non-negotiable #3 | Display formats at the edge only. Never a float in state. |
| R6 | **Children's data is regulated.** Names, class, section, allergies are tier P/S. | DPDP, non-negotiable #4 | Never in logs, Sentry, analytics, or any error string. Failure messages carry an index, never a name. Screenshots for the store must not contain a real child. |
| R7 | **The cutoff is server-authoritative.** The app's calendar is UX only (E1). | `order-lifecycle.md` §9.2 | Cutoffs are written in full — **weekday, date and time** ("Ordering closes on Monday 11 Aug, 11:59 PM"), never a bare "00:00", which is ambiguous about which midnight and reads a whole day wrong (`C5`). Resolved in the school's timezone always; **the zone is displayed only when it differs from the device's** (`C4`), so the common case stays short and the parent abroad still gets it right. A cart valid at 22:00 can be rejected at 22:05 (C8) — the cart must handle rejection, never assume it cannot happen. |
| R8 | **"Payment succeeded" in the Razorpay sheet is not a confirmed order.** | §8.4, §13 `payment_pending` | The confirmation screen is unreachable until settlement is confirmed server-side. The intermediate state is a waiting state. |
| R9 | **Skeletons, never spinners.** | `S5`, `docs/motion-system.md` | Every loading state in §5 is a skeleton of the content that is coming. |
| R10 | **Read-only offline.** Cached menu, stale banner, writes refused with an honest message. | Performance priorities | Every write control has a defined offline behaviour in §5. |
| R11 | **Mohali only. Flat 5% GST.** | non-negotiable #7 | No state picker, no place-of-supply UI, no IGST line. |
| R12 | **The cart survives the process dying.** | §5.7, gap 2 | The cart is persisted to disk on every mutation and restored at launch. Mid-range Androids kill backgrounded apps aggressively, and F1's reasoning — a lost cart is a lost first order — applies at least as strongly to an OS kill as to a sign-in hop. |
| R13 | **Nothing in the auth path is lost to backgrounding.** | §5.9, gap 1 | Email OTP *requires* leaving the app. Entered digits, the resend timer and the pending address survive background/foreground and process death. |
| R14 | **Layout survives large text.** | gap 4 | Every screen is specified at the OS's largest accessibility text size, not just at default. The two-column grid is not a fixed choice — see §3.5. |

---

## 3. Brand

Taken from `Legacy-Application/Graybag_Design Package`. This is the source of truth for brand;
the nine reference PNGs are the source of truth for *feel*, not for information architecture.

### 3.1 Colour

| Role | Hex | Use |
|---|---|---|
| Primary green | `#00af52` | Primary actions, active tab, price text, brand marks |
| Deep green | `#145f48` | Secondary/dark buttons, the delivery card's lower band, headers on pattern |
| Amber | `#ffbb39` | Warnings that are not errors: cutoff approaching, order needs attention |
| Lime | `#b3cf3f` | Accent, veg indicator, subtle highlights |
| Pale lime | `#e5ea98` | Tinted backgrounds, selected chips |

Greys and semantic error/success tones come from the existing `docs/design-tokens.md` set and
are not re-specified here. **Contrast:** `#00af52` on white is 2.9:1 — it is a *graphic* and
*large-text* colour, not a body-text colour. Body text stays near-black. White on `#00af52`
is 3.4:1, which passes for large text and UI components but not for body copy on a green
fill; the "Delivery to school" card therefore uses large/semibold text only.

### 3.2 Type

**Nunito.** Settled 2026-08-10 (`S35`) — not a fallback, the typeface.

VAG Rounded Next is the brand face in the design package and we hold no evidence of a licence
permitting it in a shipped binary. Rather than carry that through the build with every screen
provisional, Nunito is the family outright: SIL Open Font Licence, free to embed in an app and
on the web, and the rounded geometry the brand is actually reaching for.

Three weights — Regular 400, Medium 500, SemiBold 600 — from the brand guideline's own
hierarchy (`docs/design-tokens.md` §3.1). Every extra weight is bundle size on the connection
that is the real constraint.

`font.fallback` has been **deleted** from the token, not repointed. A `family`/`fallback` pair
invites somebody to restore the brand face later without checking the licence again, and a
settled question that still looks unsettled gets reopened.

### 3.3 Pattern

`05_Pattern/` supplies the vegetable pattern in six colourways. Used at low contrast on green
fills: splash, welcome, the delivery card, empty states, and the confirmation screen. It is the
cheapest single thing that makes a screen unmistakably GrayBag. It never sits behind body text.

### 3.4 Logo

`01_Graybag_Logo/`. Transparent mark + wordmark in the header, mark alone as the tab-bar home
icon and as the empty-state device.

### 3.5 Dynamic type — the grid is not a fixed choice

The E13 audit checked contrast and tap targets. It did not check **overflow**, and the
two-column grid is where that bites: a dish name is capped at two lines beside a 16:10 photo,
and "Chole Masala with Kulcha" at the largest accessibility size does not fit in half a 390 pt
screen at any line count worth reading.

The rule, applied on every screen and not only the menu:

| Text size | Menu / promoted rails | Everything else |
|---|---|---|
| Default → `xxLarge` | Two-column grid, name capped at 2 lines | As specified in §5 |
| `AX1` and above (`fontScale ≥ 1.35`) | **Single column.** Photo becomes a 96 pt leading thumbnail, the name gets as many lines as it needs, price below | Horizontal rails become vertical lists; chip rows wrap instead of scrolling; **the tab bar keeps its labels and grows** — stacking icon over label. Removing text because the user asked for larger text is the opposite of what they asked for |

Three things are absolute regardless of size: **no truncated price**, **no truncated allergen
warning**, and **no clipped primary action**. If something must give, it is the photograph.

Every state in §5 must be reviewed at `AX5`, and the Maestro suite runs the §6.1 flow once at
default and once at the largest size — an overflow that only appears at `AX3` is exactly the
class of defect a screenshot review never catches.

---

## 4. Where I deviate from the reference screens, and why

The nine PNGs are a good visual language sitting on a **generic food-delivery template**. Several
of its assumptions are wrong for GrayBag. Building them faithfully would produce a pretty app
that cannot take an order.

| Ref | What it shows | Why it is wrong here | What we build instead |
|---|---|---|---|
| `03` | Email + password, "Forgot Password?" | R3 — we have no passwords | Google / Apple / email-OTP only. No password field exists anywhere in the product. |
| `05` | "Delivery to School … **2.5 km**" | We do not deliver to a pin. We deliver to a **child**, at a **school**, at a **break time**, on a **date**. Distance is meaningless. | The card becomes **"Delivering to"**: child's name, school, break time, and the next orderable date. It is the single most important control on the home screen. |
| `08` | A **Location** screen with a map, address lines, "Save as Home / Other" | There is no address model in v1 and no home delivery. This screen would be a dead end. | **Not built.** Replaced by *Choose school* (pre-auth, for browsing) and *Add child* (which binds a child to a school). |
| `05` | "Discount 25%" | No promotions, coupons or discounts in v1 | The promoted slot becomes **"This week at \<school\>"** — a real dish, no fake discount. |
| `07` | "Add a Extra Topping?", favourite heart | No item modifiers and no favourites in v1 | Dish detail carries **allergens, veg/non-veg, description, quantity, and which child/date it is for**. Far more useful. |
| `06`,`07`,`09` | Chicken Meatballs, Blueberry Pancakes, Veggie Pizza | Not our menu, and no veg/non-veg mark — which in an Indian school context is the first thing a parent looks for | Real catalogue: Veg Sandwich, Paneer Wrap, Rajma Chawal, Idli Sambar… every card carries the **veg/non-veg mark**. |
| `09` | Cart: items and quantities only | Missing everything that makes it a GrayBag order: which child, which date, the break, the cutoff, and the GST split | Cart carries child + date + break + cutoff countdown + subtotal + CGST 2.5% + SGST 2.5% + total. |
| all | No allergen surface anywhere | Allergens are a **safety** feature and a consented data category (`C12`, `C5`) | Allergen warnings on dish cards, dish detail and in the cart, driven by the selected child's declared allergens. |

**What I keep, deliberately:** the green/pattern splash, the rounded pill buttons, the search
field, the category tab strip, the two-column dish grid, the four-item tab bar, and the overall
generosity of spacing. That is the GrayBag feel and it is good.

---

## 5. Screen catalogue

For each screen: **purpose**, **elements top to bottom**, **every state**.

States are enumerated, not assumed. Where a state cannot occur, that is stated explicitly so a
reviewer can challenge it.

### 5.1 Splash

- **Purpose.** Cover the moment where fonts, the cached menu and the session are read.
- **Elements.** Full-bleed primary green, vegetable pattern at low contrast, centred mark +
  wordmark in white. Ref `01`.
- **States.**
  - *Default* — held for a minimum of 600 ms so it reads as intent, not as a flash.
  - *Slow start* (> 2.5 s) — a single line under the mark: "Getting things ready…". No spinner (R9).
  - *Unconfigured* — the client env is missing (`configureApiFromEnvironment()` returned false).
    Today this is silent and the app opens into screens that all fail oddly. **It must instead
    reach a Can't-connect screen** (5.20). This is a real defect found while writing this spec.
  - *Update required* — reserved for the policy-version gate (5.19) and forced-update; routes
    straight there.

### 5.2 Welcome

- **Purpose.** Say what GrayBag is, and get out of the way. Shown **only** on first launch.
- **Elements.** Ref `02`: pattern on green, mark, "education meets convenience", the
  sub-line, then **"Browse the menu"** (deep green, primary) and **"Sign in"** (white, secondary).
- **Deviation.** The reference's primary action is "Get Started", which implies signup. Ours is
  **"Browse the menu"** — R1. Signing in is the secondary path, for a returning parent on a new
  device.
- **States.** *Default*; *returning user* — skipped entirely.

### 5.3 Choose school (pre-auth)

- **Purpose.** A menu read needs a school id, and a signed-out user has no child to supply one
  (`0011_public_school_list.sql`). This screen is what makes browsing possible at all.
- **Elements.** Back, title "Which school?", search field, results list (school name, city),
  footer note: "You can change this any time."
- **Data.** The anon-executable public school list — id, name, city only. Onboarded, active,
  not-offboarded schools only (`P1`).
- **States.** *Loading* (skeleton rows) · *Loaded* · *Empty search* ("No school matches
  '\<q\>'" + "Ask us to add your school" → support) · *Empty list* (nothing onboarded — should
  be impossible in prod; shows the generic empty state and logs) · *Error* (retry) · *Offline*
  (last list from cache + stale line; if no cache, Can't-connect).
- **Note.** For a signed-in parent with children, this screen is **skipped** — the school comes
  from the selected child. It remains reachable from the home card as "Browsing another school".

### 5.4 Home

- **Purpose.** Answer "what am I ordering, for whom, for when" and get to the menu fast.
- **Elements.** Ref `05`, re-pointed:
  1. Header: logo + wordmark left; bell right (v1: **no push**, so the bell shows in-app order
     updates only — see [NEEDS ANDY] below).
  2. Search field (taps through to Menu with the query carried).
  3. **Delivering to** card — green, pattern, deep-green lower band. Child name + school on the
     green; break time + next orderable date on the band; chevron opens the child/date switcher.
     Signed-out, it reads "Browsing \<school\>" + "Choose a school" and the band offers "Add your
     child to order".
  4. **This week at \<school\>** — one promoted dish, real, no fake discount.
  5. **Popular this week** — horizontal dish cards.
  6. Tab bar: Home · Menu · Cart · Account.
- **States.** *Signed out* · *Signed in, no child* (the card's job becomes "Add your child") ·
  *Signed in, one child* · *Signed in, several children* (card shows the selected child; chevron
  switches) · *Loading* (skeletons for card and both rails) · *Menu unpublished for this school*
  (rails collapse; card stays; honest line — see §6, F4) · *Offline* (stale line, cached content,
  write controls disabled) · *Error*.

> **DECIDED 2026-08-10 (Andy): no bell in v1.** The header's right slot is a **cart badge** —
> item count, tappable, hidden when the cart is empty. With no push in v1 a notification centre
> would have had nothing to show that the Orders tab does not already carry, and it would have
> been one more surface to build, test and empty-state.

### 5.5 Menu

- **Purpose.** Browse and search a school's published menu.
- **Elements.** Ref `06`: header; eyebrow "Our food" + title "Made specially for your child";
  search; category tab strip (All + categories from `public_menu.category_label`, ordered by
  `sort_order`); two-column dish grid.
- **Dish card.** Photo (16:10, rounded 16), veg/non-veg mark top-left on the photo, name (2 lines
  max), price ex-GST in green, and an **allergen flag** when the dish contains a declared allergen
  of the selected child. Tapping adds nothing — it opens the dish (a mis-tap must never add food).
  The same rule binds the promoted dish on Home: its button reads **"See dish"** and opens the
  sheet. A control labelled "Order" that does not order is a worse lie than a missing button.
- **States.** *Loading* (six skeleton cards, not a spinner) · *Loaded* · *Empty — menu
  unpublished* ("Nothing on the menu yet") · *Empty — search* (with "Clear search") · *Empty —
  category* · *Error* (retry) · *Offline/stale* (cached grid + "Offline — showing the menu you
  last loaded", which is the correct, honest behaviour and already implemented) · *Partial*
  (menu loaded, allergens failed → cards render, allergen flags suppressed, and a quiet line
  says warnings are unavailable; **never** silently render "no allergens").

### 5.6 Dish detail

- **Purpose.** Everything a parent needs to decide, then add to cart.
- **Elements.** Bottom sheet over the menu (ref `07`): grabber, photo, name + category, veg mark,
  description, ingredients when present, **allergen block**, the **For** block, the **kitchen
  note** field (5.6.1), and a sticky **"Add to cart · ₹X"** showing the ex-GST line total.
- **The For block is not optional furniture.** It carries the child, class, school, break time
  and service date, and it appears here as well as in the cart because **a parent must never be
  one tap from paying without seeing whose lunch this is and when it is handed over**. Signed
  out it says so plainly — "No child chosen yet · you'll choose when you place the order" —
  rather than showing a name that does not exist.
- **Allergen block — four renderings, and the difference between them is the safety property.**

  | Case | Rendering |
  |---|---|
  | Clashes with the **selected child's** declared allergens | Amber, names the child and the allergen, and the add takes a **second deliberate tap** (below) |
  | **We cannot check** — no child selected, or allergen consent not given | Neutral, explicit: "We can't check this against your child." Followed by the kitchen's own declaration if there is one. **Never** silence, and never reassurance |
  | Kitchen declared **no allergens** (`allergens_declared_none`) | Plain reassurance line |
  | Kitchen declared **nothing either way** | "Allergen information not provided." **Not** the same as "no allergens" and never rendered as if it were |

  **The signed-out case is a safety defect if got wrong**, and it was: the prototype rendered a
  warning naming a child while signed out, where no child and no allergen data exist. A warning
  is a claim about data we hold; manufacturing one from data we do not hold is the same class of
  failure as swallowing a failed allergen fetch into an empty list (§5.21). **Audit every
  allergen surface — dish card flag, dish detail, cart line — against a null child.**

- **The second confirm is a screen, not a word.** When a dish clashes, the button stays neutral —
  **"Add to cart · ₹95"** — and confirming happens in its own surface naming the child and the
  allergen: *"Mix Veg Poha contains Peanuts. Aarav is allergic to Peanuts. Add it anyway?"* →
  *"Yes, add it for Aarav"* / *"Don't add it"*.

  Two reasons it is not a button label. A label reading "Add anyway" is **one** tap doing a
  confirmation's job, and §5.6 requires two for a decision about a child's allergy. And
  "anyway" is a reprimand — a parent may have entirely good reasons (a mild intolerance, a dish
  the kitchen prepares differently for them). The product's job is to make sure they know, not
  to disapprove.

- **States.** *Loading* · *Loaded* · *No photo* (pattern-filled brand tile, never a grey box) ·
  *Signed-out* (adding works — R1; no allergen warning can exist) · *No child selected* (adding
  works; allergen warnings unavailable and said so) · *Allergen clash, unconfirmed* · *Allergen
  clash, confirmed* · *Unavailable* (dish dropped from the menu while open → block the add,
  explain, offer back to menu) · *Cutoff passed* (add disabled, offers the next open date) ·
  *Note contains allergy language* (5.6.1) · *Offline* (add to cart works — the cart is local;
  the sheet says the price will be reconfirmed).

#### 5.6.1 The kitchen note, and why it is dangerous

The legacy app had `Dish_In_Order.special-comments` and **127 rows used it, 15 of them with
dietary language** (`docs/bubble-recon-findings.md`). Parents will type "less spicy". They will
also type "allergic to egg" — and free-text allergy information that nobody has committed to
reading is **worse than no field at all**, because the parent believes they have told us. Recon
reclassified those rows as regulated data about children.

So the field exists, and it is designed rather than inherited:

- **Per line, not per order.** "Less spicy" on one wrap and not the other is two lines.
- **A stated contract, next to the input:** *"Requests only — the kitchen reads these. **Do not
  put allergies here.** Allergies go on your child's profile so we can warn you before you order."*
- **Typing allergy language routes you out of the field.** On matching a deliberately broad
  vocabulary (`allerg`, `intoleran`, `anaphyla`, `coeliac`, `lactose`, `gluten`, `peanut`, `nut`,
  `dairy`, `milk`, `egg`, `soy`, `sesame`, `epipen`), an amber block explains that notes are not
  a safety record and offers **"Add to allergy details"**, which goes to Edit child (5.10.1).
  A false positive costs one dismissible prompt; a false negative is an allergy nobody reads.
- **Never used to compute a warning**, and never treated as allergen data.
- **Tier P, so it is never logged** (R6).

> **RESOLVED 2026-08-10 (Andy) — `P12`, settling `E09-15`. The packing list surfaces the note,
> so the field is built.** The packing list is the only *per-child* artefact we produce; the
> production list is aggregated, so a note about one portion has nowhere to live on it. If the
> note does not reach the packing list it reaches nobody.
>
> **Why it is built rather than cut:** 127 of roughly 282 non-draft legacy orders used
> `special-comments` — close to half. Dropping it is a visible regression from Bubble on a
> feature parents actually use.

Three conditions, all of them load-bearing:

1. **140 characters, hard.** A parent writing an essay is a parent whose request will not be read
   in a busy kitchen at 7am. The counter appears from 120 and the field stops accepting input at
   140 — it does not silently truncate on save.
2. **The copy promises only what a kitchen can deliver at volume.** "We'll pass this to the
   kitchen. It's a request, not a guarantee — and not the place for allergies." No "we will",
   no "the kitchen will ensure".
3. **It carries the packing list's retention rule** (`E09-14`, option c): generated fresh per
   service date, destroyed at end of day, **nothing retained server-side**. The moment a parent
   types something about their child into it, it is regulated data (R6).

**Sequencing.** The allergy-language diversion routes to Edit child (5.10.1), so **the note ships
after Edit child exists** — a diversion to a screen that does not exist is worse than no
diversion. Build order: cart → menu/dish *without* the note → add child + edit child → the note
lands in the dish sheet. *(The prototype carries it now so the interaction can be judged.)*

### 5.7 Cart

- **Purpose.** Confirm what is being bought, for whom, for when, and for how much — then pay.
- **Elements.** Ref `09`, substantially extended:
  1. Title "Your order".
  2. **For** block: child, school, break time, service date. Editable.
  3. Line items: photo, name, veg mark, ex-GST unit price, stepper, remove.
  4. Allergen warnings for the selected child, per line.
  5. **Cutoff line**: "Ordering closes on **Monday 11 Aug, 11:59 PM**." Full weekday, date and
     time — never a bare "00:00", which is ambiguous about which midnight it means and reads as
     a whole day wrong (`C5`). **The timezone is shown only when it differs from the phone's**,
     so the common case stays short and the parent abroad still gets it right (`C4`).
  6. Totals: Subtotal · CGST 2.5% · SGST 2.5% · **Total**. GST-exclusive throughout (R4).
  7. Sticky "Place order".
- **States.** *Empty* (pattern illustration + "Browse the menu") · *Loaded* · *Signed out* (fully
  usable; "Place order" triggers sign-in — R1) · *Signed in, no child* ("Place order" routes to
  Add child) · *Repricing* (skeleton on the totals block only, never on the whole screen) ·
  *Price changed* (§7 `price_changed`) · *Cutoff passed* (§7 `cutoff_passed`) · *Item
  unavailable* (§7) · *Offline* (viewable; "Place order" disabled with "You're offline — we'll
  need a connection to place this order") · *Error* · **_Restored after the app was killed_**.

#### 5.7.1 The cart is persisted, not held in memory

F1 covers losing the cart across the sign-in hop. It does not cover the OS killing the app,
and **that is the more likely event**: our audience is on mid-range Androids that reclaim
backgrounded processes aggressively, and the auth path (5.9) deliberately sends them into
another app first. A parent who adds three dishes, taps *Place order*, switches to Mail for the
code, and comes back to an empty cart has been failed at the most expensive moment in the
product.

Therefore:

- The cart is written to disk on **every** mutation — add, remove, quantity change, child or
  date change. Not on a timer and not on backgrounding: an app that is killed does not get to
  run its teardown.
- It is restored at launch **before** the first render, so the cart badge is never briefly wrong.
- What is stored is **ids and quantities plus the child and service date** — never prices, never
  a total. A restored cart re-prices against the server, because a cart persisted on Sunday and
  restored on Tuesday must not quietly present Sunday's prices (that is `price_changed`, §7).
- **Nothing tier-P goes in it.** The child is stored as a `recipient_id`, never a name (R6) — the
  store is not encrypted, and a child's name in it is a child's name on disk.
- A restored cart whose items have since been withdrawn drops those lines and says which, rather
  than failing later at checkout with `item_unavailable`.
- **A restored cart is not a stale cache and must not render as one** — no offline banner. It is
  authoritative local intent, not a cached server read. See §5.21.

### 5.8 Sign-in

- **Purpose.** The single gate, at checkout only (R1).
- **Elements.** Ref `03` **rebuilt without passwords and without OAuth**: "Welcome 👋", a line
  saying why we are asking *now* ("We need an account to place your order"), the email field →
  "Email me a code", and — load-bearing — **"New here? Enter your email and we'll send a code —
  that is all it takes to create your account."**
- **No Google or Apple buttons in v1.** They need client ids that do not exist, and a button
  that cannot work is a dead end on the one gated screen in the product. When the ids exist they
  go above the divider; until then the screen must not imply they are the way in.
- **Why the "New here?" line is not decoration.** `AR4` makes first sign-in the whole of
  registration. A screen headed "Sign in" offering no visible way to create an account reads as
  broken even when it is working perfectly — Andy hit exactly that and concluded he was blocked
  on OAuth. 150 Amity parents will meet this screen cold.
- **States.** *Default* · *Email entered, code sent* (moves to 5.9) · *Cancelled by user*
  (returns to cart, nothing lost) · *Error* · *Offline* (disabled + explanation).

### 5.9 Email OTP

- **Elements.** "Check your email", the address with an edit affordance, six-box code input,
  "Resend in 0:30", verify.
- **States.** *Awaiting* · *Verifying* · *Wrong code* (inline, code retained, attempts left) ·
  *Expired* · *Resend cooling down* · *Resent* · *Too many attempts* (locked out, with what to
  do) · *Offline* · **_Returned from background_ (see below)**.

#### 5.9.1 Backgrounding is the normal case here, not an edge case

This screen is the **only** one in the product whose happy path requires leaving the app. A
parent must switch to Mail, read a code, and come back. Treating that as an interruption to be
recovered from is backwards — it is the design.

The state that must survive **background → foreground and full process death**:

| Survives | Why |
|---|---|
| Digits already entered | Re-typing four of six digits because Mail took focus is a gratuitous failure |
| The resend countdown | A timer that restarts on return either lets someone spam resends or blocks a legitimate one. It is anchored to a persisted **timestamp**, never to an in-memory tick |
| The pending email address | Otherwise the parent lands back on 5.8 and starts over |
| The **cart and the interrupted intent** | R12/R13. They were mid-checkout; returning them to Home is losing the order |

**On return, auto-fill from the clipboard.** iOS surfaces a one-time-code suggestion natively;
on Android the code is read from the clipboard when it matches the expected shape. Two rules:
fill **only** an exact six-digit match, and **never submit automatically** — a code that fills
and verifies itself while a parent is still reading is disorienting, and a wrong auto-submit
burns one of their three attempts. Fill, highlight, let them tap Verify.

**Do not put the code in the email subject line** unless the deliverability team confirms the
notification preview; the whole point is to be readable from the lock screen without opening
Mail at all. *(Owner: whoever writes the transactional email template — raise as its own task.)*

### 5.10 Add child

- **Purpose.** Bind a child to a school and record consent, in one transaction.
- **Elements.** Title; first name (required); last name; school (prefilled from browsing);
  class + section pickers (`school_class`); **consent block**; optional **allergen block**
  behind its own consent; save.
- **Consent, and why it is two questions.** `consent_granted` covers the required purpose —
  first name, class, section, so the right food reaches the right child. `allergen_consent`
  separately covers **health data about a minor** and is optional (`C12`, `C5`). A parent may
  decline it, use GrayBag, and get no allergen warnings. Allergy fields are only shown, and only
  sent, when that consent is given — a parent who typed "peanut allergy" and had it silently
  dropped would believe the kitchen knows.
- **States.** *Empty form* · *Invalid* (inline, per field) · *Saving* · *Saved* · *School not
  served* (`school_not_served`) · *Consent missing* (save disabled, reason stated) · *Allergy
  details entered without allergen consent* (blocked client-side **and** server-side) ·
  *Offline* (save disabled) · *Error*.

#### 5.10.1 Edit child *(new — this spec adds it)*

- **Why it was missing and shouldn't have been.** Children move up a class every September and
  are routinely put in the wrong section at signup. Over a year the average parent opens this
  screen **more often than Add child**, and without it the only fix for a typo in a child's name
  is to contact support.
- **Purpose.** Correct a child's details, change their allergies, move them to another school,
  or stop ordering for them.
- **Elements.** First name, last name, school, class, section; a **consent-already-given** notice
  showing the date and policy version; the allergen-consent toggle with its allergy chips behind
  it; Save; and a destructive **Remove** at the bottom, separated.
- **Three things it must not do:**
  1. **Re-ask for consent that was already given.** The existing consent stands and its version
     is *shown*, not re-collected — re-consenting on every edit trains people to tap through it.
  2. **Move a child to another school while they have undelivered orders.** `future_orders_exist`
     (`D19`) — those lunches were bought against the old kitchen's menu. The refusal names the
     count and routes to cancelling those days.
  3. **Silently drop allergy data when allergen consent is withdrawn.** Turning the toggle off
     *deletes* the details and stops all warnings, and the screen says exactly that before it
     happens — withdrawal of consent is a real DPDP right and must actually delete.
- **States.** *Loading* · *Loaded* · *Invalid* (inline, per field) · *Saving* · *Saved* ·
  *School change blocked by undelivered orders* · *Allergen consent being withdrawn* (confirm,
  naming what is deleted) · *Removing child* (confirm; past orders and invoices are retained
  because we are required to retain them, and the screen says so) · *Offline* (save disabled) ·
  *Unreachable* · *Error*.

### 5.11 Checkout review

- **Purpose.** The last screen before money. Nothing new is decided here.
- **Elements.** Child + school + break + date; items; totals with the GST split; the cutoff line;
  "Pay ₹X" .
- **States.** *Preflight running* (skeleton totals) · *Ready* · *Preflight refused* (each code in
  §7) · *Submitting* · *Handing off to Razorpay*.

### 5.12 Payment

- **Purpose.** Hold the user honestly while Razorpay runs and settlement confirms.
- **Elements.** Razorpay's own sheet, then **our** waiting state: pattern-on-green, "Confirming
  your payment", a line saying not to close the app, and after 10 s "This is taking longer than
  usual — we'll email you the moment it's confirmed."
- **States (R8 governs all of them).** *Sheet open* · *Sheet dismissed by user* (§10.2 — order
  stays `pending_payment`, cart intact, "Payment cancelled — your order isn't placed") ·
  *Failed* (§10.1, retry) · *Succeeded, settlement confirmed* → 5.13 · **`payment_pending`**
  (§13 — skeleton the confirmation, poll status; **never** show a tick) · *App killed mid-payment*
  (§10.3 — on relaunch, reconcile and land on the true state) · *Network dropped mid-payment*
  (same reconcile path; the app must never guess).

### 5.13 Order confirmed

- **Elements.** Pattern-on-green, mark, "Order placed", child + date + break, the **pickup code**
  (four digits, allocated on capture — §9.4, so it exists here and only here), items, total,
  "View order" / "Back to menu".
- **States.** *Confirmed* (the only state; unreachable otherwise, by R8).

### 5.14 Orders list · 5.15 Order detail

- **Orders list.** Grouped upcoming / past; each row: date, child, item count, status pill,
  total. States: *loading* · *loaded* · *empty* ("No orders yet") · *signed out* (prompt, not a
  wall) · *offline* (cached) · *error*.
- **Order detail.** Status timeline from `order_status`; child; school; break; date; pickup code
  when allocated; items; the GST breakdown; invoice link; **Cancel** when — and only when —
  `now() < cutoff_at − customer_cancellation_cutoff_minutes` (E5). States: *loading* · *loaded* ·
  *cancellable* · *not cancellable* (with the reason, not a hidden button) · *cancelling* ·
  *cancelled* · *refund pending* · *refunded* · *refund failed* (§10.12 — "we're on it", support
  route) · *error* · *offline*.

### 5.16 Children · 5.17 Account · 5.18 Support

- **Children.** List from `guardian_link` (never `recipient.created_by_user_id` — `D10`); rows
  show name, class, school, allergy summary, and an **Edit** affordance (5.10.1). States:
  *loading* · *loaded* · *empty* · *unreachable* · *error*.
  **One parent per child in v1** (`AR8`) — there is no read-only child, no permission UI and no
  second-guardian invite. `can_order` stays in the schema, defaulted true.
- **Account.** Name, email, children, orders, policies, **delete account** (compliance), sign out.
- **Support.** Grievance officer contact (compliance), email, FAQ.

### 5.19 Policy acceptance gate

- **Purpose.** The policy-version acceptance gate (one of the six compliance tasks).
- **Behaviour.** Blocks **writes**, not browsing — consistent with R1. A parent can read the menu;
  they cannot place an order until the current policy version is accepted.
- **States.** *Not required* · *Required* (summary of what changed + accept) · *Accepting* · *Error*.

### 5.20 Can't connect *(new — this spec adds it)*

- **Purpose.** The honest failure surface for "the app has no usable backend": missing env,
  DNS failure, project unreachable.
- **Why it is new.** `configureApiFromEnvironment()` deliberately lets the app open without a
  client so that a parent never sees a stack trace. That is right — but nothing then tells the
  user, so every subsequent screen fails in its own way and an unconfigured build looks like an
  empty menu. **That is exactly the class of failure that made "the menu isn't published" look
  like a data problem this morning.**
- **Elements.** Pattern-on-green, mark, "We can't reach GrayBag right now", retry, and — in
  non-production builds only — the environment name and the missing variable names. Never any PII.

### 5.21 Emptiness is four different things, and the app must say which

**This is a class of defect, not a screen.** "This school's menu has not been published" was
shown for a backend the app could not reach, and that one collapsed distinction cost three
hours of hunting a data problem that did not exist. Everywhere a list can be empty, four
genuinely different situations are in play, and they need four different words, four different
recoveries, and four different logging outcomes.

| # | Situation | What is true | The user's recovery | Logged? |
|---|---|---|---|---|
| **N1** | **Nothing here** | The request succeeded and the answer is legitimately zero rows | Change what you asked for — another school, another category, clear the search | No. This is a normal answer |
| **N2** | **We couldn't ask** | Transport failure: offline, DNS, 5xx, unconfigured client | Retry. Nothing is wrong with their data | Yes — this is our fault |
| **N3** | **You can't see this** | The request succeeded and authorization filtered it out | Not a retry. Explain *who* can act, or route to support | Yes — usually a bug or an attempt (§13 `recipient_not_permitted`) |
| **N4** | **This is what we had last time** | Cache hit, no live fetch | Optional refresh; the content is real and usable | No |

**N3 must never render as N1.** "You have no children" shown to someone whose link was revoked
is a lie, and a lie that reads as data loss. `AR8` removes the co-guardian route to that state
but not the class: a revoked link, a deactivated child and a failed read still all render empty
today. **N4 must never render as N1 or be silent** —
a menu from Sunday shown on Tuesday without saying so is how a parent orders a dish that was
withdrawn.

#### Every place in the app where these collapse today

Audited against the current screens. Each row is a defect to fix as the screen is rebuilt.

| Screen | Today | Should be |
|---|---|---|
| **Menu** (`MenuScreen.tsx:95`) | `ListEmptyComponent` renders "This school's menu has not been published" for *every* empty list — genuinely unpublished (N1), a failed fetch (N2), and an unconfigured client (N2) alike | N1 keeps the current wording. N2 → retry state, or 5.20 when the client is unconfigured. N4 already handled correctly by the stale banner — keep it |
| **Menu — allergens** | `AddChildScreen` swallows an allergen fetch failure into `[]`, and the menu then renders cards with **no allergen flags** | N2 must suppress the flags *and say so*. Rendering "no warning" from a failed fetch is a safety claim we did not verify (F5/F6) |
| **Children** | An empty list means "no children yet" (N1), "your link was revoked" (N3) and "the read failed" (N2) identically | Three distinct states. N3 names the other guardian rather than implying the child is gone |
| **Orders** | Empty for a signed-out user (N1-by-design), an empty history (N1) and a failed read (N2) | Signed-out is a prompt, not an empty state. N2 retries |
| **School picker** | An empty result is "no school matches" whether the search matched nothing (N1) or the request failed (N2) | Split; N2 offers retry |
| **Dish detail — allergens** | Absent allergen data renders as reassurance | Already specified in 5.6: "not provided" is its own third rendering, distinct from "declared none" |
| **Cart, restored from disk** | n/a — new | Must render as N-none: authoritative local intent. Never an offline/stale banner (§5.7.1) |

**How this is kept fixed.** A single `ListState` type — `loading | data | empty | unreachable |
forbidden | stale` — that every list screen must exhaust. A screen that cannot render an
`unreachable` distinct from an `empty` fails to compile. This is the only mechanism that
survives the next person in a hurry; a convention in a document does not.

---

## 6. Flow map

### 6.1 The main path (signed out → ordered)

```
Splash → Welcome → Choose school → Menu → Dish → Cart
                                                  │
                                          "Place order"
                                                  ▼
                          Sign in ──► Email OTP ──┐
                                                  ▼
                                  (no child?) Add child
                                                  ▼
                                        Checkout review
                                                  ▼
                                  Razorpay ─► Confirming ─► Order confirmed
```

Every step before "Place order" is reachable with no session (R1). The gate is one screen deep
and appears once.

### 6.1.1 How long is that path, really

`docs/mvp-scope.md` makes signup-to-first-order a primary goal. A goal nobody counts is a goal
nobody hits, so here is the count — **install to paid, cold user, no account**.

**As drawn above: 11 screens, ~18 interactions.** That is too many, and three of them come off
without losing anything.

| # | Screen | Interactions | Verdict |
|---|---|---|---|
| 1 | Welcome | 1 | **Cut.** Merge into the school picker |
| 2 | Choose school | 2 (search, pick) | **Irreducible.** A menu read needs a school id and a signed-out user has no child to supply one |
| 3 | Menu | 1 | **Irreducible.** This is the product |
| 4 | Dish sheet | 1 | **Irreducible.** Allergens and the veg mark are decision information, not decoration |
| 5 | Cart | 2 (open, place) | **Irreducible**, but see below — it absorbs screen 9 |
| 6 | Sign in | 1 | **Irreducible.** The one gate (R1) |
| 7 | Google account chooser | 1 | **Irreducible.** Not ours |
| 8 | Add child | ~5 (name, class, section, consent, save) | **Irreducible.** Class and section decide which classroom the food goes to; consent is a legal precondition, not a form field |
| 9 | Checkout review | 1 | **Cut.** Merge into the cart |
| 10 | Razorpay sheet | ~3 | **Irreducible.** Not ours |
| 11 | Confirmed | 0 | — |

**The three cuts:**

1. **Welcome merges into Choose school.** The value proposition becomes the picker's header —
   pattern-on-green, mark, "healthy, home-fresh meals delivered to your child at school", then
   the search field. A returning parent gets a "Sign in" text link in the corner rather than a
   whole screen. *Saves one screen, one tap, and removes a screen whose only job was to be
   passed through.*

2. **Checkout review merges into the cart.** This is the direct consequence of the
   one-child-one-date decision: with a single child and a single service date, the cart and the
   review show the same six facts. Two screens showing the same thing is a confirmation step we
   invented. The cart becomes the review — it already carries the For block, the cutoff, and the
   GST split — and "Place order" goes straight to payment. *Saves one screen, one tap.*

3. **After Add child, return to the cart — never to Home.** Not a screen cut, a correctness fix,
   and the one most likely to be got wrong: a parent who has just been through auth *and* a
   consent form is at their least patient, and landing them on Home makes them re-find their own
   order. F1 already requires this; it is restated here because it is the step that decides
   whether the count above is real.

**After the cuts: 8 screens, ~14 interactions**, of which 4 belong to Google and Razorpay. Seven
interactions are ours, and every one of them is either a choice only the parent can make (which
school, which dish, which child) or a legal precondition (consent).

**This is the number Maestro measures.** The §6.1 flow asserts the screen count, so a future
change that quietly adds a step fails CI instead of being noticed a quarter later in the funnel.

### 6.2 The awkward paths

Each of these is a real state the backend can produce. Each has a defined screen response.

| # | Situation | Source | What the app does |
|---|---|---|---|
| **F1** | **Signed-out user taps "Place order"** | R1 | Cart is preserved across sign-in — the cart is local until checkout. Sign in → (add child if none) → **return to the cart, not to home**. Losing the cart here is the single most likely place to lose a first order. |
| **F2** | **Cutoff passes while the cart is open** | §9.2 C8, `cutoff_passed` | The cart's cutoff line flips to amber and then to "Ordering for \<date\> has closed". "Place order" becomes "Choose another date". The server rejects it regardless (E3) — the client is courtesy, never the guard. |
| **F3** | **Cart spans several service dates, one has closed** | §9.3 C7 | There is no partial checkout. The refusal names the offending dates; we offer "Remove \<date\> and continue" and re-price. |
| **F4** | **School has no published menu** | `public_menu` empty | "Nothing on the menu yet — this school's menu hasn't been published." Offer "Choose another school" and "Tell us your school". **This message must never be shown for a network or config failure** — that is 5.20's job, and conflating the two is what cost us today. |
| **F5** | **A dish contains the selected child's allergen** | `recipient_allergen` | Amber flag on the card; named warning in dish detail; explicit second confirm before adding; the warning persists in the cart line. Never blocked outright — the parent decides. |
| **F6** | **Allergen consent not given** | `C12`, `C5` | No warnings can be computed. Say so plainly once, in the cart: "You haven't shared allergy details, so we can't warn you about ingredients." with a route to add them. Silence here would read as "safe". |
| **F7** | **Network drops mid-payment** | §10.3 | On return, reconcile against `GET /checkout/:group/status`. Land on the true state: confirmed, still pending, or failed. Never assume, never show a tick (R8). |
| **F8** | **Order placed, webhook hasn't arrived** | §13 `payment_pending` (202) | Waiting state, skeletoned, polling. After 10 s, promise email. **Not** a success screen. |
| **F9** | **Parent has two children at different schools** | `guardian_link` | The **child selector is the school selector**. Switching child switches school, menu and cart context. A cart is per-child-per-date; switching child with a non-empty cart asks before discarding. This is the strongest argument for the "Delivering to" card being the primary home control. |
| **F10** | ~~Co-guardian without `can_order`~~ | — | **Removed — co-guardians are cut from v1 (`AR8`).** There is no way to become a second guardian, so this state is unreachable. `recipient_not_permitted` remains a hard error meaning a bug or an attempt, never a UI state |
| **F11** | **Price changed between cart and checkout** | `price_changed` (409) | Show old → new, require explicit re-confirm. Never auto-accept a higher total. |
| **F12** | **Checkout group swept as abandoned** | `checkout_expired`, §10.4 | "That order timed out." Offer to rebuild the cart from the same items. |
| **F13** | **Duplicate payment** | §10.6 | Not a UI path — reconciled server-side, refunded. Order detail shows the refund. |
| **F14** | **Policy version changed** | 5.19 | Browsing continues. The first write routes through the acceptance gate and then resumes the interrupted action. |
| **F15** | **Signed in on a new device** | — | Session from keychain absent → Welcome → Sign in → children and orders restore. The school comes from the child, so Choose school is skipped. |

---

## 7. Server error code → UI response

Straight from `order-lifecycle.md` §13. The app acts on the code, never on the string.

| Code | HTTP | UI response |
|---|---|---|
| `cutoff_passed` | 409 | Name the closed dates; offer to drop them; re-price (F2, F3) |
| `price_changed` | 409 | Old → new total, explicit re-confirm (F11) |
| `item_unavailable` | 409 | Remove the line, say which, re-price |
| `advance_window` | 409 | Should be unreachable from the calendar; generic refusal + log |
| `recipient_not_permitted` | 403 | Hard error, support route, log. Not a designed state — with `AR8` it means a bug or an attempt |
| `insufficient_wallet` | 409 | Re-price without the wallet portion |
| `idempotency_key_reused` | 409 | Client bug. Do **not** retry. Generic failure + log |
| `cancellation_closed` | 409 | "Too late to cancel online" + contact support |
| `checkout_expired` | 409 | Offer to rebuild the cart (F12) |
| `payment_pending` | 202 | Waiting state, poll, **never** the tick (F8, R8) |

---

## 8. Decisions — all five now settled

Kept here as the record of what was decided and why, so none of them gets quietly reopened.

1. ~~**VAG Rounded Next licence.**~~ **DECIDED 2026-08-10 (Andy): ship the rounded fallback
   everywhere; do not block on the licence.** Full reasoning and the single-token constraint that
   keeps it reversible are in §3.2.

2. ~~**Dish photography.**~~ **DECIDED 2026-08-10 (Andy): use the real photographs, not stock.**
   My §8 was wrong when first written — it said there is no photography in the system, which is
   true of *staging* (`image_path` is null on every dish) but not of the *company*.
   `docs/bubble-recon-findings.md` §6 records that **82 of 85 legacy dish images resolve**, and
   `E16-28` already mirrored them off the Bubble CDN to disk with a committed manifest. The
   prototype uses those. The three permanent 403s are being re-shot (`E16-29`) and render as the
   brand pattern tile — which is the state the app needs anyway, so the prototype shows it.

   **Consequence, and it is a scheduling one:** image migration moves out of E16 and onto the
   near-term path. `E16-43` (upload from the manifest into Supabase Storage and repoint the dish
   records) is now a **blocker for the app looking real**, not a data-migration tail-end task.
   Everything about how a dish card reads depends on a photograph actually arriving in it.

3. ~~**The notification bell.**~~ **DECIDED 2026-08-10 (Andy): no bell in v1; cart badge
   instead.** See §5.4.

4. ~~**`[OL-02]` — cutoff passing during payment.**~~ **DECIDED (Andy, and previously — this
   spec re-raised a settled question, which was my error): option (a), a grace window, as
   per-kitchen config, defaulting to 15 minutes.**

   Reconciling it with what I wrote: my recommendation was "honour the payment", on the grounds
   that money leaving a parent's account before the cutoff should not be refunded. The grace
   window **is** that, made bounded and configurable rather than unlimited — and it is the better
   answer, because "honour the payment" has no stopping rule. A payment that settles four hours
   late because a webhook was stuck is not a parent who ordered in time; it is a kitchen being
   handed an order it cannot cook. Fifteen minutes covers every realistic settlement delay and
   nothing else.

   **UI consequences, which is why it belongs in this spec:**
   - Settlement inside the window → a normal confirmed order. Nothing distinguishes it, because
     nothing should: the parent paid on time.
   - Settlement outside it → the order is refused and **automatically refunded**, and the parent
     is told plainly what happened and that the money is coming back. This is a state 5.12 must
     be able to land on and 5.15 must be able to display; it is not an error dialog.
   - The window is never shown to a parent, and never counted down at them. It is a server
     tolerance, not a deadline they can act on — putting it on screen would invite racing it.

   **Actions this needs, which are not design work:** record it in `docs/decisions/` (it has been
   decided twice and written down neither time — that is why it keeps coming back), update
   `order-lifecycle.md` §9.2 E4 from "undecided" to the rule, and add the config key. Raise as
   its own task.

5. ~~**Cart scope, `[DM-01]`.**~~ **DECIDED 2026-08-10 (Andy): one
   child, one service date per checkout in v1.** Consequences, which are large and good:
   - **F3 disappears.** There is no multi-date cart, so there is no partial-checkout rejection
     and no "remove the closed date" flow. `cutoff_passed` becomes a single, simple refusal.
   - The cart header is a single "For \<child\> · \<school\> · \<break\> · \<date\>" block.
   - One `cutoff_at` per cart, so the cutoff line is one line.
   - Per `order-lifecycle.md` §14, `order_group` collapses to one order. **This needs recording
     as a decision in `docs/decisions/` and may retire code paths in `checkout`** — raise as its
     own task; do not fold it into the design work.
   - F9 (two children at different schools) still stands: switching child switches school and
     cart context, and a non-empty cart asks before discarding.

---

## 9. What happens next

1. This spec, reviewed and marked up.
2. The clickable HTML prototype built from it — every screen, every state reachable
   deliberately, brand applied, realistic content.
3. Marked up by Andy.
4. Only then React Native, one screen at a time, each verified on a device.
5. Maestro covering the main path in §6.1 against a real build and real staging, in CI.
