# Decisions taken overnight, 2026-08-27

Andy, 2026-08-26: *"Work continuously overnight. Don't stop to ask me anything — decide, record it
in docs/decisions-27aug.md with your reasoning, and keep going… I'd rather read a decision I
disagree with in the morning than find you waiting since 1am."*

Every entry below is a call I made without asking. Each says what I chose, what I rejected, and
what would change my mind — so disagreeing with one costs a sentence rather than an excavation.

Anything I could not decide safely is in **§ Skipped and why** at the bottom, not silently
dropped.

---

## `D1` — The pack entry point lives on Account, not the tab bar or Home

**Chosen.** `Your meal packs` sits in the Account list, exactly where the prototype puts it, and
nothing appears on Home, the Menu tab or the tab bar.

The prototype has a Home card (`f.haspack ? 'Your meal pack' : 'Buy meals in advance'`), and I am
deliberately not building it yet. Reason: Home is the first screen after sign-in and the one
surface where a wrongly-rendered pack prompt is most visible, and the gate is a network read that
resolves *after* first paint. A card that appears a beat late on Home reads as a glitch; a row
that appears a beat late in a list nobody has scrolled to does not.

**Rejected:** a fifth tab. The mock has four, `E05-04` fixed that count, and a tab is the least
reversible placement in the app.

**What would change my mind:** Andy wanting the Home card for conversion. It is a small addition
once the gate is proven — the read is already cached by then.

---

## `D2` — The surface gate is fetched once per school change and cached, never per screen

**Chosen.** `MealPackSurfaceContext` holds `{ canBuy, hasBalance }`, refetched when the selected
school changes or the session changes, and every pack surface reads from it.

Each screen calling `fetchMealPackSurface` for itself would be simpler to write and wrong in a way
that matters: the answer would arrive at different times on different screens, so a parent could
see the Account row disappear while standing on the balance screen. One answer, one moment.

**Rejected:** deriving `hasBalance` client-side from a fetched pack list. That would make the app
the authority on whether a balance exists, and `E21-31` is precisely about the server owning that.

---

## `D3` — Pack screens are stack routes, and none of them is reachable when the gate is off

**Chosen.** `Packs`, `PackDetail`, `MyPacks` and `PackPlan` are `Stack.Screen`s registered
unconditionally, but **nothing navigates to them** unless the gate says so, and each renders the
prototype's fallback if reached anyway.

Registering them conditionally would have been the stricter reading of *"no such concept"*, and I
rejected it: a route that appears and disappears from the navigator makes `linking` and deep links
behave differently depending on a network read, and a parent following a stale link would get a
"screen doesn't exist" crash rather than the designed fallback. Andy's amendment — *"the
prototype's screen survives as a fallback"* — is exactly this case.

**The rule that is enforced instead:** no *entry point* renders. `meal-pack-surface.test.tsx`
asserts the Account row, the cart strip and every navigation call are absent when the gate is off.

---

## `D4` — `screen_viewed` names the pack screens; no pack event carries a price

**Chosen.** Four new screen names (`packs`, `pack_detail`, `my_packs`, `pack_plan`) and three tap
events (`pack_offer_opened`, `pack_purchase_started`, `pack_plan_confirmed`). None carries an
amount, a meals count, an offer id, a child, or a dish.

`pack_plan_confirmed` was the tempting one — knowing how many days a parent plans at once is a
genuinely useful product number. But a plan is a set of children and dates, and the count is one
join away from *which child eats on which days*, which is the food profile `s.9(3)` forbids
building. Revenue lives in the ledger, which does not leave the country.

**What is knowable from these:** how many parents reach the offers screen, how many open one, how
many start a purchase, how many confirm a plan. That is the funnel; the amounts are in the
database.

---

## `D5` — the orphan guard learned "read-only context" rather than being given an exemption

