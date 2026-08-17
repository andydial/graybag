# Decisions — 17 August 2026

An unattended run. Andy asleep; the instruction was to decide, record here, and keep going.

---


**Two threads wrote here on the same night, and both numberings are kept.** The web thread used
`D-17A`…`D-17F`; the mobile thread continued `docs/decisions-16aug.md`'s sequence with
`D41`…`D47`. Neither was renumbered on merge — a decision id that moves is worse than one that
looks inconsistent, and `DOC1` says ids are permanent. Web entries first, mobile second.

---

## D-17A — service days set to Mon–Sat on all three schools

Andy's decision, stated and applied: *"Every dish is already Mon–Sat, so ordering for Sunday is a
bug not a feature."*

`school_config.service_days = [1,2,3,4,5,6]` on Amity, Paragon and Gem, written through
`admin-school` as Andy's own signed-in session rather than by SQL — the config path has an audit
trigger that reads `updated_by_user_id`, and a direct UPDATE would have left the change
unattributed.

All three previously read `null`, which inherits the platform default of all seven days. That is
the `check:launch` warning cleared.

---

## D-17B — food types are proposed, never written

*"Prepare, don't decide."* `scripts/propose-food-types.mjs` writes two files and touches nothing.

The classifier is deliberately **asymmetric**, because the errors are not symmetric. A dish marked
`veg` that contains egg is a broken promise to a parent; a dish left unmarked is merely unfinished.
So:

- evidence of egg or meat is taken at face value → high confidence;
- **absence of evidence is not evidence of absence** — 11 production dishes have no ingredient list
  at all, and the module *refuses to guess* rather than reading "Lemonade" as obviously vegetarian.
  Their `food_type` cell is blank, and a blank is "no opinion" to the importer, so applying the
  file leaves them exactly as they are;
- ingredients that are *usually* but not *always* vegetarian — **mayonnaise** above all, where
  eggless is the Indian default and egg mayo genuinely exists — are proposed `veg` and marked low
  with the reason attached.

79 unmarked: **37 confident veg, 9 egg, 22 veg-worth-a-glance, 11 no proposal.** The 9 egg dishes
were checked by hand against the source and all 9 genuinely contain egg — no false positives, which
is the direction that would matter.

The CSV carries only `name`, `kitchen_code`, `category` and `food_type`. The importer compares only
the fields a file actually carries, so applying it **cannot** change a description or a price. The
dry run confirms it: 68 changes, every one of them `changing: foodType`.

---

## D-17C — allergen suggestions are offered, never applied

`/admin/allergens`. All 79 production dishes are in `MI1`'s **third** state: no tags, and nobody
has declared there are none. `0006` is explicit that this is *unknown* and must be warned about —
and on any screen that only counts tags it looks exactly like "contains nothing".

Three decisions worth keeping:

**The guesses are not pre-applied.** Boxes start at what the database holds; the suggestion sits
beside them, drawn dashed rather than filled, with the ingredient words that triggered it. Accepting
is a click and saving is another. A machine-generated allergy tag that arrives pre-ticked is one
distracted Save away from becoming a fact nobody chose.

**"Contains none" is a button, not an empty save.** Saving a dish with nothing ticked would clear
the tags and leave it in the same unknown state — a save that appears to work and changes nothing
that matters. `allergens_declared_none` is written explicitly, and the server **refuses** tags and
`declaredNone` together rather than picking between two opposite claims.

**The rules under-report, and the banner says so.** Keyword matching over ingredient text cannot
know that a bread contains unlisted milk powder or that a kitchen fries in shared oil. Presenting
an accepted suggestion as a finished dish would be the real failure here, so nothing on the screen
ever says a dish is complete.

Verified against production: both writes land, all three rails fire (opposite claims, unknown code,
unknown dish id), and every row was restored — `dish_allergen` is back to 0 and no dish carries a
declaration. **The tagging itself is Andy's**, exactly as the food types are.

---

## D-17D — the Apply button runs the CLI's code, and the browser's plan is never trusted

`admin-import` imports `parse`, `validate`, `plan` and the four `apply*` functions from
`tools/bulk-import/src/` directly. `E10-29` made that possible by splitting `connect.mjs` out of
`db.mjs`; every remaining function takes its client as an argument, so the same code runs from a
laptop, a browser and Deno.

