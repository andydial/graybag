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

## Skipped and why

*(appended as I go — an empty section here would be a lie by omission)*