**Chosen.** `MealPackSurfaceContext` exposes `{ canBuy, hasBalance, loading }` and **no setter**,
which broke `orphans.test.ts` twice: its vacuity check refuses a context whose shape it cannot
parse, and its writer check requires something outside the file to call an action.

The easy fix was a `KNOWN_ORPHANS` entry. I rejected it: an exemption says *this one is allowed to
be broken*, and this context is not broken — it is a different, deliberate shape. The server owns
both flags, and `hasBalance` is a **debt**, so letting any screen set it would be the app deciding
what it is owed.

So the scan now recognises a context with zero actions, and the writer test **asserts positively**
that such a context still has a hook and a provider rather than skipping silently. The exemption
was added and then removed once the scan understood the shape.

**Verified rather than assumed:** adding an unwired action named `zzzUnwiredPackAction` fails the
writer check, so the read-only path does not mask the real guard.

### A weakness in that guard, found on the way and worth fixing separately

`callsTo(action)` matches by **bare name**. An unwired action called `refresh` passes, because
something else in the app calls something called `refresh`. I confirmed this: the same mutation
passes as `refresh` and fails as `zzzUnwiredPackAction`.

That means the guard is weakest precisely for the names people actually choose — `refresh`,
`load`, `reset`, `clear`. Filed as `E21-38` rather than fixed here, because tightening it will
surface existing collisions across the app and that is its own piece of work with its own review.

---

## `D6` — the balance is ONE pack, not a sum across packs

**Chosen.** `meal_pack_balance` returns the pack the next order will draw from — spendable and
oldest-expiring first, the same order `spend_meal_pack_meals` takes them in — and carries
`meals_across_all_packs` alongside for any surface that wants the total.

A parent may hold several packs. Summing them gives "17 meals left", which is true and useless,
because it cannot answer *when do I lose these*: the two packs expire on different dates and the
number hides which meals are about to go. The prototype shows one balance with one expiry, and
that is right rather than a simplification.

**Rejected:** returning a list and letting the app choose. That would put the oldest-first rule in
two places, and the app's copy would be the one that drifts.

---

## `D7` — the balance carries the offer's meal rule, and `dishInfo` gained `categoryId`

**Chosen.** `meal_pack_balance` returns `items_per_meal` and `required_category_id` with the
numbers, and the navigator's `dishInfo` map now copies `categoryId` from the menu payload.

Without both, the cart cannot tell a parent *why* their cart will not take a meal until after they
tap and the server refuses. The payload has always carried `categoryId`; only that map dropped it,
so this was one line rather than a new read.

**The rule travels with the pack, not the app.** A three-item pack, or one requiring fruit rather
than a drink, changes nothing in the client — `pack-eligibility.test.ts` covers both, because a
rule hardcoded to "two items, one drink" would silently mis-advise every parent the day Andy
creates a different pack.

**Still true:** the server decides. The app's copy only picks which sentence to show.

---

## Skipped and why

**The planner's SCREEN.** Reversed in part: I skipped it, then had budget left and built its
**arithmetic** — `pack-plan.ts`, 22 tests, both mutations caught — because that is the half where
an over-spend would hide and it is testable without a component. The screen itself is still
`E21-41`. Splitting it this way was the right call rather than a compromise: the footer's counting
rule is the thing that protects a parent's afternoon, and it is now proven independently of any
rendering.

**Buying a pack end to end.** `PackDetail` and the purchase itself need an Edge Function that
creates a `meal_pack_purchase` order group, takes payment through the existing Razorpay path, and
writes the pack and its ledger legs in one transaction. That is money-moving code and it needs the
tax-point answer (`E21-22`) before it can be finished honestly, since the ledger legs differ. The
buy button therefore does not exist yet — deliberately, rather than as a stub that looks like it
works.

**A cross-check that the app's eligibility rule agrees with the server's.** Both are tested
separately and I believe they agree, but the assertion I actually want — same inputs, same verdict,
run against both implementations — needs order rows in the database per case. Worth doing;
`E21-42`.