Checked the assumption before building on it: a throwaway function importing `plan.mjs` from
outside `supabase/functions/` deployed and ran. Then deleted.

The browser posts the **file**. A client-supplied plan would be an arbitrary write request wearing
the shape of an audit trail, so the server recomputes and applies its own, and the page shows the
server's report rather than the one already on screen.

---

## D-17E — images go through a function because storage is default-deny, and that is correct

`storage.objects` has **no policies at all**, so a browser cannot write to the `dish-images`
bucket. Opening that up would mean a broad policy on a **public** bucket; routing the bytes through
`admin-dish-image` keeps the `dish.edit` check, the `asset` row and `dish.image_asset_id` in one
place. A direct upload leaves an orphaned object on any failure after the PUT — referenced by
nothing, and therefore cleaned up by nothing.

The browser resizes to 1280px first. A 4 MB phone photo on a menu is the easiest way to make that
menu unusable on the connections this product is built for.

---

## D-17F — there is no paid order on production, and that is the finding

Andy asked me to verify the kitchen path against "the one on production now". There are two orders
and **neither is paid**:

| service date | status | |
|---|---|---|
| 2026-08-19 | `cancelled` | created 12:50 UTC, cancelled two minutes later |
| 2026-08-20 | `pending_payment` | created 15:36 UTC, still pending |

**The `payment` table is empty.** No payment row was ever written on production, so the checkout
reached `pending_payment` and stopped. Either the Razorpay sheet was never completed, or nothing
came back from it.

The board and the packing sheet were verified to correctly show **nothing** for 20 August — a
`pending_payment` order must not reach the kitchen (`L5`), and unpaid food must not be cooked. That
is the right behaviour and it is confirmed on production.

**I did not fabricate a paid order on production.** Marking one paid by hand would put revenue in
the ledger that nobody paid, on the system that issues invoices.

So the full path — badges and mark-delivered — was proved on **staging**, where paid orders and
recorded allergies exist, through the real board as Andy's own signed-in session:

- allergy badges render on the board and the packing sheet (`Tara Bajwa MILK`,
  `Dhruv Ahluwalia GLUTEN`);
- the **Delivered button** on the board moves a paid order to `delivered` and writes
  `paid -> delivered | actor=kitchen | user=<Andy>`.

One thing that cost twenty minutes and is worth writing down: the board has a **ten-second undo
window**. A click queues the change and flushes when the window closes, so reading the database six
seconds later shows the old status and looks exactly like a broken button. It was working the whole
time.

---

## D41

**The ledger rule is a non-negotiable in `CLAUDE.md`, not an entry here.** Andy asked for it as a
standing rule, and standing rules that live in a dated decision file get read once. It is
non-negotiable #8: a migration applied to production by hand is recorded in the ledger in the
same operation, with the two-command form written out, and a "verify before you record" clause —
because the two directions of drift found on 16 August have opposite fixes, and recording a
migration you have not confirmed applied is how the first direction happens.

## D42

**The force-update gate cannot do what the 19th needs, and the plan says so.** Writing
`docs/force-update-plan.md` surfaced this: `min_supported_app_version` works by the app calling
`app_version_support` and obeying the answer, and `3.7.0` is the **Bubble** binary — it has never
heard of `VersionGate`, does not call the RPC, and does not talk to our Supabase project at all.
It asks nothing, so there is nothing to refuse.

Setting the floor to `4.0.0` on the 19th blocks **nobody**: `3.7.0` never asks, and `4.0.0` is not
below `4.0.0`. What actually moves parents off the old app is the Bubble freeze in the cutover
runbook — ordering and payments disabled there. A parent still on `3.7.0` after that sees
whatever *Bubble* shows, which is not a screen in this repository.

I have set nothing, as instructed. The recommendation in the plan is to keep setting nothing on
the 19th, and to arm the gate only if a released 4.0.x turns out to be harmful — with the hard
rule that the floor may never exceed a version that is actually downloadable, because a parent
blocked below a non-existent build has no recovery at all.

## D43

**`npm run ship:ota -- "message"` is the one line, and it lives in the root `package.json`.**
`eas update` has to run from `apps/mobile`, so the script is
`cd apps/mobile && npx eas update --branch production --message` — the trailing flag means
`npm run ship:ota -- "text"` appends the message rather than passing it as a positional, which
`eas` would ignore.

