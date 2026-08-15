# Decisions — the run of 16–17 August

Andy, 2026-08-16: *"Do not ask me questions — decide, record in `docs/decisions-17aug.md`, keep
going. Blocked? Skip, note, next."*

Continues `docs/decisions-16aug.md` (D1–D40). Numbering continues from it rather than restarting,
because these are the same running record and a second `D1` would be unreadable in six weeks.

Permanent decisions still belong in `docs/decisions/<area>.md` with a real id — this file is the
narrative of an unattended run, not a substitute for the log.

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