## D44

**The Account screen's build label now names the running JS, and that is how an OTA is
confirmed.** `gitSha` is stamped at build time and never moves when an update lands, so there was
no way to tell fresh JS from bundled JS on a device. The label now reads
`Production · 394dd2f · OTA 4625c38` or `… · bundled`.

Self-proving on build 12: that binary was compiled before the segment existed, so the segment can
only appear if an update replaced its JS.

The first shape was a `identity` prop for testability and `orphans.test.ts` refused it —
correctly, since nothing but a test would pass it. The logic moved into a pure `buildLabelText`.
I changed my code rather than the guard; `UpdateRequiredScreen` had already made the same call
for the same reason.

## D45

**Maestro is green** — `[Passed] cart (47s)`, run 31891879898, the first time that job has ever
passed. Five distinct causes, and the shape is worth keeping: four were real defects in the
harness or its configuration, one was mine (`\` line continuations in a `script:` the action runs
a line at a time), and **none of them was a product bug**. The app was working the whole time.

The thing that finally made it tractable was the debug artifact — a screenshot and view hierarchy
at the moment of failure turned a 29-minute guess into a two-minute read, and settled the last
two causes in one run each.

## D46

**No fake payment on production, so the order-confirmation email stays unproven.** Andy asked for
"place an order, see it in Orders, open the detail, get the email". The first three are done on
production against a real clean parent. The email fires only when an order reaches `paid`, and
reaching `paid` needs a real Razorpay payment.

I could have forged a signed webhook — I have the secret and the signature scheme is proven both
ways — and I decided not to. It would put a phantom ₹72.46 through the live ledger, the invoice
sequence and `settle_payment` on launch weekend, and someone would have to unpick it from real
books. A test that corrupts the thing it is testing is not a test.

What I did instead: proved Resend works **from production** by submitting an enquiry, which
reached `support@graybag.com` with provider status `sent`, alongside sign-in codes showing
`delivered`. So the API key, sending domain and `ORDER_EMAIL_FROM` are all confirmed live. The
untested remainder is `_shared/order-confirmation.ts` itself — template, recipient resolution,
and `0050`'s one-email-per-order index — logged as `E08-15` with the note that **no Edge Function
shared module has any test at all**.

## D47

**Play could not be submitted; documented instead.** `eas submit --platform android` needs a
Google Play service-account JSON that does not exist here (`E17-51`, `owner:andy`). The bundle is
built, signed and on the `production` channel: `docs/play-internal-track.md` has the download
URL, package name, version code and three steps.

Worth knowing when it installs: the `.aab` was built from `bd8b295`, before this run's fixes, so
it will pull the current JS over the air on first launch — which makes the Play install a second
free test of the OTA path.

## D48

**The first OTA I published pointed at staging, and the manifest is the only thing that showed
it.** `apps/mobile/.env` names the staging project and a `rzp_test` key — correct for a
developer, catastrophic in a production bundle. `eas update` read it, `APP_ENV` was unset, and
the update went to the **production channel** stamped `"appEnv":"local"`.

Had build 12 picked it up, every tester would have moved onto staging with a test payment key,
without a single error: **`env.ts`'s Razorpay prefix guard was satisfied**, because it requires
`rzp_test_` when `appEnv` is `local` and that is exactly what the leaked file supplied. The wrong
pair was internally consistent.

Fixed by hardening `scripts/ship-ota.sh` with `EXPO_NO_DOTENV=1` and an explicit
`APP_ENV=production`, republishing as `f6e08844`, and verifying the live manifest now returns
`"appEnv":"production"` on both platforms. Then confirmed properly rather than by inference: a
local `expo export` with the same inputs contains the production Supabase host, **zero**
occurrences of the staging host, and the live Razorpay key — the single `rzp_test` hit is the
prefix constant in `env.ts`, not a key.

**I found this by checking something I had already reported as done.** The verification I ran at
the time — manifest 200, ids matching — was true and told me nothing about which backend was
inside the bundle. A check that passes on the wrong artefact is the failure mode worth
remembering here.

## D49

**"No payment has ever completed on production" is true, and nothing is broken.** Every link was
tested against production this morning and each one works:

| Step | Evidence |
|---|---|
| `create_checkout` → `pending_payment` | `GB-94Q6JD` placed for Monday 17 Aug, ₹72.46 |
| `payments-create-order` → live Razorpay order | `order_TQEBriyYjojCF1`, `rzp_live_…`, and a `payment` row appeared |
| Live account activated | Razorpay accepted the order; an unactivated account refuses at creation |
| Webhook registered | `TPqgSBnpEdsFSL`, active, on the prod URL, for `payment.captured`, `payment.failed`, `refund.created`, `refund.processed` |
| Webhook reachable unauthenticated | A POST with no apikey and no JWT returns `200 {"status":"recorded_unverified"}` — so `verify_jwt` is off and a bad signature is recorded, not processed |
| `checkout-status` reconciles | Returned `{"status":"pending","reconciled":true}` — it asked the live Razorpay API rather than believing our row |

**The reason no payment has completed is that none has ever been attempted.** The order sits at
`created` with `attempts: 0`, and the live account has **zero payments, ever**. My smoke order
deliberately stopped before paying, because paying it costs real money and I would not spend
Andy's.

So there was nothing to fix in the payment path. What I did instead was remove the two things
standing between Andy and a real attempt: an installable APK (`E17-58`), and the discovery below.

## D50

**An abandoned payment is unrecoverable, and the copy says the opposite.** `E05-54`. The app can
only pay an order inside the `useCheckout` flow, immediately after checkout — there is no resume
path. Dismiss the Razorpay sheet and the order is `pending_payment` for ever: `OrderDetailScreen`
refuses to cancel it, telling the parent *"it will close by itself if the payment does not come
through"*, and nothing closes it (`E05-51` — no `expired` status, no job, no `pg_cron`). It also
blocks deleting that child.

Every parent who dismisses the sheet once on launch day lands here. I cancelled the three test
orders on production as `system` so Andy starts clean, but a parent has no such route.

`payments-create-order` already supports this — it is per-attempt and returns `attempt_no` — so a
"Pay now" button on a pending order is a small change, not a redesign.

## D51

**No test data is ever created in production** — Andy's standing rule, 2026-08-17, now
non-negotiable **#8** in `CLAUDE.md` rather than only here. Verification happens on staging.
Anything that can only be proven on production needs his explicit go-ahead *and* a statement of
exactly what it will write, before it runs.

Enforced where enforcement is cheap: `scripts/lib/prod-write-guard.mjs` refuses any write to the
production project ref, recognising both the REST host and the pooler URI — the latter matters
because most writing scripts use `psql`, and a guard that only knew the REST form would have
covered almost nothing. Wired into `order-path-check.mjs`, which signs up a parent, adds a child
and places an order, and is exactly how this problem happened.

**The escape hatch is a sentence, not a boolean.** `GRAYBAG_PROD_WRITE=1` is refused, as are
`true`, `yes`, `ok` and `go`, because a boolean is set once during a legitimate approved run and
then lives in a shell profile forever. It must be at least 30 characters and is echoed to stderr,
so the terminal history records what was done and on whose authority. Nine tests.

**`grant-operator.mjs` was deliberately left unguarded.** It writes to production by design —
granting Andy's back-office permissions is real administration, not test data — and blocking it
would break a legitimate workflow to enforce a rule about something else. It already carries the
narrower guard this one was modelled on.

**And the limit is stated in `CLAUDE.md` rather than glossed:** every one of the rows this rule
exists because of was created by hand, with `curl` and `psql`, by someone who knew exactly which
project it was. No script guard can refuse that. The paragraph is the control; the code only
closes the automatable half.

## D52

**Cleanup is not a substitute for not writing, and production proved it.** The three test orders
**cannot be deleted**: `order_event` is append-only and cascades from `order`, so the delete
aborts, and `order.recipient_id` is `RESTRICT`, which pins the children behind them. What reaches
production is generally kept.

That is the strongest argument for D51 and it was discovered by trying. The cleanup that *was*
possible — webhook events, the payment row, idempotency keys, the enquiry and its rate rows —
went through; `Sweep Two` was erased through `DELETE /functions/v1/recipients`, deliberately not
by SQL, so it exercised the same code a real erasure request would.
