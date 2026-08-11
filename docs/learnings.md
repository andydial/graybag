---
title: Learnings
---

# Learnings

Running record of what broke, what did not work, and non-obvious constraints. Claude Code
appends here as it builds; Andy can read it to understand why things are the way they are.

Format — newest first:

```
## YYYY-MM-DD — Short title
**Context:** what we were doing
**What happened:** the symptom
**Cause:** the actual reason
**Fix / rule:** what we do now, and what to avoid repeating
```

---

## 2026-08-11 — A constant asserted against a guess is not an assertion

**Context:** first iOS submission to TestFlight. Four Apple errors, two causes, both ours.

**What happened:** `ITMS-90062`, `ITMS-90186` and `ITMS-90478` — the uploaded build was
`2.0.0` and the live App Store app is **3.7.0**, so the upload was a version *downgrade*.
`app-config.test.ts` had a test named "starts above the live Bubble build" that asserted
`major >= 2`. It passed. It had always passed.

**Cause:** `2` was never checked against App Store Connect. Someone reasoned "the rebuild is
version 2" and wrote a test around it, and from then on the repo contained a green,
confidently-named assertion whose subject — *what is actually live* — no one had ever looked
up. The test could not fail, because it was comparing the guess to itself.

**Fix / rule:** the floor is now a named constant `LIVE_STORE_VERSION = '3.7.0'`, carrying
**where and when it was read** (App Store Connect, 2026-08-11), compared with a strict
numeric `>` rather than a major-version `>=`. Production is `4.0.0`. Proven by setting the
version back to `2.0.0` and watching it fail.

The general rule, which is the expensive part of this week: **a test that encodes an
assumption about the outside world must record where the value came from, or it is
documentation of a belief wearing the costume of a check.** Same shape as `ITMS-90054` (an
app id and a bundle id each correct, nothing relating them) and the duplicate task ids below
(a control that could not distinguish its subjects). Three green signals, three facts nobody
had verified.

The rest of the release config was swept for the same shape immediately afterwards — see the
audit entry directly below.

---

## 2026-08-11 — Audit: what else in the release config is a belief about the live app

**Context:** asked, after the two TestFlight causes, to sweep the release config for anything
else derived from an unverified assumption about the live apps. The test is not "is this value
wrong" — it is **"if this value were wrong, what would have told us?"**

**What the sweep found.** Everything about *iOS* is now verified, largely by accident: this
week's rejection named record `6749555467`, which incidentally confirmed the team id and the
production bundle id along with it. **Android is verified nowhere**, and that is where the
same defect is sitting.

| Value | Status | If wrong |
|---|---|---|
| `version` `4.0.0` vs App Store `3.7.0` | **Verified** 2026-08-11 | — |
| `ascAppId` / `appleTeamId` | **Verified** — Apple's own rejection referenced them | — |
| `ios.bundleIdentifier` | **Verified** indirectly, same rejection | — |
| **Live Play `versionCode`** | **Unknown — `E17-33`** | First Android submit rejected. `ITMS-90062` again, different error string |
| **Live Play `versionName`** | **Unknown — `E17-33`** | Assumed equal to iOS `3.7.0`; two listings hand-updated for 14 months drift |
| **`android.package` capitals** | **Unverified — `E17-35`** | New listing, zero installs. The test asserting it says so itself |
| `supportsTablet: false` | **Unverified — `E17-36`** | An update silently drops a device family |
| `ITSAppUsesNonExemptEncryption: false` | Correct — standard HTTPS is exempt | — |

**The one that matters is the Play `versionCode`.** Play rejects on the integer, not on the
marketing version, and `appVersionSource: remote` with `autoIncrement` mints ours from an EAS
counter that began at 1 for this project. The live Bubble app's `versionCode` is some number
nobody has read. **That is precisely `ITMS-90062`, already loaded, pointed at Android, and the
iOS fix does not touch it** — worse, the now-real iOS floor reads as though it covers "the
stores" and does not.

**Cause, common to all of them:** the repo asserts what *it* controls and is silent on what
the *outside world* controls. Both bugs this week lived in that silence.

**Fix / rule:** `LIVE_PLAY` in `app-config.test.ts` holds both numbers as `null` — not
guessed — with the assertions **already written and dormant**, so supplying a number turns the
check on rather than requiring anyone to remember to write one. This copies
`check-supabase-config.mjs`, which has always held `SUPABASE_PRODUCTION_REF` empty with the
comment "a wrong ref here would assert a healthy config on a project nobody is using". That
file had this right before either of this week's failures; the rest of the release config
should have copied it then.

A test also enforces that the two Play numbers arrive **together**, because the half-filled
state — a `versionName` typed from memory, no `versionCode` — looks covered and is not.

---

## 2026-08-11 — Eighteen task ids were used twice, and two `owner:andy` tasks went green because of it

**Context:** picking up the four compliance orphans the extended orphan guard found
(`E14-32`). Before starting I looked up `E20-11` and got two different tasks.

**What happened:** eighteen ids across eleven epic files were each defined twice —
`E20-11`…`E20-14`, `E20-26`, `E05-33`, `E05-34`, `E05-36`, `E06-16`, `E06-20`, `E09-11`,
`E09-12`, `E13-20`, `E15-07`, `E16-44`, `E17-27`, `E17-28`, `E00-20`. `E20-11` was both "the
policy acceptance gate is never mounted" and "data-processing review of every third party".

**Cause:** new work was appended by **reusing a number instead of continuing the sequence** —
exactly what `planning/README.md` forbids. It went unnoticed because nothing in the tooling
ever checked: `build-backlog.mjs` parsed both lines happily and emitted two rows with the same
`data-id`.

**The consequence that matters:** task ids are the primary key of `backlog-state.json`. A
single `done` row cannot describe two tasks, so ticking one ticked both — and `E09-11` and
`E17-28` were `(owner:andy)` tasks showing **complete** because an unrelated twin had been
finished. `sync-state.mjs` refuses to close an `owner:andy` task, and that enforcement was
defeated by an id it could not tell apart. A control that cannot distinguish its subjects is
not a control.

**Fix / rule:** the later copy of each duplicate was renumbered to the next free id in its
epic (document order is assignment order, because the backlog is append-only); the original
kept its id, so every existing cross-reference to the older meaning stayed correct.
`build-backlog.mjs` now **refuses to build** on a duplicate id and names both users — proven
by reintroducing a collision and watching it fail. Ticks were rebuilt from each line's own
checkbox, so nothing was lost and nothing was invented.

Related: [`E17-32`] and the version floor below. Three defects this week share one shape — a
green signal standing in for a fact nobody checked.

---

## 2026-08-10 — A git worktree with a symlinked `node_modules` silently tests the wrong workspace

**Context:** building the recipients UI (`E05-17`, `E05-18`) in a `git worktree`, with
`node_modules` symlinked to the main checkout's rather than reinstalled — the usual trick for
not paying an npm install per worktree.

**What happened:** a new export from `packages/shared` typechecked, and the shared package's
own vitest suite passed, but every mobile jest test using it failed with
`api.fetchRecipients is not a function`.

**Cause:** npm workspaces link `node_modules/@graybag/shared` to `../../packages/shared`, and
that link is **relative to the symlink's own directory** — which is the main checkout. So
`worktree/node_modules` → `main/node_modules` → `main/packages/shared`. The mobile tests were
importing the shared package from `main`, not from the worktree, and would have kept doing so
however many times the worktree's copy was edited. TypeScript did not notice because
`tsconfig` resolves the workspace by a *relative path*, which does stay inside the worktree —
so typecheck saw the new code and jest did not.

**Fix / rule:** do not symlink `node_modules` wholesale in a worktree. Make it a real
directory and symlink the entries *individually*, then point `@graybag/*` at the worktree's
own `packages/` and `apps/`:

```bash
mkdir -p node_modules/@graybag
for e in "$MAIN"/node_modules/*; do ln -s "$e" "node_modules/$(basename "$e")"; done  # skip @graybag
ln -s "$PWD/packages/shared" node_modules/@graybag/shared
```

**The part worth remembering:** the failure mode is not "it does not work", it is "half the
toolchain sees your change and half does not". A green typecheck over a stale runtime is
worse than a broken install, because it looks like the code is wrong rather than the
resolution.

**Also found:** `.gitignore` has `node_modules/` with a trailing slash, which matches a
directory and **not a symlink of the same name**. The first commit of this branch therefore
staged two `node_modules` symlinks without a murmur. Worth fixing to `node_modules` if
worktrees stay part of the workflow.

---

## 2026-08-09 — A binary parser with a wrong base offset does not throw, it lies

**Context:** `E06-32`, writing a reader for the binary `AndroidManifest.xml` inside an APK so
the UPI `<queries>` block could be asserted against the built artefact rather than against the
config that is supposed to produce it.

**What happened:** the first run against the real `E19-01` spike APK reported
`android:scheme="upi"  MISSING`. Taken at face value that would have been a significant
finding — it would have meant `com.razorpay:standard-core` does *not* supply the block after
all, contradicting spike finding A3 and changing what `E06-29` had to do.

**Cause:** an off-by-16 in my own parser. In AOSP's `ResXMLTree_attrExt`, `attributeStart` is
an offset **from the start of that struct** — which begins after the 8-byte chunk header and
the 8 bytes of `lineNumber` + `comment` — not from the start of the chunk. Using the chunk
start as the base shifted every attribute by 16 bytes.

**The part worth remembering:** it still parsed. Every length was plausible, every string index
resolved to a real string, and the output looked like a manifest — attributes named `label` and
`icon`, namespaces that were actually element names. A length-prefixed binary format read at
the wrong offset does not usually fail; it produces confident nonsense. The structure (element
names, nesting, counts) was *correct*, which made it more convincing still.

**Fix / rule:** never report a finding from a freshly written binary parser without first
asserting a **known-good** value through it. Here that was `versionCode`, `package` and the
namespace URI on the root element — all independently knowable. Once those decoded correctly
the `upi` scheme appeared exactly where A3 said it would. The tests now build their own AXML
fixtures with an encoder rather than trusting a checked-in APK, because writing the encoder is
what forces the struct layout to be stated explicitly instead of assumed.

Corollary for any spike result: a negative result from new tooling is a claim about the
tooling until the tooling has been shown to produce a known positive.

---

## 2026-08-09 — An experiment that cannot distinguish its two outcomes is not a pending result

**Context:** `E19-01`'s central question — does Razorpay's checkout show a UPI **app chooser**
listing installed PSP apps, or does it silently degrade to collect/QR?

**What happened:** the handset session could not answer it. The test device had a single UPI
app installed, so Android went straight into that app rather than presenting a list. That
observation is equally consistent with "the chooser works and had one entry" and "the chooser
is empty and something else handled the intent".

**Cause:** the experiment's design assumed at least two PSP apps — the runbook says so in §2.0
— and the one variable that made it decisive was the one nobody could guarantee about someone
else's phone.

**Fix / rule, and this is the transferable part:** the result was **closed by construction
rather than by re-running the experiment**. The plugin under test costs nothing to enable
permanently (`<queries>` entries are declarations, not permissions — no runtime cost, no
prompt, nothing to disclose in a store listing), so turning it on unconditionally makes the
distinction irrelevant. A day of chasing a second handset would have bought an answer to a
question that no longer needed answering.

Ask, when a spike returns ambiguous: *is the answer worth more than making the question moot?*
It usually is not, when the "fix" is free and already written. Where the answer genuinely was
worth having — is the block present in a shipped artefact at all — the check moved to
`scripts/verify-apk-upi-queries.mjs`, which answers it on every build instead of once.

A footnote that mattered: once the artefact check existed, running it against the spike APK
showed that build's manifest *did* carry the scheme query. So the chooser had visibility, the
single installed app was the whole explanation, and the follow-up experiment (B3, "does
enabling the plugin fix it") could never have returned anything.

## 2026-08-09 — Three traps in the Expo 57 test harness, all of which look like broken components

**Context:** `E14-01`, standing up `apps/mobile` with a component test runner so `E13-03` can
build the component library.

**What happened / cause / fix — three separate things, in the order they bit:**

**1. `jest-expo@57` is on the jest _29_ line, not 30.** Its dependencies are `babel-jest@^29`,
`@jest/globals@^29`, `jest-environment-jsdom@^29`. Installing `jest@^30` alongside it left
`jest-runtime@30` driving `jest-environment-node@29`, and the symptom was
`TypeError: this._moduleMocker.clearMocksOnScope is not a function` — thrown from jest's own
internals, naming nothing you wrote, on **every** suite. **Rule:** pin `jest` to the line
`jest-expo` depends on, and check with
`node -p "require('./node_modules/jest-runtime/package.json').version"` against
`jest-environment-node`. A mixed jest install never says "mixed jest install".

**2. `@testing-library/react-native/extend-expect` no longer exists** (removed in v12.4; the
matchers are built in and self-register). Most tutorials still import it. The failure is
`Cannot find module` **from the setup file**, so every suite fails to run and none of them are
the one at fault.

**3. Reanimated 4 must NOT be mocked in jest, and the tutorial setup throws.** Every guide
shows `jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))`.
On Reanimated 4 that mock imports the real index, which pulls in `react-native-worklets`,
which reaches for a native module jest does not have —
`TypeError: Cannot read properties of undefined (reading 'loadUnpackers')`, thrown from deep
inside `node_modules` with your setup file as the only frame you recognise. **The fix is a
resolver, not a mock:** `"resolver": "react-native-worklets/jest/resolver.js"` in the jest
config. It strips `.native` extensions for that one package so jest resolves the non-native
implementation. Animations then genuinely run under test, which is what `S27` requires —
`resolveDuration` returns `duration.instant` rather than skipping, so completion callbacks
still fire and a component whose state advance hangs off one still works.

**4. `render` is async on RNTL v14 — it returns a Promise.** React 19's concurrent root commits
outside the synchronous call, so the v13 pattern `const { getByTestId } = render(<C />)`
destructures a Promise and yields `undefined`. The two symptoms are
`TypeError: getByTestId is not a function` and, via the `screen` singleton,
**`render function has not been called`** — which is actively misleading, because you did call
it. **Rule: every `render` in `apps/mobile` is awaited.** `await render(<C />)` then query
through `screen`. This applies to every component test `E13-03` writes, which is why it is
here rather than in a comment in one file.

**The general shape.** All three present as "the component is broken" when the component is
fine and the harness is misassembled. When a *brand-new* test setup fails, suspect the harness
before the code — and read the version constraints of the preset rather than the latest
version of each package, which is what npm gives you by default.

---

## 2026-08-09 — `ECONNRESET` is a transport failure, not a payload-size symptom

**Context:** `docs/decisions.md` had grown to 98 KB and was being read into context on every
task. The working theory was that the oversized request was causing the `ECONNRESET`s on Andy's
network, so splitting the file would fix both problems at once.

**What happened:** the file was split (`DOC1`) and the context cost came down about 90%. The
theory about `ECONNRESET` was still wrong.

**Cause:** `ECONNRESET` means the peer sent a TCP RST — the connection was torn down by the
other end or by something in the path. It comes from TLS negotiation failures, idle-timeout
kills on an intermediary (home router, corporate proxy, VPN, CGNAT), flaky Wi-Fi, or MTU/
fragmentation problems. **An oversized-but-valid HTTPS request body does not produce it**; a
payload the server dislikes produces an HTTP status — `413`, `429`, a 4xx — not a reset. Size
and resets are independent variables that happened to be observed together.

**Fix / rule:** **Do not diagnose a network error from an application-layer symptom.** When
`ECONNRESET` appears, look at the transport: try a different network (tether to a phone — this
single test separates "my path" from "their service" faster than anything else), check whether
a VPN or proxy is in the path, check MTU, and check the provider's status page. Reducing
payload size is a fine thing to do for cost and latency — it was worth doing here on its own
merits — but crediting it with fixing a reset means the real cause stays unfixed and comes
back. Recorded because the wrong road is genuinely tempting: both facts were true at the same
time, and one of them looked like it explained the other.

---

## 2026-08-09 — A 21.8 MB PDF was recorded as "unreadable" for two sessions; it reads 20 pages at a time

**Context:** `E13-15`. `00_Graybag_Brand Guidelines.pdf` is the authority the whole token file
defers to, and `docs/design-tokens.md` §1, `docs/open-questions.md` `DS-05` and the `E13-15` task
text all said the same thing: 21.8 MB, over the file-read limit, and `magick` / `qlmanage` /
`sips` could not be executed in the overnight sandbox. The token file carried "provisional" in
its status line because of it.

**What happened:** the file read without difficulty. The Read tool takes a `pages` parameter and
renders a page range — 40 pages in two calls of 20. The size limit that applies to a text read
does not apply to a paged PDF render, and no rasteriser of our own is involved.

**Cause:** the blocker was real *in the sandbox it was discovered in* — an overnight run with no
subprocess execution — and it was written down as a property of the file. Two sessions then read
"could not be read", believed it, and worked around it. Nobody re-tested the assumption in the
environment they were actually in, because it was recorded as a fact rather than as an
observation with a context.

**Fix / rule:** **when a blocker is recorded, record the environment it was observed in, and
re-test it once in the current environment before planning around it.** The cost of re-testing
was one tool call; the cost of not re-testing was `docs/design-tokens.md` sitting provisional
through Blocks 3 and 4 and `E13-13`/`E13-14` being ordered behind it. The specific fact worth
keeping: **large PDFs in this repo are readable via `Read` with `pages`, up to 20 pages a call**
— which also applies to anything else in `Legacy-Application/`, none of which has been opened.

Second, smaller finding, and the reason this was worth doing at all: reading the brand document
found a contradiction that had been sitting inside `docs/design-tokens.md` since it was written.
§3.2 said "**12 is the floor.** Nothing in the product is smaller" one line below a table that
set `overline` to 11. An external source forced a line-by-line re-read of a document everyone had
already accepted, and that is what surfaced it — not the source itself.

---

## 2026-08-08 — A payment SDK's manifest is three artefacts deep, and unpinned

**Context:** setting up `E19-01`. Before burning an EAS build and a handset session, checked
statically whether `react-native-razorpay` supplies the Android 11+ `<queries>` block that UPI
intent needs.

**What happened:** the RN wrapper's `AndroidManifest.xml` declares only `CheckoutActivity` — no
`<queries>` — which appears to confirm `docs/payments-design.md` §3.3 and make `E06-29` real
work. Two levels down it is the opposite: `com.razorpay:checkout` is a near-empty wrapper AAR
whose POM pulls in `com.razorpay:standard-core`, and *that* manifest declares `<queries>` with
`scheme="upi" host="pay"`. Manifest merging means the block is probably already there.

**Cause:** "does this library declare X in its manifest?" is not answerable from the library.
Android merges manifests transitively, so the question is only ever answerable about the
**merged** manifest of a real build artefact. Reading the top-level package's manifest and
stopping produces a confident wrong answer in both directions.

**The part that actually matters:** `checkout`'s POM declares `standard-core` at version
`LATEST`. A payments SDK is entering the app on a floating version — two builds a week apart can
embed different code, and the `<queries>` block we might rely on can change with no diff on our
side and nothing in a lockfile. That turns `E06-29` from "add the block" into "assert the merged
manifest still has a block we do not control" (`E06-30`) plus "pin the version" (`E19-08`).

**Fix / rule:** verify manifest questions against the **merged** manifest, and check the POM for
floating versions on anything in the payment path. Cost about twenty minutes of `curl` against
Maven Central and answered three checklist rows without a device — worth doing before any spike
that needs a build and a handset, not after.

**Second, smaller:** the same wrapper asks for `com.facebook.react:react-native:+`, a coordinate
that stops at 0.71.0-rc.0 on Maven Central; current RN publishes as `react-android`. RN's Gradle
plugin substitutes it, which is why such libraries still build — but it is the first suspect if
the build fails, and worth recognising on sight rather than debugging from scratch.

---

## 2026-08-07 — Why the overnight corpus contained these contradictions (from the Q15 review fixes)

**Context:** Q15 read fourteen unattended runs (~18,000 lines of spec, ~4,200 of SQL) against each
other for the first time; five agents fixed the affected docs/migrations. The defects clustered, and
the clusters have named root causes worth not repeating. One crisp lesson each, with the *why*:

1. **A guard described by prose position is not a guard placed by transaction position.** The invoice
   placeholder guard was written as firing at "the post-capture step" — but auto-capture (`OL-01`)
   means the money is already gone by then, so it stranded every captured payment. **A guard whose
   job is to *prevent* an action must be shown to run before that action's irreversible step**, not
   merely somewhere in the prose. Re-check every "refuse/abort" against where in the txn timeline it
   actually executes.
2. **An enum value goes dead when its only writer collapses two cases into one code.**
   `order_group_status = 'payment_failed'` was unreachable because the sweeper wrote
   `checkout_expired` for both "failed" and "never started". **A status a derivation table can hold
   needs at least one code path that produces its precondition — and a *reachability* test, not just
   a transition-correctness test.** (Scenario 5 was that test, written before the producing path.)
3. **Double-entry hides sign bugs.** Every transaction summing to zero (I10) makes a wrong-signed
   `balance()` invisible until you total a single account. **Define the ledger sign convention per
   account type once and explicitly, and test that a credit-normal and a debit-normal account give
   opposite signs from the same posting.** Never ship a single-sign helper.
4. **"Uptime" ≠ "the cron ran".** Pointing a liveness requirement at an uptime monitor is a category
   error: a silently-stopped cron produces *silence*, not a failed probe. **Job liveness needs a
   heartbeat-overdue alert, separate from uptime and from error alerts.**
5. **A "normative + repeated" table drifts when the copy is edited but the source is not.** dpdp
   §2.2 gained two tier rows the normative `data-model.md` §13.3 never got. **When one doc declares
   itself normative and another repeats it, the copy must add no rows — any addition goes into the
   source first** (ideally the consumer is generated from / lint-checked against it).
6. **Forward task-ID references rot when a doc cites IDs a *later* run will mint.** Q12 reserved a
   range; Q13/Q14 took it, and every forward reference — including a whole pre-submission checklist —
   silently came to mean a different task. **Cite by description/placeholder, or allocate the ID in
   the backlog first; never cite an ID you are yourself minting for a later run.**
7. **A spec's "work to do" list that is not updated when the work lands produces phantom findings.**
   The review "found missing" three authz controls (`effective_config_public()`, the §10 revokes,
   the tripwire) that were already in `0002`, because `authorization-model.md` §14 still said "work
   this document creates". **A spec that lists work must be updated in the same PR that does the work,
   or it becomes a source of false findings.**
8. **Anchored greps lie about SQL inside `do $$` blocks.** `grep -c '^revoke\|^grant'` returned 0 on
   a file with 25 revoke/grant statements — Supabase idiom indents them, wraps them in `do $$`, or
   issues them via `execute format(...)`. **A "does this migration contain X" check must be
   case-insensitive and not anchored to column 0 — and reading beats grepping for a control.**
9. **A pipeline written for one scope, reused for another, silently over-reaches.** The DPDP erasure
   pipeline was authored for whole-*account* deletion, then pointed at a single-*child* consent
   withdrawal — unscoped, it would anonymise the parent and delete the sibling. **Any "run the
   pipeline" reference must state its scope, and the erasure function needs a test that a
   recipient-scope run leaves parent + siblings byte-for-byte unchanged.**
10. **A published policy must not promise retention for a table that does not exist.** privacy §6 and
    dpdp §6.2 both scheduled "OTP records — 90 days — delete", but there is no `otp_attempt` table —
    OTP state lives in Supabase's managed `auth`/GoTrue schema our purge job cannot reach. **Every
    retention row and customer-facing retention line must name a table/vendor that exists and that
    some job actually enforces;** vendor-held data is described as vendor-governed, not as ours.
11. **Contrast ratios must be recomputed with the formula CI will use, and role maps validated
    against real fills.** §2.3's "3.25:1" was correct in value but attached to the wrong token
    (`forest-600`, actually 2.57, vs `forest-700`), and `neutral-500` was justified against white
    then paired with a `neutral-100` fill it fails on. **Reproduce every contrast number with the
    same formula `E13-13` uses, state both hexes, and walk the role map against every background it
    is actually composed with — not against white only.**
12. **Clock offsets must be re-derived from the single anchor in one pass.** The runbook had T+14h
    right (Sat 12:00) but everything from the soak on was 24h short (T+32h labelled Monday 06:00,
    actually T+56h), and Phase H claimed an 18h span for a 42h period. **Derive every offset from the
    one T-0 anchor in a single pass and check weekday + clock + delta together, rather than editing
    one row.**
13. **A migration running as `system` cannot use actor-gated transitions.** `NULL→draft` is admin-only
    (`orders.create_on_behalf`), so a `system` backfill cannot legally produce `draft`; with invariant
    I12 (no draft rows) any "map legacy state → draft" is doubly wrong. **A migration status map must
    target only statuses reachable by the actor the backfill runs as.**

## 2026-08-07 — Break-glass and a live data exposure are the same 30 days, and nobody had written that down

**Context:** Q14, writing `docs/cutover-runbook.md` and reconciling `R3` (keep Bubble 30 days as
break-glass) against `[DP-03]` (the legacy Bubble exposure may be a notifiable breach).
**What happened:** `R3` and `[DP-03]` turn out to be in direct tension. Keeping Bubble read-only for
30 days as rollback insurance keeps the publicly-readable `Order`/`Child` surface — the exposure
`[DP-03]` is about — live for 30 more days. The break-glass insurance *is* the exposure.
**Cause:** The two decisions were made in different documents for different reasons and neither
mentioned the other. Break-glass is a release-safety property; the exposure is a compliance property;
they touch the same running Bubble instance.
**Fix / rule:** The runbook resolves it by **locking the public Bubble Data API at freeze while
keeping data readable to authenticated admin for support** — so break-glass does not mean "keep the
exposure running". Whether Bubble permits that split is unverified (`[CO-02]`), and `E17-15` owns the
lockdown independently of the read-only decision. General rule, same family as the `M5`/`[DM-18]` and
`OL-05` interactions: **when two decisions touch the same running system for unrelated reasons, state
the interaction explicitly — the tension is invisible in either document alone.**

## 2026-08-07 — The in-flight-order problem shrinks to almost nothing if the freeze lands on a non-service day

**Context:** Q14, deciding how the cutover weekend drains live money and fulfilment state.
**What happened:** The obvious fear — orders and payments moving through the system at the moment of
cutover — turns out to be small in the current cities, because they do not serve food on weekends. No
`service_date` falls inside a weekend freeze, so the only live-money surface is *future-dated* paid
orders and *pending* Bubble payments. Both can be drained on Bubble before the migration snapshot
rather than migrated mid-flight.
**Cause:** The in-flight surface is a function of *when* the freeze lands, not of the migration
mechanics. A freeze that begins after the last weekday cutoff has passed has no service day inside it.
**Fix / rule:** The freeze begins only **after the last weekday order cutoff has passed** (`R6`), and
in-flight Bubble payments are **drained on Bubble, not migrated as live state** (`R7`, `E17-14`) —
settle-or-fail before the snapshot, anything still pending reconciled by hand against Razorpay. Two
related cutover-day loads that are operational rather than code: OTP re-login is a **comms campaign
with a technical backstop** (`U2` re-auth is unavoidable; the risk is a user not knowing and churning,
mitigated by `E17-16`), and `E03-11`'s ambiguous-phone-match `migration_review` queue will have real
rows Monday morning that someone must work or those families cannot log in (`E17-17`).

## 2026-08-07 — A rotation policy without "what breaks during the window" is half a policy

**Context:** Q13, writing `docs/secret-rotation-policy.md` and `docs/testing-strategy.md`.
**What happened:** The dangerous secret in this stack is the Razorpay **webhook secret**. It is
callee-verified and the handler returns `200` to a bad signature (correctly, per `PY2`), so a naive
swap silently drops every event signed with the old secret between the two changes — no 5xx, no
Razorpay retry, no signal. This is the same blind spot as the "record it and return 200" webhook
learning; rotation walks straight into it.
**Cause:** Secrets come in two shapes and only one rotates atomically. **Caller-initiated** secrets
(key secret, SMS key, API tokens) swap between requests with zero downtime. **Callee-verified**
secrets (webhook secret, JWT signing secret) cannot swap atomically with respect to in-flight
messages and need an overlap window. Filing every secret into one of these two buckets makes each
rotation procedure obvious.
**Fix / rule:** The dual-secret (`_PREVIOUS`) window plus `E06-28`'s alert are the mitigations for the
webhook secret, and both are load-bearing — captured in the policy and the testing doc. Two further
constraints recorded there: **payment paths are testable in CI without live keys** (a provider stub
authored from `docs/payments-design.md` §12 — HMAC verification, idempotency via replay against real
Postgres constraints, and the dual-secret rotation path are all offline-testable), **but the stub
encodes assumptions until `E19-01` returns** and must be corrected to reality then — native UPI intent
is *not* CI-testable and stays with `E19-01` on a real device. And the **authorization pgTAP suite
needs the GoTrue `auth` schema present** (`app_user.id` → `auth.users`, `auth.uid()` reads
`request.jwt.claims`), so CI must run `supabase start` — it cannot use a bare `postgres:16` image, a
real constraint on `E01-08`'s CI design.

## 2026-08-07 — The store data-safety label has no field for the S/P/A tiers, no "we don't collect X", and no child/adult distinction

**Context:** Q12, writing the App Privacy / Data Safety answers in `docs/store-submission.md`.
**What happened:** The store declarations traced one-to-one to the `docs/dpdp-compliance.md` §2.2
tier S/P/A model — mechanical once that spec existed (tier S = Health/allergies, tier P = child
name/class/section, tier A = adult phone/email/name). But three shapes the model relies on have
**nowhere to live on the store form**: (1) there is no child-vs-adult distinction, so children's and
adults' identifiers collapse into the same "data type" rows — the child-specific protection lives in
the app and the policy, not in the label; (2) there is no place to say "we deliberately do NOT
collect X" — yet the deliberate non-collection (no child DOB, no child photo, no precise location, no
advertising ID, no tracking) is what makes the label short: "No" to Tracking, Location, Advertising;
(3) "Data linked to you" (Apple) is decided purely by whether data sits against an account —
everything GrayBag collects is linked (there is an `app_user` row); Sentry crash data is the only
"not linked" candidate, and only because §5.3 + `PY8` + `E20-10` scrub all tiers out of it.
**Cause:** The store forms are a fixed taxonomy built for a general audience; the project's
protections are finer-grained than the form can express.
**Fix / rule:** Record it so nobody later tries to encode the S/P/A tiers into the store form (there
is no field for it) and so the absence of tracking/location/advertising is understood as an asset,
not an omission. Two hard cross-checks that fall out: **both stores require the declared collection to
match the linked privacy policy exactly** — the store answers were derived from
`docs/dpdp-compliance.md`, not the (then-nonexistent) `docs/privacy-policy.md`, so they must be
reconciled against the final policy before submission (`E17-19`, blocks `E17-04`); and Apple now
**mandates an in-app "account deletion" answer plus a web URL** for any app supporting account
creation — GrayBag has in-app deletion (`E03-08`), so the answer is "yes" and the URL points at the
Settings→Privacy / grievance flow (`E17-20`).

## 2026-08-07 — The refund policy is almost entirely already-decided; the privacy policy is almost entirely blocked

**Context:** Q11, drafting `docs/{privacy-policy,terms,refund-policy}.md` as templates for a lawyer.
**What happened:** The three documents pulled apart cleanly by how much is actually open. The refund
*mechanics* are fully pinned down by `docs/order-lifecycle.md` T10–T13 and `docs/payments-design.md`
§9 — the only genuinely open parts are two customer-facing values (`[PP-01]` cancellation window,
`[PP-02]` post-delivery stance). The privacy notice, by contrast, is provisional almost end to end on
`E20-01` (legal entity, DSR deadlines, breach timelines, cross-border, RBI PPI, jurisdiction) plus
the `E20-21` grievance identity and the `E00-10` invoice values.
**Cause:** Refund behaviour is a property of the system we built and already specified; the privacy
notice is a set of legal claims we are not qualified to make. Same shape as Q10 — the machinery is
decidable now, the law is not.
**Fix / rule:** All `«…-PENDING-…»` tokens follow the `G3`/`E20-22` convention so **one CI check**
covers invoices, the grievance block and all three policies, and the token names **encode the owner
task** (`-PENDING-E20-01`, `-PENDING-E00-10`, `-PENDING-E20-21`, `-PENDING-ANDY`) so a reviewer sees
at a glance who unblocks each. Two facts that must survive legal review verbatim: **the invoice
carries a child's first name and survives erasure** (`G7` + `D15`), which the notice must disclose up
front, not bury (§6.6 of the compliance spec calls a buried disclosure "a complaint we caused
ourselves"); and the allergy disclaimer is the **top launch risk** (`[PP-03]`) — a food business
serving children that shows allergy warnings must address the duty-of-care surface head-on, and a
lawyer trimming either line for brevity would reintroduce the exact problem.

## 2026-08-07 — Soft-deleting a dependent makes their consent withdrawal permanently unrecordable

**Context:** Q10, writing the consent flow for `docs/dpdp-compliance.md`. The schema already
asserts the good half — adding a dependent writes the `recipient`, the `guardian_link` and the
`consent_record` rows in **one transaction**, so a child's record cannot exist without a
recorded basis.
**What happened:** Walking the *other* end of the lifecycle, the symmetric rule turns out to be
load-bearing and nowhere written. `consent_record_insert_self`'s `WITH CHECK` calls
`auth_can_manage_recipient()`, which requires `gl.revoked_at is null`, `gl.can_manage` **and
`r.deleted_at is null`**. So the instant a parent removes a child, no `withdrawn` row can be
written about them by any customer-facing path, ever. `current_consent` then reads `granted` in
perpetuity for a child who left the system a year ago — the precise opposite of what the record
exists to prove.
**Cause:** The policy was written for the question "may you record consent *about* this child",
which is a question about a **live** guardian relationship. Withdrawal is a different question —
"may you retract something *you* said" — and it survives the relationship ending. One predicate
was asked to answer both.
**Fix / rule:** Two changes. (1) **Removal writes the withdrawal in the same transaction that
sets `deleted_at`** (`C1`, `E20-16`) — the mirror of the creation rule, and it must be atomic for
the same reason. (2) Split the policy on `action` in `0003`: a `granted` row keeps the
`auth_can_manage_recipient` requirement, a `withdrawn` row is permitted where the caller is the
`user_id` of an existing grant (`E20-15`, `[DP-07]`). The same defect independently blocks a
co-guardian with `can_manage = false` and any guardian whose link was later revoked. **General
rule: for every authorization predicate on a consent or agreement table, check it against the
*retraction*, not only the grant.** The right to withdraw outlives the relationship that
conferred the right to give — this is the same family as `[OL-05]`, where a constraint that
correctly protects an invariant also prevents recording something that has already happened.

## 2026-08-07 — Accepting the privacy policy is not consent, and the two tables that say so look redundant

**Context:** Q10, deciding which gate blocks what.
**What happened:** `user_policy_acceptance` and `consent_record` read like two implementations of
the same idea, and the tempting simplification — one "I agree to the Privacy Policy" tick,
recorded once, treated as authority for everything — is one line of code away at all times and
would pass every test in the repo.
**Cause:** They answer different questions. `user_policy_acceptance` is a **contract** gate: has
this adult accepted the current terms, one row per user per version, driving `blocks_ordering`.
`consent_record` is a **processing** gate: is there consent for *this purpose* about *this
person*, one row per event, and it can legitimately be `withdrawn` for an optional purpose while
the account keeps working.
**Fix / rule:** `C4` — the two are never conflated, and the difference is visible in the seed
data: `allergen_health_data` is `is_required_for_service = false`, so "declined" is a **supported
end state** (no add-to-cart warning, and the UI must say exactly that), which a single contract
tick cannot express at all. Related trap in the same area: a new privacy-notice version does
**not** invalidate existing consents — only a change to a *purpose's meaning* does, and that is
why `consent_purpose` rows are immutable and a changed purpose is a new row plus `superseded`
(`C2`). Generalises: **when two tables look redundant, write down the question each answers
before merging them** — here the redundancy is the compliance property.

## 2026-08-07 — `retention_policy` cannot express "keep this, by law", which is the answer for the rows that matter most

**Context:** Q10, drafting the §6.2 retention schedule so `E20-05` seeds a table rather than
inventing one.
**What happened:** `retention_policy` has `check (action in ('delete', 'anonymise'))` and
`retention_days integer not null check (> 0)`. There is no way to record *"the invoice, the
ledger and the consent record are retained indefinitely, and here is the basis"* — which is
exactly what `D15` decided and what the accountant will confirm. Forcing it into the existing
shape means writing `action = 'delete'` with a large day count, i.e. asserting that we destroy
invoices in year eight, which may well be wrong.
**Cause:** The table was designed for *purging*, and the purge cases were the ones enumerated.
"Retained by law" is not a purge case, so it has no vocabulary — the same shape as `[PAY-05]`,
where `ledger_transaction.reason_code` had eight seeded values and not one of them named a money
movement.
**Fix / rule:** `E20-13` in `0003` — add `'retain'` to the allowed actions and make
`retention_days` nullable for it. Second gap found alongside it: the table is keyed on `entity`
(a table name), so a **column-level** rule ("null the three tier-P snapshot columns on `"order"`,
keep the row") has nowhere to live; `E20-19` uses a documented `order.pii_snapshot` entity
rather than adding a `columns text[]`. **General rule, now hit twice: for every lookup or policy
table, write out one real row for every case the system will actually have — including the
"nothing happens" case — before believing the vocabulary is complete.** A missing enum member is
invisible in DDL review and unmissable the first time you try to insert.

## 2026-08-07 — "5% GST, split as 2.5% + 2.5%" is not one calculation, and doing it as one produces unequal halves

**Context:** Q09, fixing the CGST/SGST rounding rule for `E07-02`.
**What happened:** The obvious implementation — compute 5% of the taxable value, then halve it —
produces an invoice showing **CGST ₹3.12 and SGST ₹3.13** on a ₹125.00 line. Two identical rates
on an identical base, printing different numbers.
**Cause:** There is no statutory "5%". CGST at 2.5% and SGST at 2.5% are two separate levies on
the same base, filed separately in the return; 5% is a display convenience. Computing the total
first rounds once and then splits an odd number of paise, and the odd paise has to land
somewhere.
**Fix / rule:** Compute **each component independently from the taxable value** and round each
half-up. The halves are then always equal, and their sum can be a paise either side of 5% of the
base — `12,500 × 2.5% = 312.5 → 313` twice is 626, where 5% of 12,500 is 625. **That divergence
is correct arithmetic, not a bug**, and it goes both ways: on ₹62.50 the components round *down*
to 156 each (312) while the naive 5% rounds *up* to 313. `tax_total` is therefore *defined* as
`cgst + sgst + igst` everywhere and is never computed from a 500 bps rate. `G2`.

## 2026-08-07 — The invoice number format everyone writes down is 17 characters, and Rule 46 allows 16

**Context:** Q09, specifying the rendered form of `invoice.invoice_number`.
**What happened:** `GB/2026-27/000417` — carried as the example in `docs/data-model.md` §8.6 and
in the `0001` migration comment, and the shape anyone would reach for — is **seventeen
characters**. Rule 46(b) caps a tax invoice serial number at sixteen.
**Cause:** Nobody counts. The four-digit-plus-two-digit financial year is what does it: it costs
two characters more than the two-digit form for no added information.
**Fix / rule:** `GB/26-27/000417`, 15 characters. The prefix is deliberately **two** letters, not
three, so that a separate credit-note series (`[PAY-06]`) renders as `GBC/26-27/000417` at
*exactly* sixteen. Do not lengthen either prefix, do not restore the four-digit year, and assert
the length and character set on the rendered value in a test (`E07-19`) rather than trusting the
format string. Corrected in `docs/data-model.md`; the migration comment is stale and is a comment
only. `G9`.

## 2026-08-07 — Gapless numbering is a property of the series, not of the counter

**Context:** Q09. `D14` already fixed the allocation mechanism — a counter row locked
`FOR UPDATE`, not a `SEQUENCE` — so this looked finished.
**What happened:** Walking the failure modes, the counter turns out to guarantee only that no
*allocation* is wasted. It says nothing about whether every allocated number still appears on a
document. `DELETE FROM invoice` on one row, or one hand-edit of `last_sequence_no`, produces
exactly the hole the whole design exists to prevent, and neither goes anywhere near the
allocation path.
**Cause:** Conflating "the mechanism cannot skip" with "the series has no holes". They are
different claims and only the first was designed for.
**Fix / rule:** Five ways to make a hole, five named controls (`docs/gst-invoicing.md` §5.1). The
two that were missing are both triggers: **an `invoice` row can never be deleted** — a withdrawn
document is a credit note, and `status = 'cancelled'` keeps its number — and
**`last_sequence_no` may only ever increase, by exactly 1**. Plus a daily audit asserting
`count(*) = max(sequence_no)`, `min = 1`, and counter = max, which **pages rather than warns**: a
hole in a statutory series does not self-heal and is normally found a year later by an auditor.
`E07-14`, `E07-15`, `G8`.

## 2026-08-07 — Deriving the financial year in UTC files a 1 April invoice under the previous year

**Context:** Q09, `financial_year` on `invoice` and `invoice_sequence`.
**What happened:** An invoice issued at **05:20 IST on 1 April 2026** is 23:50 UTC on 31 March
2026. A UTC derivation files it under `2025-26` — after numbers already issued in `2026-27`.
**Cause:** The Indian financial year boundary is a local-midnight boundary, and IST is UTC+5:30,
so the first five and a half hours of every 1 April are the previous day in UTC. Postgres
`now()` is `timestamptz`; the bug is in the conversion, not the clock.
**Fix / rule:** Derive from `issued_at at time zone platform_config.timezone`, never UTC, never
`service_date` (an order paid on 30 March for food served on 2 April is invoiced in the year it
was paid). Test the boundary in **both** directions — 05:20 IST 1 Apr must be `2026-27`, 23:50
IST 31 Mar must be `2025-26`. Same family as the "midnight cutoff is a day earlier than it
reads" note below: every date boundary in this system is a local one. `E07-16`, `G9`.

## 2026-08-07 — Tax-inclusive pricing is blocked by a constraint nobody wrote for tax

**Context:** Q09, specifying the `price_is_tax_inclusive = true` path so that answering
`[DM-20]` would be a config flip.
**What happened:** It is not a config flip. `order_line` carries
`check (line_subtotal_paise = unit_price_paise * quantity)`, so under inclusive pricing
`unit_price_paise` has to be a *derived exclusive* unit price — and deriving per unit then
multiplying multiplies the rounding error by the quantity. Four ₹99.00 tax-inclusive dishes come
to **₹396.02**, and no arrangement of integers makes it ₹396.00 while that constraint holds.
**Cause:** The constraint is a perfectly reasonable arithmetic guard written from the exclusive
assumption. Rounding has to happen *somewhere*, and the constraint forces it to happen at the
unit, which is the one place where it gets multiplied.
**Fix / rule:** Raised as `[GST-01]`. Recommendation is to answer `[DM-20]` as exclusive; if it
comes back inclusive, derive the taxable value at the **line** and relax the constraint in
`0003` **before `E05` builds pricing**. The general lesson: when a document says an open question
is "supported either way by the schema", check that claim against the schema's `CHECK`
constraints and not only its columns. The columns did support it; a constraint three tables away
did not.

## 2026-08-07 — The menu Excel is not in the repo, and the `.bubble` file does not contain the data

**Context:** Q08, building `tools/menu-import/` to read
`.../GrayBag_School_Menu 1 1.xlsx` and answer `[DM-13]` from the real
allergen values.
**What happened:** There is no `.xlsx` anywhere under the repository — `find` for `*.xls*`
returns nothing. The obvious fallback, `Legacy-DB/gray-bag-23660.bubble`
(1.4 MB), turns out to contain no dish rows either: grepping it for "allergen" returns two
hits, both inside the terms-and-conditions *text*, not a field.
**Cause:** A Bubble export is the **application definition** — pages, workflows, option sets,
privacy rules — and not the database contents. `docs/legacy-bubble-schema.md` is derived from
it and describes types and fields, which is exactly what you can get from a definition. The
row data is a separate export that has never been taken (it is still open as "Bubble data
export" under *Blocked on Andy*).
**Fix / rule:** The importer is built and tested against the documented column list plus a
synthetic sample sheet, and `[MI-01]` records that `[DM-13]` **cannot** be closed by Q08.
Generalises: **before planning work that reads real data, confirm the real data is actually
present, not merely referenced.** Three separate documents cited that filename as though it
were in the tree. Cheap check, and it changes what a task can promise.

## 2026-08-07 — "No allergens" and "nobody filled the cell in" are the same JSON and opposite facts

**Context:** Splitting the `Allergens` column into structured tags (`D7`).
**What happened:** The first shape for a parsed cell was just `string[]` of allergen codes.
Walking the real cell values a school menu would contain — `Milk, Gluten`, `None`, `N/A`,
`-`, and a genuinely empty cell — every one of the last four produces `[]`.
**Cause:** An empty tag list is being asked to carry two meanings: *the kitchen checked and
there are none*, and *nobody told us anything*. Downstream, `E05-05`'s add-to-cart warning
reads that list, and the natural implementation — `if (!dish.allergens.length) return null` —
renders both as "no allergens", which is a false reassurance in the second case.
**Fix / rule:** `allergens_declared_none` is a stored boolean, true only for an explicit
"None"/"Nil"/"N/A"/"-"; a blank cell imports with no tags **and** an `allergens_blank`
warning. `MI1` in `docs/decisions.md`. Generalises, and it is a specific case of a general
trap: **when an empty collection can mean either "verified empty" or "unknown", it needs a
second field, because no amount of care at the read site can recover the difference.** The
same shape is worth checking wherever the migration lands a nullable list.

## 2026-08-07 — `parseFloat(price) * 100` is wrong for prices people actually type

**Context:** Converting the Excel `Price` column to integer paise (non-negotiable #3).
**What happened:** The obvious implementation, `Math.round(parseFloat(text) * 100)`, is
right often enough to pass a casual test and wrong in ways that matter. `179.99 * 100` is
`17998.999999999996`; `8.15 * 100` is `814.9999999999999`. `Math.round` rescues both, which
is exactly why the bug survives review — until a value lands where rounding goes the other
way, and a paisa is silently invented or lost on a line that will be summed into an invoice.
**Cause:** Doing decimal arithmetic in binary floating point, on a value that only exists in
decimal.
**Fix / rule:** Strings are parsed **decimally** — regex out the whole and fraction parts and
compute `whole * 100 + fraction`, so `"179.99"` is `17999` by integer arithmetic and no float
is constructed at all. Numeric cells cannot avoid a double (Excel hands us one), so they are
rounded to the nearest paisa **and rejected** if the value sits more than a rounding error
away from a whole paisa, rather than being quietly rounded. Two related traps handled in the
same function: Indian digit grouping (`1,20,500` — a comma-stripper written for `1,200`
handles it, one written as "remove every third separator" does not), and the non-breaking
space Excel pastes in front of `₹`, which makes a trim look like it worked when it did not.

## 2026-08-07 — "Record it and return 200" makes a misconfigured webhook secret completely silent

**Context:** Writing the webhook half of `docs/payments-design.md` (Q07). The rule from
`docs/order-lifecycle.md` §10.8 is right and stays: a bad signature is recorded with
`signature_verified = false`, acted on by nothing, and answered **`200`**, because a `4xx`
makes Razorpay retry a request we will never accept.
**What happened:** Walking the *wrong secret* case rather than the *attacker* case, that rule
produces a total outage with no signal at all. Every webhook fails verification. Every one is
recorded. Every one gets a `200`, so Razorpay stops retrying. No 5xx anywhere, Sentry quiet,
uptime green. Settlement still works for customers who stay in the app long enough for the
callback path — so the symptom is not "payments are broken", it is "*some* payments are late",
and it gets worse in exactly the proportion that UPI intent app-switches take, which is the
proportion nobody is watching.
**Cause:** The correct response to a hostile bad signature and the correct response to our own
misconfiguration are the same response, and the endpoint cannot tell them apart from one event.
**Fix / rule:** It cannot be told apart *per event*, but it is trivial in aggregate. `E15-05`
splits into two alerts off one column: a handful of failures against a background of successes
is probing (warn); **~100% failures since a deploy, or zero verified events in a window in
which orders were placed**, is our configuration (page). The second clause matters as much as
the first — it also catches a webhook endpoint that was never registered, which produces no
rows at all to compute a failure rate from. `E06-28`. Generalises: **whenever the safe response
to an attack is silence, add the aggregate that distinguishes the attack from your own
breakage**, because you have just built something that fails without complaining. Related trap
in the same handler: the HMAC is over the raw bytes, so `req.json()` and re-serialise never
matches — and that failure is 100% too, so it lands in exactly the same blind spot.

## 2026-08-07 — Double-entry was chosen, but nothing can be posted to the ledger yet

**Context:** Enumerating the ledger postings each payment path produces (Q07 §10), so that
`E06-07` could be written from a table rather than invented per handler.
**What happened:** Two independent blockers, both invisible until you try to write an actual
`INSERT`. (1) `ledger_transaction.reason_code` is `not null references reason_code(code)`, and
**not one of the eight seeded codes names a money movement** — there is no `sale`, no
`provider_fee`, no `wallet_hold`, no `settlement`, no `revenue_share`. So
`docs/order-lifecycle.md` §8.4 step 6, "post the sale to the ledger", has no legal value to
write. (2) `ledger_account_type` has no **bank or cash** account, so a settlement has nowhere
to land: `provider:razorpay:clearing` is debited on every capture and never credited. It grows
without bound, and the one query `[DM-03]` chose double-entry *for* — "does our clearing
account equal what Razorpay holds" — can never pass. `docs/data-model.md` §8.4 already assumes
that account exists ("payout … credits a bank clearing account"), so payouts are blocked on it
too.
**Cause:** The schema modelled the *structure* of double-entry completely and correctly, and the
seed data modelled only the vocabulary the order lifecycle needed (why an order stopped). The
`reason_category` enum even anticipates the split — `cancellation` / `refund` are the *why*
vocabulary, `ledger` is the *what movement* vocabulary — and `ledger` has exactly one member,
`migration_opening_balance`. A gap that looks like a design choice is very easy to read past.
**Fix / rule:** `E06-22` and `E06-23`, both in `0003`, raised as `[PAY-05]`. Note the migration
trap: `ALTER TYPE … ADD VALUE` cannot be *used* in the transaction that adds it, and a Supabase
migration file is one transaction — so the enum value lands in `0003` and its first use in
`0004`. General rule: **a schema review that only reads DDL will not find a missing seed row.
For every `not null references <lookup>` column, write out one real row of every kind the
system will insert and check the lookup actually contains the value** — a foreign key to an
under-seeded table is a runtime failure wearing a constraint's clothing.

## 2026-08-07 — `M5` has nothing to deduct from on the refund it was written for

**Context:** Working the MDR attribution for `E07-11`. `M5` is Andy's decision: the Razorpay
MDR lost on a refund comes out of the school's 10%.
**What happened:** Under `[DM-18]`'s assumed reading — the share is *earned on delivery* — the
overwhelmingly most common refund is an order cancelled **before** it was delivered. That order
earned the school nothing. There is no share for the MDR to come out of. A naive implementation
does not fail; it quietly nets the deduction against whatever else is in that school's payout
period, producing a line the school cannot reconcile to any order, or it silently deducts zero.
**Cause:** Two decisions made independently and each internally sound. `M5` fixes who bears a
cost; `[DM-18]` fixes when the thing that cost is deducted from comes into existence. Neither
mentions the other, and the interaction only appears when you try to compute a real payout line.
**Fix / rule:** Raised as `[PAY-04]` with three options and a recommendation (the platform
absorbs it on pre-delivery refunds, shown as a visible platform cost on the payout report).
`[PAY-04]` and `[DM-18]` must be answered **together**, and that is written into both. General
rule: **when a decision says "X comes out of Y", find the case where Y is zero.** There always
is one, it is usually the common case rather than the edge case, and the failure is arithmetic
that produces a plausible number rather than an error.

## 2026-08-07 — Android 11 package visibility silently downgrades UPI intent to the flow we are replacing

**Context:** Specifying native UPI intent for `E06-02` — the fix for the "clunky" hosted
payment-link redirect.
**What happened:** UPI intent requires the checkout SDK to enumerate which PSP apps (GPay,
PhonePe, Paytm, BHIM) are installed. Since Android 11, an app cannot see other packages unless
it declares them in a `<queries>` element in `AndroidManifest.xml`. Without it the app list
comes back **empty and without an error**, and checkout falls back to UPI *collect* or a QR —
which is slow, sits pending for minutes (the thing that makes `[OL-03]`'s TTL hard), and is a
worse experience than the flow being replaced. It will not reproduce on an Android 10 emulator
and it will not reproduce on iOS.
**Cause:** A platform privacy change whose failure mode is a silent empty list rather than a
permission error, meeting an Expo project where `AndroidManifest.xml` is *generated* — so the
declaration needs a config plugin and there is no file for anyone to notice is missing.
**Fix / rule:** `E06-29` owns the plugin (and the iOS `LSApplicationQueriesSchemes` half), and
it is item 2 on `E19-01`'s verification checklist. Two general points worth more than the fix.
(1) **The spike must run on a real Android 11+ handset in a development build**, not an emulator
and not Expo Go — `E19-01` currently says "a bare Expo app", and a bare *managed* Expo app
cannot host the native Razorpay SDK at all, so as written the spike would prove the wrong thing
(`[PAY-01]`). (2) **A capability that degrades gracefully is more dangerous than one that
fails**, because the degraded path works and ships. Ask of every fallback: would we notice in
production if the fast path never ran?

## 2026-08-07 — A refund cannot always honour its own destination

**Context:** Designing `E06-08` / `E06-09` against `M7` (refund to wallet by default,
refund-to-source as an option).
**What happened:** An order paid ₹50 from wallet and ₹160 from a card has **only ₹160 at the
provider**. "Refund ₹210 to source" is not partially possible — it is impossible, because ₹50
of it was never sent to Razorpay. And `refund.destination` is a single enum on a single row, so
one logical refund cannot express two destinations.
**Cause:** The destination reads like a property of the refund. It is really a property of
*where the money came from*, and the schema stores it on the wrong side of that relationship —
which is fine, as long as the handler knows it may need two rows.
**Fix / rule:** `PY5` — destination is a **request**, not a guarantee: the wallet-funded portion
goes back to the wallet, the rest to the requested destination capped at what source actually
captured, and one logical refund may produce two `refund` rows sharing a `correlation_id`.
`[PAY-02]`. Rejected alternative worth recording: splitting *proportionally* across both is
defensible in accounting and impossible to explain to a parent — "you paid ₹50 from your
balance and got ₹38 of it back". General rule: **any field naming where money goes needs a
check against where it came from**, and the answer may be "more rows", not "a different value".

## 2026-08-07 — `planning/backlog.html` cannot be regenerated in an unattended run

**Context:** Q06 appended eight tasks to `E05` and `E06`. CLAUDE.md requires
`node scripts/build-backlog.mjs` whenever the task *list* changes.
**What happened:** `node` is installed but every invocation returns "requires approval", which a
non-interactive run cannot obtain — the same sandbox limitation that stopped the PDF being read
in Q05, now hitting a step the repo's own workflow mandates.
**Cause:** Non-interactive session, Bash allowlist covering `git`, `ls`, `grep`, `find` and
little else.
**Fix / rule:** The markdown in `planning/backlog/` is the source of truth and is correct; only
the generated `backlog.html` is stale, and it is stale silently — it renders fine, it just does
not show the new tasks. **Any overnight run that appends tasks must say so in its summary so the
one command gets run by hand**, and this note is here so the next run does not spend time
rediscovering that `node` is unavailable. Either allowlist `node scripts/*.mjs` for the
overnight wrapper, or have `scripts/overnight.sh` run the build itself after each task — the
second is better, because it does not depend on a summary being read.

## 2026-08-07 — A uniqueness constraint that protects an invariant can also make reality unrecordable

**Context:** Specifying the duplicate-payment path (Q06, `E06-06`). `uq_payment_one_capture_per_group`
is `unique (order_group_id) where status = 'captured'` — `D16`'s guarantee that two payments
never settle one checkout.
**What happened:** Walking the actual scenario — attempt 1 is a UPI collect sitting pending, the
customer gives up and pays by card, attempt 1 then succeeds — the constraint does exactly what it
was written to do and blocks the second capture. Which means the one correct response, *record it
and then refund it*, is the single thing the schema forbids. The money left the customer's account
either way; we simply could not write it down.
**Cause:** The constraint encodes "one capture per group", but the invariant actually wanted is
"one **primary** capture per group". The two are the same until the outside world disagrees with us.
**Fix / rule:** Raised as `[OL-05]` with a `duplicate_of_payment_id` escape hatch as the
recommendation. The general rule is worth more than the fix: **a uniqueness constraint on a table
that mirrors an external system must not prevent recording something that system has already
done.** Razorpay is the system of record for whether money moved; our schema has to be able to
write down whatever it says, and only *then* decide what it means. Check every table in `§8` of the
data model against this — `uq_invoice_one_tax_invoice_per_group` is safe because we issue invoices,
but anything keyed on a provider's behaviour is suspect.

## 2026-08-07 — Payment webhooks are not ordered, and "set status from the event" silently downgrades

**Context:** Writing the webhook handling half of `docs/order-lifecycle.md`.
**What happened:** The obvious handler — `update payment set status = <the event's status>` — is
wrong in a way that leaves no trace. `payment.authorized` and `payment.captured` are separate
deliveries and can arrive in either order. The late `authorized` overwrites `captured`; the order
is already `paid`, the invoice is already issued, the customer already has their email. Nothing
looks broken until the `E06-11` reconciliation reports a captured payment the database calls
authorized, a month later.
**Cause:** Webhook delivery is retried and concurrent, so it is unordered by construction. Nothing
in the payload says "this is stale".
**Fix / rule:** `L3` — payment state moves on a **capture rank** (`created` 0, `authorized` 1,
`captured` 2), and an event implying a rank at or below the current one is recorded with
`processing_status = 'ignored'` and changes nothing. The refund axis is *derived* from completed
refunds rather than transitioned, because refunds are not on the same monotonic line. Generalises:
**any state driven by an external event stream needs an ordering key of its own, and it must come
from the state's own semantics, not from the event's timestamp** — provider clocks are not ours,
and a retry carries the original timestamp anyway.

## 2026-08-07 — "Midnight cutoff" is a day earlier than it reads, and it makes one config setting dead

**Context:** Working the cutoff edge cases for `E05-07`. The defaults are
`order_cutoff_time = '00:00'` and `order_cutoff_days_before = 0`.
**What happened:** `cutoff_at = (service_date − 0) at 00:00`, so the cutoff for Monday's lunch is
**00:00 on Monday** — order by Sunday night. Read quickly, "midnight cutoff" sounds like 23:59 on
the service day, which would be a full day wrong in the direction that puts unmakeable orders on
the kitchen's list. Second-order effect: `min_advance_order_days` defaults to `0`, which under this
cutoff can never be satisfied, because same-day ordering would need `now() < today 00:00`.
**Cause:** Two independent settings whose defaults interact. Neither is wrong; the pair is
misleading.
**Fix / rule:** The worked example is written into `docs/order-lifecycle.md` §9.3 (C5, C6) and into
the test matrix, so the assertion is "Monday's lunch closes at 00:00 Monday" rather than "the
cutoff works". `min_advance_order_days = 0` is documented as dead config under the default cutoff —
it becomes real only for a kitchen that sets a daytime cutoff. General rule: **when two config
settings compose into a single derived value, test the composition, not the settings**, and write
down which combinations are unreachable so nobody reads a `0` default as a feature being on.

## 2026-08-07 — A crashed documentation run leaves dangling forward references, and git makes it look finished

**Context:** Picking up Q05. `docs/motion-system.md` and `docs/design-tokens.md` both already
existed, complete, at 661 and 537 lines, committed as `cd2496f`.
**What happened:** The commit message said `Result: FAILED`, and the log contained one line:
`You've hit your session limit`. The two documents had landed; **everything they pointed at
had not.** They referenced `DS-01`…`DS-04` in `docs/open-questions.md` (no such section),
decision `S4` in `docs/decisions.md` (no such decision), and tasks `E13-11`, `E13-13`,
`E13-14`, `E13-15` (the epic stopped at `E13-10`). Every one of those was a promise to a
reader that resolved to nothing.
**Cause:** Documents get written before the entries they cite, because you cite the ID before
you create it. The overnight wrapper commits the working tree whatever the outcome, so a run
that died two-thirds through is indistinguishable in `git log --stat` from one that finished.
**Fix / rule:** **A document is not done when it reads well; it is done when every reference in
it resolves.** Before closing out any doc task, grep the new file for the ID shapes it uses
(`DS-`, `DM-`, `AZ-`, `S`/`D`/`A`-series, `E\d\d-\d\d`) and confirm each one exists in the file
it claims to be in. Cheap to check, and a dangling reference is worse than no reference — it
tells the reader a decision was made somewhere when it never was. Corollary: `Result: FAILED`
in a commit message means **the follow-through is missing**, not necessarily the deliverable.
Read the log before assuming either.

## 2026-08-07 — The GrayBag brand green cannot carry white text, and neither can most brand greens

**Context:** Extracting design tokens from `Graybag_Design Package`. Every primary button,
every price and every field label in the nine `06_App UI` mocks is white on `#00af52`.
**What happened:** That pair measures **2.90:1**. It fails AA for normal text (4.5:1), fails
AA for *large* text (3:1), and fails the 3:1 non-text-contrast rule that applies to a control's
own boundary. Mock 02 compounds it with a `#145f48` button on a `#00af52` field: **2.63:1**.
**Cause:** A saturated mid-green sits in the worst part of the luminance curve for this. The
sRGB coefficients weight green at **0.7152** — more than red and blue combined — so a green
that *looks* deep enough to take white text carries far more luminance than the eye credits it
with. `#00af52` has a relative luminance of 0.313, which is nearly mid-grey. The same hex would
be judged "dark" by anyone eyeballing it.
**Fix / rule:** The **500 rule** (`S6`): the supplied hex stays the identity colour and is never
ink; functional green is one or two steps darker (`primary-700 #007e3b` = 5.19:1). Generalise
it — **never take a brand palette's contrast on trust, and be most suspicious of the greens and
yellows.** `#ffbb39` on white is 1.69:1, effectively invisible. Compute the ratio for every
supplied hex before designing anything with it; doing it after there are components is a
repaint of the whole product. `E13-13` makes it a CI assertion so a brand refresh fails the
build instead of shipping.

## 2026-08-07 — Multiplying a brand hex preserves its hue; "darkening" it by eye does not

**Context:** Building a tonal ramp around `#00af52` with no tonal steps supplied in the package.
**What happened:** Hand-picked darker greens drifted — the obvious candidates read as either
olive or teal next to the logo, which is exactly the failure that makes a ramp look like it
belongs to a different brand.
**Cause:** Darkening by adjusting HSL lightness, or by eye in a picker, changes the ratio
between the R, G and B channels. Hue in the perceptual sense is carried by those ratios.
**Fix / rule:** Derive shades by **multiplying every channel by the same factor** and tints by
**mixing toward white**, both of which hold the channel ratios and therefore the hue. `#009646`
and `#007e3b` are `#00af52` multiplied, not chosen. Corollary worth knowing: this is also why
`#145f48` is *not* a step on the primary ramp and gets its own name (`forest`) — it is a
genuinely cooler, bluer green, and pretending it is `primary-800` would be a lie the ramp
would keep telling.

## 2026-08-07 — The brand guidelines PDF is unreadable in this environment, and the tokens rest on that gap

**Context:** `00_Graybag_Brand Guidelines.pdf`, the one source that would say whether the
palette has official tints, a type scale or usage rules.
**What happened:** 21.8 MB — over the file-read limit. `magick`, `qlmanage` and `sips` are all
installed, and `node` and `python3` are on the machine, but **none of them could be executed**
in the sandbox this ran in; every invocation returned "requires approval", which an unattended
run cannot obtain.
**Cause:** Non-interactive session plus a Bash sandbox allowlist that covers `git`, `ls`,
`cat`, `grep`, `find` and little else.
**Fix / rule:** Two things. (1) **Assume nothing that needs a binary to verify will be
verifiable in an overnight run** — plan the work so the un-runnable part is isolated and named
rather than discovered at the end. Contrast ratios here were confirmed by hand-computing four
load-bearing pairs against the WCAG 2.1 formula, which is enough to establish the table was
computed rather than guessed, but is not a substitute for `E13-13`. (2) The unread PDF is
tracked as `DS-05` / `E13-15`, not left as a silent assumption. **The brand document wins on
anything about the brand**, so the token file is provisional until someone opens it.

## 2026-08-07 — A failing RLS `USING` clause does not raise; it silently filters

**Context:** Writing `supabase/tests/authorization.test.sql` (Q04), asserting that a
co-guardian with `can_manage = false` cannot edit a child.
**What happened:** The obvious test — `throws_ok('update recipient set first_name = …',
'42501')` — is wrong, and would have failed. An `UPDATE` whose policy `USING` clause is false
does not error: the row is simply not visible to the statement, so the `UPDATE` succeeds and
touches **zero rows**.
**Cause:** `USING` decides which rows the command can see. Only `WITH CHECK` raises, and only
for the row a write is trying to produce.
**Fix / rule:** Two different assertions for two different mechanisms, and they must not be
confused. `USING` denial → `lives_ok(…)` **plus** a follow-up assertion that the row is
unchanged. `WITH CHECK` denial, a missing INSERT policy, or a revoked table privilege →
`throws_ok(…, '42501')`. A test written the wrong way round reports the wrong reason for a
failure, and — worse — a `throws_ok` that is really testing a `USING` clause can pass for an
unrelated reason later. The same distinction is why §6.1's protected columns are guard
**triggers** rather than policies: a trigger raises, a policy filters.

## 2026-08-07 — A pgTAP suite that switches roles must run its assertions *inside* the role

**Context:** The KitchenOperator block of the Q04 authorization suite.
**What happened:** The block captured the persona's visible tables, ran `reset role`, and then
ran a dozen `is_empty($$ select 1 from payment $$)` assertions. Those executed as `postgres`,
which owns the tables and therefore bypasses RLS entirely — so they were reading every row in
the database and asserting it was empty. They would have failed noisily this time; the
dangerous version is the mirror image, where an `is_empty` runs as a role that has no rows for
an unrelated reason and passes for ever.
**Cause:** `RESET ROLE` is easy to put in the wrong place, and nothing about the assertion
tells you which role it ran as.
**Fix / rule:** Every persona block re-enters the role immediately before its assertions and
resets immediately after; the only statements that may run between are the ones that read the
captured results. **Part 0b of the suite asserts the harness itself before a single deny is
trusted** — that `SET LOCAL ROLE` actually changed `current_user`, that `auth.uid()` reads the
impersonated subject, and that an impersonated customer really does see their own order. A
broken impersonation setup makes every deny pass for the wrong reason, and that is the most
likely way an authorization suite lies to you.

## 2026-08-07 — After revoking `anon`'s privileges, `anon` cannot call pgTAP either

**Context:** Asserting the most important property in the model — that `anon` reads zero rows
from all 61 tables.
**What happened:** §10 of the authorization model revokes `all on all tables/functions in
schema public from anon`. pgTAP installs into `public` on a database where it is not already
present, so `set local role anon; select is_empty(…)` fails on `is_empty` itself, not on the
thing being tested.
**Cause:** A blanket revoke is blanket.
**Fix / rule:** **Capture as the persona, assert as the session role.** The suite has one
helper, `tests_visible_counts(schema)`, which loops every table and returns the row count
visible to the *current* role, swallowing `insufficient_privilege` as zero. The persona block
does nothing but `insert into tests_seen select …`; the `set_eq`/`is_empty` runs afterwards as
`postgres`. As a side effect this is also a much better encoding of the matrix: one assertion
per persona covering all 61 tables at once, naming exactly which table leaked or went dark.
The harness's own tables live in a `tests_tmp` schema, never in `public` — a helper table in
`public` would show up in its own visibility sweep.

## 2026-08-07 — `to_regclass(…) is null or (select … from that_table)` still fails

**Context:** Making the §11 storage assertions skip on a database without the storage
extension.
**What happened:** `select ok(to_regclass('storage.buckets') is null or (select public from
storage.buckets …))` does not degrade gracefully. The statement is parsed as a whole before
anything is evaluated, so the missing relation is an error at parse time and the `or` never
runs.
**Cause:** Name resolution happens at parse, not at execution. Runtime short-circuiting cannot
save a reference that does not resolve.
**Fix / rule:** Optional-object checks go through a plpgsql helper that tests `to_regclass`
first and reaches the table by `EXECUTE`. Same rule applies to the migration: `0002`'s bucket
creation is inside a `DO` block guarded the same way.

## 2026-08-07 — A guard trigger's `service_role` exemption must not be `SECURITY DEFINER`

**Context:** Writing the §6.1 protected-column guard triggers, which must fire for
`service_role` unless they explicitly exempt it.
**What happened:** The natural place to put `current_user in ('service_role', 'postgres', …)`
is a small helper alongside the other `auth_*` functions — all of which are `SECURITY DEFINER`
with a pinned `search_path`. Doing that here inverts the check: inside a `SECURITY DEFINER`
function `current_user` is the function's **owner**, so the helper would return true for every
caller and the guard would protect nothing.
**Cause:** `SECURITY DEFINER` changes `current_user`; `session_user` is unaffected but is the
wrong question when PostgREST does `SET LOCAL ROLE`.
**Fix / rule:** `auth_is_privileged_role()` is deliberately invoker-rights and carries a
comment saying why, so nobody "hardens" it later. General rule: any function whose answer
depends on *who is calling* must not be `SECURITY DEFINER`, which is the exact opposite of the
rule for any function that needs to *read past RLS*.

## 2026-08-06 — An RLS policy with no `TO` clause is granted to `PUBLIC`, which includes `anon`

**Context:** Writing `docs/authorization-model.md` (Q03), the specification `0002_rls_policies.sql`
will be transcribed from.
**What happened:** `CREATE POLICY … USING (…)` with no `TO` clause defaults to `TO PUBLIC`. In
Supabase, `PUBLIC` includes `anon` — so the single most catastrophic mistake available in this
schema is a *missing clause*, not a wrong predicate. It is also invisible: the policy reads
correctly, the customer path works, and unauthenticated access is silently open.
**Cause:** SQL default, inherited from `GRANT`.
**Fix / rule:** **Every policy in `0002` names its role explicitly — `to authenticated`** — and
Q04 asserts `select … from pg_policies where 'anon' = any(roles) or roles = '{public}'` is
empty. Related traps written up in the same document: policies are **permissive and OR
together**, so adding one can only ever widen access; and `FOR ALL` uses its `USING` clause for
both visibility and write-checks, so `0002` writes one policy per command instead.

## 2026-08-06 — RLS filters rows and cannot hide a column

**Context:** Trying to enforce `orders.view_pii` — the permission that separates "see the
orders" from "see the children's names on them" (E20-09).
**What happened:** There is no way to write a policy that grants a row but withholds
`order.recipient_name_snapshot`. Column-level `GRANT SELECT (cols)` does not rescue it either,
because grants are per-role and **a customer and a kitchen operator are the same Postgres role**
(`authenticated`) — the only thing distinguishing them is the policy predicate.
**Cause:** RLS is row-level by definition; the persona distinction lives in the JWT, not in the
role.
**Fix / rule:** Two consequences, both now written down. (1) Column-level promises need a
**separate table** with its own policy, not a policy on the wide table — raised as `AZ-02`.
(2) Any table where a customer may write but must not set every column needs a **`BEFORE UPDATE`
guard trigger** listing the protected columns; four such tables are enumerated in §6.1 of
`docs/authorization-model.md`. Do not assume a `WITH CHECK` can protect a column — it cannot.

## 2026-08-06 — `resolve_effective_config()` returns null for every customer once RLS is on

**Context:** Specifying the RLS policies for `platform_config` / `kitchen_config` /
`school_config` (Q03).
**What happened:** `resolve_effective_config()` is `STABLE` and deliberately *not*
`SECURITY DEFINER`, so it runs with the caller's privileges. It inner-joins `platform_config`,
which no customer may read. Once `0002` is applied it returns a **null row, with no error**, for
every customer — the cutoff time, the tax rates and the cancellation rules all silently become
null in the app.
**Cause:** Invoker-rights functions inherit the caller's RLS. A filtered-away join row is not an
error; it is zero rows.
**Fix / rule:** Do not open the config tables to customers — `school_config.revenue_share_bps`
is commercially sensitive (M4) and sits on the same row as the cutoff. Instead expose
`effective_config_public(school_id)`, a `SECURITY DEFINER` wrapper returning the customer-safe
subset (everything except `revenue_share_bps` and `sac_code`), gated on
`auth_can_reach_school()`. Q04 asserts both that the wrapper returns a row and that the raw
resolver returns null as `authenticated`, so the day someone "fixes" the config policies the
test says what they broke. **General rule: after enabling RLS, re-check every pre-existing
`STABLE` function that joins a now-protected table — the failure mode is a silent null, not an
error.**

## 2026-08-06 — `auth.uid()` is re-evaluated once per row unless you wrap it

**Context:** Writing the customer predicate for `"order"`, the hottest table in the system.
**What happened:** `customer_user_id = auth.uid()` calls the function for every candidate row.
`customer_user_id = (select auth.uid())` is hoisted to an InitPlan and evaluated once per
statement.
**Cause:** `auth.uid()` is `STABLE`, not `IMMUTABLE`, so the planner will not fold it — but it
will fold a scalar subquery.
**Fix / rule:** **Every policy predicate writes `(select auth.uid())`, never bare
`auth.uid()`.** Same applies to `auth.jwt()`. This is the difference between a policy that costs
nothing and one that costs a function call per row on the order history query.

## 2026-08-06 — A Postgres view bypasses RLS unless you ask it not to

**Context:** Writing `0001_initial_schema.sql` (Q02), which creates the `current_consent`
view over the append-only `consent_record` table.
**What happened:** A view is, by default, executed with the *view owner's* privileges, not
the caller's. Since Supabase migrations create objects as `postgres`, `current_consent`
would have read straight past the RLS on `consent_record` — a hole in the default-deny
promise, in the one table that evidences consent for children's data.
**Cause:** Postgres's historical default. `security_invoker` only arrived in PG15 and is
off by default for backwards compatibility.
**Fix / rule:** **Every view in this schema is created `WITH (security_invoker = true)`.**
A view is not a security boundary here; the underlying table's RLS is. Q04's test suite
should assert this for every view in `public`, because the failure is silent — the view
simply returns rows it should not.

## 2026-08-06 — `SET search_path` on a SQL function silently blocks inlining

**Context:** Writing `resolve_effective_config()` (§9.3), which is `STABLE` specifically so
the planner can inline it into the surrounding query.
**What happened:** Adding `SET search_path = public` — the habit formed while writing
`auth_has_permission()` — makes the function un-inlinable. Postgres will not inline a
function that carries a `SET` clause, because the setting has to be established and torn
down around each call.
**Cause:** Documented planner behaviour, but it is easy to apply the `SECURITY DEFINER`
hardening reflex to every function.
**Fix / rule:** Pin `search_path` **only** on `SECURITY DEFINER` functions, where it is
mandatory and the inlining loss is irrelevant. `auth_has_permission()` has it;
`resolve_effective_config()` deliberately does not, and carries a comment saying why so
nobody "fixes" it later.

## 2026-08-06 — The schema cannot be applied to a bare Postgres

**Context:** Wanting to syntax-check `0001_initial_schema.sql` locally.
**What happened:** `app_user.id` is a foreign key to `auth.users(id)` (§4.1) — that is what
makes every customer RLS predicate a direct `auth.uid()` comparison with no join. It also
means the migration cannot be applied to a plain Postgres container; the `auth` schema does
not exist there.
**Cause:** Deliberate coupling to Supabase Auth, decided in the data model.
**Fix / rule:** The migration opens with a `DO` block that raises a readable error if
`auth.users` is missing, rather than failing three hundred lines later with a confusing
foreign-key error. CI must run schema and pgTAP tests against `supabase start`, not against
a bare `postgres:16` service container. This is a constraint on E01's CI design.

## 2026-08-06 — A future-dated menu assignment goes live on a day with no DML

**Context:** Implementing the `school_menu_version` bump triggers (§6.8) for the
`GET /menu/version` cache token.
**What happened:** The triggers fire on writes to `menu`, `menu_item`, `menu_assignment`,
`menu_item_price_override`, `dish` and `asset`. But a `menu_assignment` with a future
`valid_from` becomes effective at midnight on that date, when *nothing is written*. The
token therefore does not change, and every client keeps serving yesterday's cached menu
until some unrelated edit happens.
**Cause:** The invalidation design is write-driven; this one transition is time-driven.
**Fix / rule:** `refresh_school_menu_versions()` exists for exactly this and **must be run
by the nightly job** — it bumps any school whose effective menu today differs from the menu
recorded on its token, which is precisely the set that rolled over. General rule: any cache
token invalidated by triggers needs a sweep for the transitions that are caused by the
clock rather than by a writer.

## 2026-08-06 — Postgres SEQUENCE cannot produce gapless invoice numbers

**Context:** Designing `E07-01` (gapless sequential invoice numbers per financial year) in the
target data model.
**What happened:** The obvious implementation — a `SEQUENCE` per financial year — silently
fails the requirement.
**Cause:** Sequences are deliberately non-transactional so concurrent writers never block. A
rolled-back transaction consumes its value and leaves a permanent hole. A failed payment would
therefore burn an invoice number, which is precisely what M3 forbids.
**Fix / rule:** Use an `invoice_sequence` counter row and `UPDATE … RETURNING` inside the same
transaction that inserts the invoice, so the row lock serialises allocation. Allocate only
**after** payment capture. Serialisation is inherent to gapless numbering, not a flaw — at a
few thousand invoices a month the contention is irrelevant. Never reach for `SEQUENCE` or
`generated always as identity` for anything with a statutory numbering requirement.

## 2026-08-06 — RLS on the grants table recurses into itself

**Context:** Designing the `permission_grant` table and the `auth_has_permission()` helper the
policies call.
**What happened:** A policy on `permission_grant` that calls a function which reads
`permission_grant` re-triggers the policy — infinite recursion. Postgres surfaces this as a
confusing runtime error on an unrelated query, not as an error when the policy is defined.
**Cause:** RLS applies to functions running as the invoker, including inside policy predicates.
**Fix / rule:** The permission-check helper must be `SECURITY DEFINER`, owned by a role that
bypasses RLS, marked `STABLE`, and **must** pin `SET search_path = public` — without that pin a
`SECURITY DEFINER` function is a privilege-escalation vector. Any table whose policy needs to
consult itself gets the same treatment.

## 2026-08-06 — "Partition from day one" propagates into every child table

**Context:** Deciding how to honour D9 / `E02-11` (reporting scoped by city + kitchen).
**What happened:** Declarative partitioning of `order` turns out to be far more invasive than
"add a `PARTITION BY` clause".
**Cause:** Postgres requires the partition key to be part of every unique constraint on the
partitioned table, so `order`'s primary key becomes composite — `(id, service_date)`. Every
foreign key referencing `order` must then carry the partition column too, so `order_line`,
`order_event`, `refund` and `payout_line` all gain a column and every join gains a term.
**Fix / rule:** Partitioning is a scaling decision with a schema-wide blast radius, not a
day-one hygiene measure. Composite indexes on `(city_id, service_date)` and
`(kitchen_id, service_date)` deliver the property D9 actually wants — never scanning another
city's rows — at ~10⁶ rows. Raised as `DM-05`; revisit at ~50M order rows or a report over 2s
at p95.

## 2026-08-06 — Legacy `Dish_In_Order` already carried child and school on the line

**Context:** Deciding whether one checkout can cover two children (`DM-01`).
**What happened:** The legacy line-item type snapshots `child` and `school` per line even
though `Order` also has a single `child` pointer.
**Cause:** Most likely an abandoned move toward multi-recipient carts, left half-done — the
same pattern as `Guardian_Link` being introduced but never replacing `Child.Parent`.
**Fix / rule:** Treat this as evidence that multi-child checkout was wanted, not as a licence
to assume it. It is written up as `DM-01` for Andy. **General rule for this migration: where
the legacy schema contains two mechanisms for one thing, assume the second was started and
abandoned, and find out which one the live data actually uses before copying either.**

## 2026-08-06 — `order`, `user` and `grant` are all SQL keywords

**Context:** Naming tables for the target schema, where `E02-07` specifies a table called
`grant`.
**What happened:** `GRANT` and `USER` are reserved words; `ORDER` is reserved in `ORDER BY`
context.
**Cause:** SQL standard.
**Fix / rule:** `user` → `app_user`, `grant` → `permission_grant`. `order` is kept and quoted,
because the domain term is worth the quoting and PostgREST handles it. Decide this once, in the
model, rather than discovering it halfway through writing the DDL.

## 2026-08-06 — Bubble export contains live secrets in cleartext

**Context:** Parsing the `.bubble` app export to map the legacy schema.
**What happened:** `settings.secure` contained a live Razorpay key (`rzp_live…`), a Stripe
test secret, and two marketplace plugin app secrets, all unredacted.
**Cause:** Bubble's app export includes the secure settings block verbatim.
**Fix / rule:** `*.bubble` is in `.gitignore` and must never be committed or shared. Keys
rotated (`E00-01`, `E00-02`). Treat any Bubble export as a secret.

## 2026-08-06 — Bubble cannot export password hashes

**Context:** Planning user migration for ~400 existing accounts.
**What happened:** No export path or API exposes the password field.
**Cause:** Platform limitation, not a setting.
**Fix / rule:** Every user re-authenticates once regardless of approach. Since that cost is
unavoidable, we switched to phone + OTP rather than migrating passwords — the migration
constraint became a product improvement.

## 2026-08-06 — Firebase Phone Auth is not available in India

**Context:** Evaluating OTP providers.
**What happened:** India is not among Firebase Phone Number Verification's supported
regions (Finland, France, Germany, Indonesia, Malaysia, Pakistan, Spain).
**Cause:** Google regional availability.
**Fix / rule:** Use an Indian SMS provider (MSG91 / Gupshup) with TRAI DLT registration.
DLT has 1–2 weeks of paperwork lead time and blocks launch — started in `E00-06`.

## 2026-08-06 — Legacy break-time option values contradict their labels

**Context:** Mapping the legacy `Break-Start-Times` option set for migration.
**What happened:** db_value `10__00_am` renders as "10:40AM - 11:15AM"; `10_15_am` renders
as "11:15AM - 11:40AM".
**Cause:** Labels were edited over time without changing the stored values.
**Fix / rule:** Never migrate break times on db_value. `E16-15` builds a hand-verified
lookup table. General rule: for every legacy option set, verify label-to-value agreement
before trusting either.

## 2026-08-06 — Legacy `mobile` is a number field

**Context:** Planning OTP-based account claim for migrated users.
**What happened:** Leading zeros and `+91` country codes are already lost in the stored data.
**Cause:** Bubble field typed as number rather than text.
**Fix / rule:** Normalise to E.164 before any claim is possible, and **block auto-claim on
any ambiguous or duplicate match** — otherwise one OTP could claim the wrong account along
with its children's records (`E03-11`, `E16-14`).

## 2026-08-07 — `sync-state.mjs --andy` silently did nothing

**Context:** Ticking `E01-00`/`E01-01` at the end of the first Block 1 task.
**What happened:** `node scripts/sync-state.mjs --andy` printed a success line
("9 tasks marked done, 0 markdown lines updated") while performing **neither** the push nor
the pull. The two freshly ticked boxes were not recorded.
**Cause:** The script read its mode as `process.argv[2]`, so the flag `--andy` *became* the
mode. Neither `mode === 'push'` nor `mode === 'pull'` matched, both branches were skipped,
and the script still wrote the state file and reported success.
**Fix / rule:** Mode is now the first **non-flag** argument, and an unrecognised mode exits 1
instead of no-opping. General rule for the repo tooling: **a script that recognises no work to
do must fail loudly, not report success.** The tooling here is the only record of what is
done — a silent no-op means Andy is told a task is ticked when it is not.

## 2026-08-07 — `git push` over HTTPS caps out below 1 MB on this network

**Context:** First push of the repo to `github.com/andydial/graybag` (36 MB packed).
**What happened:** `git push` failed with `HTTP 400` and, once HTTP/1.1 was forced,
`HTTP 408`, after only ~12 s — far too fast to be a bandwidth timeout. Pushing one commit at
a time got exactly one commit in before failing on `21c0e2b baseline`, the commit that adds
the 46 MB `Legacy-Application/` design package (including a 21.8 MB brand-guidelines PDF).
**Cause:** Not GitHub, and not repo size as such. A bisect with throwaway repos of
incompressible data put the ceiling **between 512 KB and 1 MB of POST body**: 128/256/512 KB
push fine, 1 MB and up always fail. That is the signature of a middlebox on this connection
capping request bodies, not of anything git or GitHub is doing. Two red herrings cost time —
the machine's boot volume was simultaneously 100% full, and Apple's git 2.39.3 defaults to
HTTP/2, which turns the same failure into a `400` instead of a `408`.
**Fix / rule:** Diagnostic rule worth keeping: when a push fails, time it — a
failure in seconds is a rejection, and only a failure in minutes is a timeout. Bisect the
*payload size* with a throwaway repo before assuming the repository's own history is at fault.

**Superseded 2026-08-08 — the original fix here was "use SSH for this repo, not HTTPS".**
SSH turned out to be unnecessary, and reaching for it would have preserved the actual
problem. The 36 MB was one directory, `Legacy-Application/`, which had no business being in
git at all (`docs/decisions.md` → RH1–RH4). Removing it with `git filter-repo` took the
packed repository to **under 1 MB** and the push to `origin` then went over plain HTTPS
first time. SSH would have made a 36 MB repository pushable; deleting the 36 MB made it
small, which also fixes every future clone and CI checkout. **The transport was the
symptom, not the cause.** Reach for a bigger pipe only after checking whether the payload
should exist.

The middlebox ceiling itself is real and still there — assume **any single push over ~512 KB
on this network may fail**. It has not bitten since, because normal commits are kilobytes.
If a large push is ever unavoidable, push in chunks (`git push origin <sha>:refs/heads/<b>`
walking forward a few commits at a time) so each POST body stays under the cap; SSH remains
the fallback, and `ssh.github.com:443` is reachable if port 22 is ever blocked.

## 2026-08-07 — `node --test <directory>` silently runs nothing on Node 22.x

**Context:** Adding tests for `scripts/check-migrations.mjs`, following the pattern already
used by `tools/menu-import`.
**What happened:** `node --test scripts/test/` reported `tests 1 / pass 0 / fail 1` with a
`MODULE_NOT_FOUND` — it tried to load the *directory* as a module. Checking the existing
`tools/menu-import` suite, whose `npm test` was `node --test test/`, showed the same thing:
**its 95 tests had not been running.** Run as `node --test test/*.test.mjs` all 95 pass.
**Cause:** The directory form of `--test` does not resolve on Node 22.x — confirmed on both
22.5.1 and 22.23.2, so this is not a point-release regression to wait out. It worked on the
Node 20 the importer was written against.
**Fix / rule:** Both call sites now pass an explicit glob. General rule: **a test command that
reports a small number of tests is as suspicious as one that fails.** `pass 0 / fail 1` from a
95-test suite looked like one broken test and was actually the whole suite never loading —
check the *count*, not just the exit code, whenever a suite is moved or a runner is upgraded.

## 2026-08-07 — The schema and seed can be checked offline, without Docker

**Context:** Docker Desktop could not be installed (the boot volume was full), so
`supabase start` was unavailable and `supabase/seed.sql` was about to be written blind.
**What happened:** `brew install postgresql@17` plus a ~40-line stub of the Supabase-provided
objects was enough to apply `0001`, `0002` and `seed.sql` for real. It immediately caught a
bug that reading would not have: the fixture UUIDs used a mnemonic prefix `k1000000-…` for
kitchens, and **`k` is not a hex digit**, so every kitchen id was an invalid uuid literal.
**Cause:** n/a — this is a technique note, not a defect.
**Fix / rule:** The stub needs only: roles `anon` / `authenticated` / `service_role`; schemas
`auth` and `storage`; `auth.users(id uuid primary key, …)`; `auth.uid()` reading
`request.jwt.claims`; and `storage.buckets` / `storage.objects`. Create the roles
conditionally — roles are **cluster-wide, not per-database**, so a plain `create role` fails
on the second run and, under `ON_ERROR_STOP`, silently aborts the whole bootstrap.

**What this does NOT prove**, and the distinction matters: it is not GoTrue. The pgTAP
authorization suite still cannot run this way (`docs/testing-strategy.md` §6) because
impersonation depends on the real auth schema, and pgTAP itself has no Homebrew formula. Use
this for *DDL and fixture* checks — column names, constraints, uuid literals, insert order —
and treat `supabase db reset` in CI as the authority. It turns a minutes-long feedback loop
into a seconds-long one for exactly the class of error that is otherwise found last.

## 2026-08-07 — `brew install postgresql@17` broke the Homebrew Node binary

**Context:** Installing a local Postgres so `supabase/seed.sql` could be checked without Docker.
**What happened:** The install pulled `icu4c` forward to `icu4c@78`, deleting
`libicui18n.74.dylib`. The Homebrew `node` 22.5.1 binary links against exactly that file, so
**every `node` and `npm` command died with a dyld error** — mid-task, with nothing else changed.
**Cause:** Homebrew's `node` bottle links dynamically against whatever `icu4c` was current when
it was built. Any formula that upgrades `icu4c` silently invalidates it. Nothing warns you.
**Fix / rule:** Installed `node@22` (22.23.2, built against the current `icu4c`) and relinked:
`brew install node@22 && brew unlink node && brew link --overwrite --force node@22`. Chosen over
`brew reinstall node`, which would have jumped 22.5.1 → 26.7.0 and left `.nvmrc`'s pin of 22
describing nothing anyone runs. **Rule: on this machine, treat any `brew install` as capable of
breaking the Node toolchain, and re-run `npm run smoke` immediately afterwards** — the failure
appears in a completely unrelated command and reads like a corrupted install.

## 2026-08-07 — `supabase link` is broken against the current API; use `db push --db-url`

**Context:** Applying `0001`/`0002` to the new staging project (`E01-04`).
**What happened:** `supabase link --project-ref …` failed with `LegacyLinkApiKeysNetworkError`
— a `SchemaError` complaining that `inserted_at` on one of the returned API keys did not match
the CLI's strict ISO-8601 regex. `supabase migration list --linked` then failed with
"Cannot find project ref". CLI 2.112.0, which **is** the latest published version, so there is
no upgrade to wait for.
**Cause:** Supabase's move to the new publishable/secret API keys. The CLI's legacy
api-keys endpoint returns a timestamp shape its own validator rejects. Nothing to do with us.
**Fix / rule:** Skip linking. `supabase db push --db-url "<connection string>" --include-all`
does the whole job and maintains `supabase_migrations.schema_migrations` correctly.

Two connection facts worth keeping:
- **The direct host `db.<ref>.supabase.co` does not resolve over IPv4** on new projects. Use
  the **session pooler**, `aws-0-ap-south-1.pooler.supabase.com:5432`, user
  `postgres.<project-ref>`. Note `aws-0`, not `aws-1` — `aws-1` resolves and accepts a TCP
  connection, then rejects the tenant, which looks like a wrong password rather than a wrong host.
- The CLI **accepts the four-digit migration prefix** (`0001_…`). It prints a warning about
  `<timestamp>_name.sql` only for files it skips, and it recorded `0001`/`0002` in the history
  table. `E01-10`'s convention is safe.

The `deploy-staging.yml` workflow still uses `supabase link`; it will need the `--db-url` form
if this is not fixed upstream by the time the first deploy runs. Flagged in `E01-14`.

## 2026-08-07 — A table is only as protected as the UNION of its policies

**Context:** First-ever execution of `supabase/tests/authorization.test.sql` (`E02-09`,
`E02-18`), against the real staging project.
**What happened:** Two assertions failed saying a PlatformAdmin could read
`recipient_allergen` — tier S, children's health data, and the one table
`docs/authorization-model.md` §7.2 says in bold that PlatformAdmin has **no** read policy on.
**Cause:** Both the document and `0002` were reasoning about the wrong thing. They enumerated
the permissions that do *not* open the table — `users.view` doesn't, `consent.view` doesn't —
and concluded it was closed. The way in was a **third** permission neither mentioned:
the fulfilment policy, written so a kitchen cannot send a peanut dish to an allergic child,
resolves through `auth_has_permission`, and that function treats **`scope_type = 'platform'`
as satisfying any scope check**. `orders.view_pii` is grantable at platform scope and
`platform_admin` holds every permission there. Nobody widened anything; the widening was
present from the first day the two policies coexisted.
**Fix / rule:** `0004` adds `auth_recipient_has_fulfilment_order`, which honours **kitchen and
school scope only** and names the allowed scopes positively so a future city-scoped
`orders.view_pii` cannot silently re-open it.

Two rules worth carrying forward:

1. **"Role X cannot read table Y" is a claim about the union of every policy on Y**, never
   about the permissions you happened to think of. Proving it by enumerating what does *not*
   grant access proves nothing.
2. **A platform-scope grant satisfies every scope check.** Any policy whose safety depends on
   the caller being *operationally local* — in a kitchen, at a school — must say so
   positively rather than relying on scope resolution, because scope resolution is designed
   to widen.

This is the entire value of the suite, delivered on its first run, and it was invisible for
as long as the suite went unexecuted.

## 2026-08-07 — Running a seeded pgTAP suite against an unseeded database

**Context:** Block 2's exit step is `npm run test:all`, whose `test:db` half needs
`supabase start` — and no container runtime could be installed (`E01-06`). Two of the three
pgTAP suites create their own fixtures and run anywhere, but `seed.test.sql` asserts
`supabase/seed.sql`, which only `supabase db reset` applies. Staging must never be seeded
(`seed.sql` says so in its header), so the suite looked unrunnable.
**What happened:** Splicing works. Strip `seed.sql`'s own `begin;`/`commit;`, insert the body
into `seed.test.sql`'s transaction just before `plan()`, and run the combined file. All 28
assertions passed and the closing `rollback` left staging at zero rows in every seeded table —
verified afterwards, not assumed.
**Fix / rule:** A pgTAP suite that ends in `rollback` can borrow ANY dataset for the length of
one transaction, including against a shared environment, **provided the data source's own
transaction control is stripped first** — a stray `commit;` in the spliced file would end the
test's transaction early and leave the fixtures behind permanently.

Worth generalising: this is the same property that makes the whole pgTAP approach safe against
staging, and it is why the authorization suite could be run against a real Supabase project
rather than waiting for Docker. **Always confirm the rollback actually happened by counting
rows afterwards** — the cost of being wrong is a shared database quietly full of fixtures.

## 2026-08-08 — A suite that reports `Tests: 0` also reports `Result: PASS` to anyone not reading

**Context:** `E02-24`. The first CI run that ever executed `integration.yml` died on
`duplicate key value violates unique constraint "users_pkey"`.
**What happened:** `supabase db reset` applies `seed.sql` and *then* runs the suites, and the
two had been written against the same UUID space — `a0` = user, `d1` = order, `e1` = … — with
seventeen ids in common. The first fixture insert aborted the transaction, pg_prove recorded
`Tests: 0` for `authorization.test.sql`, and the run still printed a summary line with a
plausible total. `E02-18` had recorded the suite green, and it *was* green, against a local
database still holding an older seed.
**Cause, and the part worth keeping:** the ids were only the first layer. Fixing them moved
the failure from line 147 to line 183 (`city_code_key`, `code = 'sas_nagar'`), because `0001`
has around forty unique constraints on **natural** keys — slugs, phone numbers, emails — and
primary keys were never the whole story. Three CI rounds would have found them one at a time;
a static diff of every literal shared between the two files found all six at once.
**Fix / rule:** fixtures live in their own namespace — `7e57` in the UUID's second group,
`test_` on slugs, a `757…` phone range — enforced statically by
`scripts/check-test-fixtures.mjs` in the smoke test, and `integration.yml` now fails on
`Dubious` / `No subtests run` / fewer than `MIN_TESTS` assertions.

**The general rule: exit status is not evidence that a test ran.** A suite has two failure
modes, "asserted and was wrong" and "never asserted", and only the first one is red by
default. Any suite whose value is that it fails loudly needs a separate check that it ran at
all — a floor on the assertion count is enough, and it is one line.

**And the finding underneath it (`E02-25`, still open).** With the collisions gone the suite
reaches its own harness assertion and fails on `permission denied for table order`.
`docs/authorization-model.md` §10 begins by asserting that *Supabase's default privileges give
`authenticated` SELECT/INSERT/UPDATE/DELETE on new tables in `public`, and RLS is what stops
them* — true on a real project, false on the local CLI stack, where migrations are applied by
a role with different default privileges. So **the environment CI runs in does not have the
privilege baseline the model is written against.** That is worse than either a pass or a fail:
it means a green suite locally is not evidence about production. §10's grants and revokes need
to exist as a migration so the baseline is stated rather than inherited.

## 2026-08-09 — A sparse override table turns `update … where` into a test that asserts nothing

**Context:** `E05-07`, the cutoff functions. The pgTAP suite was written and looked complete —
sixteen assertions, every edge case in `docs/order-lifecycle.md` §9.3 named. Run against a real
Postgres for the first time, four of them failed.
**What happened:** the fixture set its overrides with
`update kitchen_config set order_cutoff_time = '09:00' where kitchen_id = …`. Creating a kitchen
does **not** create its `kitchen_config` row — the override tables are sparse, and a missing row
is precisely how `D5` spells "inherit". So the `UPDATE` matched **zero rows and reported
success**, and all four override assertions were quietly measuring the platform default.
**The second bug, which the first one hid:** with the `UPDATE` corrected to an `INSERT`, four
*different* tests broke. All three fixture schools hung off one kitchen, so giving that kitchen
a 09:00 cutoff moved the "platform defaults" school to 09:00 as well — correct behaviour under
`D5`, and it made the defaults untestable. The fixture now uses two kitchens, one overriding
nothing.
**Fix / rule:** **build config-chain fixtures with `INSERT`, never `UPDATE`** — matching
`config_resolution.test.sql`, which had it right. And **a fixture for an inheritance chain needs
one subject per level that is genuinely unaffected by the others**; sharing a parent across the
"default" case and the "override" case means the default case stops being a default.

The general shape is the one already recorded above on 2026-08-08: a test can fail by asserting
the wrong thing, or by never really asserting. `UPDATE`-affects-zero-rows is the second kind, it
is invisible to exit status, and no plan count or assertion floor would have caught it — only
running it against a database with the fixture actually in place.

## 2026-08-09 — The local Supabase stack cannot see this repo, because it is not under `$HOME`

**Context:** verifying the `E05-07` suite before pushing, on Andy's Mac with colima rather than
Docker Desktop.
**What happened:** `supabase start` brought the database up and applied all eight migrations,
then died on `supabase_edge_runtime: worker boot error: failed to determine entrypoint` and tore
the whole stack down. With the edge runtime excluded the stack came up, and `supabase test db`
then reported `Files=0, Tests=0, Result: NOTESTS` — a green exit code for a suite that never ran.
**Cause:** the repository lives at `/Volumes/Data/AD/Projects/…`. colima mounts `$HOME` and
nothing else, so every container that **bind-mounts a path from the repo** sees an empty
directory: the edge runtime cannot find `supabase/functions/menu-version/index.ts`, and the
`pg_prove` container cannot find `supabase/tests/*.sql`. The database itself is unaffected,
because the CLI reads migrations on the host and applies them over a connection.
**Fix / rule:** to run pgTAP locally on this machine, **pipe the file in over stdin from the
host** rather than relying on a mount:

```bash
export DOCKER_HOST="unix:///Users/andy/.colima/default/docker.sock"
npx supabase start -x edge-runtime
docker exec -i supabase_db_graybag psql -U postgres -d postgres -t -A < supabase/tests/cutoff.test.sql
```

CI is unaffected — the GitHub runner has the repo under `$HOME` and `integration.yml` runs the
suite normally. The trap is local-only, and it is the `NOTESTS` result that matters: **a
mount that resolves to an empty directory looks exactly like a suite with nothing to do.**

## 2026-08-09 — 496 green tests against a bundle that could not be produced

**Context:** the first `eas build` ever attempted for this app. It failed in the "Bundle
JavaScript" phase with `UNKNOWN_ERROR`, on a tree where typecheck was clean and 496 tests
passed.
**What happened:** `packages/shared` is `"type": "module"` and its sources import each other
with an explicit extension — `import { … } from './env.js'` inside `index.ts`, referring to
`env.ts`. That is exactly what TypeScript's ESM resolution requires, and it is correct. Metro
does not do it: it looks for a literal `env.js`, finds nothing, and fails.
**Why nothing caught it:** *none of the three things CI runs uses Metro.* `jest-expo` resolves
with Jest's resolver, `tsc` with TypeScript's, `vitest` with Vite's — and all three accept the
`.js`-for-`.ts` specifier. The app had never been bundled by anybody, so the failure had no way
to surface until somebody asked for an installable build.
**Fix:** `apps/mobile/metro.config.js` — a `resolveRequest` that retries a *relative* `.js`
specifier without its extension before giving up, plus the `watchFolders` /
`nodeModulesPaths` pair every npm-workspaces monorepo needs and Metro does not infer. Scoped to
relative specifiers on purpose: a bare `some-package/thing.js` is a real path into a real
package, and retrying it as `.ts` would mask a genuinely missing dependency.
**And the actual lesson, which is not about Metro.** A test suite proves the code does what it
says; it does not prove the code can be *built*. Those are different claims, and this
repository was making the first one loudly while the second was false. `npm run bundle:check`
now runs in CI (~30s) so "the app bundles" is asserted rather than assumed — the same class of
gap as the 2026-08-08 entry above, where a suite reporting `Tests: 0` also reported success.

**Second, smaller trap in the same hour.** `npm --prefix apps/mobile exec -- expo export` and
`npm --prefix apps/mobile run bundle:check` are not equivalent: `exec` left the working
directory at the repository root, so Expo picked `node_modules/expo/AppEntry.js` as the entry
point instead of `apps/mobile/index.ts` and failed on an import two levels up. Use
`--prefix … run`, which is what the repo's other mobile scripts already do.

## 2026-08-09 — "Unknown error. See logs of the Bundle JavaScript build phase"

**Context:** four failed `eas build` runs for the first Android APK, all reporting exactly that
message and nothing else.
**What happened:** `.easignore` excluded `config/` on the reasoning that it holds lint
configuration no app build runs. But `apps/mobile/tsconfig.json` — like `packages/shared`'s and
`apps/web`'s — begins `"extends": "../../config/tsconfig.base.json"`, and **Expo's Metro
TypeScript resolver follows that `extends` chain at startup** to read `compilerOptions.paths`.
With the file missing it throws inside `_loadTsConfigWithExtends`, the `EAGER_BUNDLE` phase
dies, and the CLI surfaces a generic message with no path in it. The directory is 28 KB;
excluding it saved nothing.
**Why it took four builds:** the failure is invisible locally. `expo export` and
`expo export:embed` both succeed on a developer machine, because the machine has the whole
repository — only the *uploaded subset* is missing the file. Any `.easignore` exclusion is
therefore a change that cannot be tested by running anything locally.
**Fix / rule:** **an `.easignore` entry is a guess until a build proves it.** Exclude large,
obviously-inert things (`docs/`, `planning/`) and leave small ones alone — the upload saving is
measured in kilobytes and the failure costs a fifteen-minute round trip with a message that
does not name the file. Anything a `tsconfig.json` in a built workspace `extends` is load-bearing
by definition.

**Getting at the real error, which is the other half of the lesson.** `eas build:view` exposes
no log text and the CLI prints only the generic line. The logs are reachable, and worth knowing
how to reach:

```bash
# 1. signed URL, via the GraphQL API and the CLI's own session
#    ~/.expo/state.json -> auth.sessionSecret, sent as the `expo-session` header
#    query: builds { byId(buildId: $id) { logFiles } }
# 2. the file is BROTLI, and is served with an encoding curl does not understand:
curl -H 'Accept-Encoding: identity' -o build.log "<signed url>"
node -e "console.log(require('zlib').brotliDecompressSync(require('fs').readFileSync('build.log')).toString())"
```

It is NDJSON, one object per line with `phase` and `msg`. The phase list alone
(`EAGER_BUNDLE`, `PREBUILD`, `INSTALL_DEPENDENCIES`, …) localises a failure in seconds. Four
builds were spent guessing before fetching it; fetch it first.

## Jest cannot load `lucide-react-native`'s ESM build — 2026-08-10

Adding Lucide for the tab bar (`E14-16`) failed every mobile suite at import with
`SyntaxError: Unexpected token 'export'` from `dist/esm/lucide-react-native.mjs`.

The cause is not `transformIgnorePatterns`, which is where everyone looks first. `jest-expo`'s
transform key is `\.[jt]sx?$` — **`.mjs` does not match it**, so adding `lucide-react-native`
to the ignore-pattern exception list changes nothing: Jest was already willing to transform the
file and simply never routed it to a transformer. The package resolves to `.mjs` because
`jest-expo` sets the `react-native` export condition, and Lucide maps that condition to its ESM
build.

Overriding `transform` in `package.json` would work and is wrong — it *replaces* the preset's
transform wholesale, silently dropping the three asset transformers `jest-expo` installs.

The fix is one `moduleNameMapper` entry pointing at the CJS build, which Jest parses natively:

```json
"^lucide-react-native$": "<rootDir>/../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js"
```

Metro is unaffected — it honours the same `react-native` condition and takes the ESM build, so
the app bundles from the sources it ships. Verified with `expo export` on both platforms.

## React Navigation renders each tab icon twice — 2026-08-10

`getByTestId('tab-icon-home')` fails with "found multiple elements" against a bottom-tab
navigator. There is one tab button (`getAllByRole('button')` returns exactly four) but two
copies of each icon: React Navigation renders a second for the iOS large-content viewer. Assert
with `getAllBy…` and a length floor. Not a rendering bug — the old default triangle came
through the same path and still drew once on screen.

## An `ApiError`'s `code` can only be read once — 2026-08-10

`invokeFunction` recovers the server's refusal code by calling `.json()` on the `Response`
hanging off `functions.invoke`'s error (`error.context`). A `Response` body is a stream and
**can only be consumed once**, so a test that awaits the same rejection twice against one
stubbed `Response` gets the code on the first assertion and `code: undefined` on the second:

```ts
await expect(call()).rejects.toBeInstanceOf(ApiError);      // passes
await expect(call()).rejects.toMatchObject({ code: 'x' });  // code is undefined
```

It reads exactly like the module losing the code. Catch the rejection once and assert against
the caught value. Not a product bug — every real failure arrives with its own `Response` — but
it is invisible until a second assertion is added months later.

## A worklet calling a plain function is fatal in release and harmless in debug — 2026-08-10

The first iOS build aborted with `SIGABRT` and **no message in the crash report** on the first
screen that mounted a `TextField`. The report's faulting thread was `com.apple.main-thread`
inside a QuartzCore display-link dispatch, calling into `hermesvm`, ending
`throwPendingError → __cxa_throw → std::terminate → abort`.

`TextField` renders `InlineError`, whose `useAnimatedStyle` called `resolveDuration` and
`easingFor` — both ordinary functions. `useAnimatedStyle` runs on the **UI runtime**; a plain
function captured by a worklet is serialized as a *remote function* and calling one throws
`[Worklets] Tried to synchronously call a Remote Function`.

**The reason it never showed up in development** is in
`react-native-worklets/Common/cpp/worklets/WorkletRuntime/WorkletRuntime.h`:

```cpp
#ifndef NDEBUG
  jsi::Value callGuarded(...) const {
    try { return function.call(rt, args...); }
    catch (jsi::JSError &e) { JSLogger::handleJSError(...); return undefined; }
  }
#endif
```

`runSync` uses `callGuarded` in debug and calls `function.call` **bare** under `NDEBUG`. So the
identical bug is a red box in a dev build and an abort in a release build. It is *not* an
iOS/Android difference — the throw itself is plain JavaScript with no platform branch
(`remoteFunctionUnpacker.native.ts`), and both platforms compile the guard out of release.

Two consequences worth keeping:

1. **A unit test cannot catch this.** Under jest there is one runtime; the worklet is a normal
   closure and the call succeeds. What a test *can* assert is that the function carries
   `__workletHash`, which is the marker the babel plugin stamps on a `'worklet'` directive.
2. **A worklet captures its closure by serialization.** A `Map` does not survive it, and a
   mutation made on the UI runtime is not visible on the JS one — so a lazy cache inside a
   workletized function silently does nothing.

### Why the Android release build survived the same bug

The throw is identical on both platforms and the debug-only guard is compiled out of both. The
difference is what happens to the exception **after** it leaves the frame callback, and it is
in the platform dispatch layer rather than anywhere in our code.

**Android** schedules the UI-runtime trigger through React Native's own `GuardedRunnable`
(`react-native-worklets/android/.../AndroidUIScheduler.kt`):

```kotlin
UiThreadUtil.runOnUiThread(
    object : GuardedRunnable(mContext.exceptionHandler) {
        override fun runGuarded() { mUIThreadRunnable.run() }
    },
)
```

and `GuardedRunnable.run()` is, verbatim, a `try { runGuarded() } catch (e: RuntimeException)
{ exceptionHandler.handleException(e) }`. The error crossing JNI becomes a Java exception, is
caught there, and goes to RN's exception handler. The app keeps running.

**iOS has no equivalent.** `grep -rn catch react-native-worklets/apple/` returns **zero
matches** — the UI runtime is driven straight off a `CADisplayLink` with nothing between the
worklet and the run loop, so the C++ exception unwinds to `std::terminate`.

**The rule to carry forward: an uncaught error on the Reanimated UI runtime is a soft error on
Android and a hard crash on iOS, in release.** "It works on Android" is never evidence about
iOS for anything that runs on a worklet — Android is quietly swallowing a class of error that
kills the iOS build.

## `node_modules/` with a trailing slash does not ignore a `node_modules` symlink — 2026-08-10

Two agents working in git worktrees symlinked `node_modules` back to the main checkout to skip
an install. One of them had both symlinks committed by `git add -A`, because `.gitignore` said
`node_modules/` — **a trailing slash matches a directory and not a symlink of the same name.**

CI died in Install, before a test ran:

```
npm error ENOTDIR: not a directory, mkdir '.../apps/mobile/node_modules'
```

The worse half is local. Checking that branch out into a normal checkout makes git write the
tracked symlink **over the real `node_modules` directory** — it is willing to, because the
directory is ignored — and the result is a symlink pointing at itself. The tree needs a full
`npm install` to recover. Recovering it is what this entry cost.

Fixed by dropping the slash. Two rules worth keeping:

1. **Ignore rules for build directories should have no trailing slash**, so they cover the
   symlink someone will eventually put there.
2. **Never check out an untrusted branch in the working tree you are relying on.** Use
   `git worktree add` in a scratch directory: writing the symlink there destroys nothing.

## Symlinking node_modules into a worktree breaks workspace resolution — 2026-08-10

The related trap, found the same day. Symlinking the whole `node_modules` into a worktree
points `@graybag/shared` back at the **main checkout**, because npm's workspace link is a
relative symlink resolved from `node_modules`' own directory. TypeScript resolves the workspace
by relative path and sees the worktree; jest resolves through `node_modules` and sees main.

So `npm run typecheck` passes against new code in `packages/shared` while every mobile test
fails with `api.<newFunction> is not a function` — the two toolchains disagreeing about which
copy of the package they are looking at. If a worktree needs to skip an install, make
`node_modules` a real directory, symlink the individual entries, and point `@graybag/*` at the
worktree's own `packages/` and `apps/`.

## Two units tested in isolation prove nothing about the wire between them — 2026-08-10

**This is a class, not an incident.** It has now produced three separate defects in one week,
and it is the entire argument for `E14-24` and for the change to the definition of done.

### The shape

Take a seam — a function one side exports and the other side is supposed to call. Test each
side thoroughly. Both suites go green. **Nothing tests that the call happens**, because each
suite substitutes the other side: the consumer's tests inject a fake, and the producer's tests
never construct a consumer. The seam is the one thing neither can see, and it is invisible in
review precisely because both files look complete and well-tested.

### What it produced here

| Seam | The defect | What each side's tests proved |
|---|---|---|
| `createMenuCache` ↔ `setMenuCache` | **`setMenuCache` was never called from any build.** The Menu tab told every user "this school's menu has not been published", on every school, since the tab existed | `cache.test.ts` proved the cache. `MenuScreen.test.tsx` injected a fake cache and proved the screen. Neither constructed the real one |
| `.maestro/cart.yaml` ↔ the app's testIDs | The flow tapped `tab-menu` and `tab-cart`, which did not exist — the tab bar had no testIDs at all | The flow was valid YAML. The app rendered correctly. Nothing compared the two |
| `README.md` ↔ the prototype's routes | `#dish` was documented and silently fell back to the splash screen | The README was accurate prose. The prototype worked. Nothing resolved one against the other |

The menu one is the worst of the three. It shipped in every build ever made, and the symptom —
an empty menu — was indistinguishable from the honest answer, so it read as a data problem for
a week. See also *"Emptiness is four different things"* (`docs/ux-spec.md` §5.21).

### Why "more unit tests" is the wrong response

Every one of these had thorough unit tests on both sides. Adding a fourth suite to either side
would not have caught any of them. The missing test is always the one that **refuses to
substitute** — that runs the real producer against the real consumer.

### What to actually do

1. **One test per seam that uses neither fake.** For the app that is the Maestro flow, which
   drives a real build against a real backend. For a repository-internal seam it can be far
   cheaper: `check-maestro-ids.mjs` resolves the flows against the source in about a second,
   and the prototype's build fails on a README link that does not resolve.
2. **Make "is it wired up?" a checkable property.** A registration that can be forgotten is one
   that will be. Prefer a construction the compiler or a check can see over a `setX()` that
   something is trusted to call at start-up.
3. **Treat "both suites green, behaviour wrong" as a signal about the suites**, not as a
   mystery. Ask which side's test is substituting the other, and go and look at that gap.
4. **Verify on a device before calling a thing done.** All three defects were visible in ten
   seconds of using the app, and invisible in a green CI run.

## Two `render()` calls in one RNTL test detach the renderer for the whole file — 2026-08-10

Calling `render()` twice inside a single test leaves the file's renderer detached. **Every
subsequent test in that file** then fails at its first query with a one-second timeout, so the
symptom appears in tests that are correct and nowhere near the cause. It cost an hour during
`E21-09`.

To remount inside a test, keep one `render()` and drive it: change the component's `key` and
call the `rerender` the first render returned. Reach for a second `render()` only in a fresh
test.

The reason it is worth writing down is the shape rather than the API detail: **the failure is
reported somewhere other than where it was caused**, which is the class of bug that eats an
afternoon regardless of how good the person is.

## `StyleSheet.absoluteFillObject` is not typed on RN 0.86, and spreading it fails silently — 2026-08-10

`{...StyleSheet.absoluteFillObject}` contributes **nothing** — no error at runtime, no warning,
just an element that is not positioned. Found in `E21-07` when an overlay `TextInput` sat
wherever layout put it instead of over the boxes it was meant to cover; typecheck caught it only
because `exactOptionalPropertyTypes` made the missing property visible.

Write `position: 'absolute'`, `top`, `left`, `right`, `bottom` longhand.

The general shape, which is the reusable part: **a spread of an undefined object is a silent
no-op.** Any `{...Something.maybeMissing}` is a line that can stop working without failing.

## RNTL v14: `unmount()` is async, and not awaiting it breaks a *later* test — 2026-08-10

`render()` became async in RNTL v14 and is awaited everywhere. `unmount()` did too, and is easy
to miss. Not awaiting it overlaps two `act` scopes, and React then renders the **next** tree as
nothing — so the failure surfaces in a different, correct test as an empty tree.

Same family as the two-`render()` trap above, and the same reason both are worth writing down:
**the symptom appears somewhere other than the cause**, which is what makes them expensive
rather than merely annoying.

## RNTL v14: `fireEvent.press` must be awaited too — 2026-08-11

The third member of the same family, after `render()` and `unmount()`. An unawaited
`fireEvent.press` overlaps `act` scopes and React renders the **next test's** tree as nothing,
so a correct test fails with an empty tree and the actual cause is in the test above it.

`render`, `unmount`, `fireEvent.*` and `userEvent.*` are all async in v14. **Await every one.**

Three separate people have now lost time to this family in two days, always the same way: the
symptom is reported somewhere other than the cause. If a test that was passing starts returning
an empty tree, look at the test *before* it, not at itself.

## 2026-08-11 — `supabase db push --include-seed` does not re-apply a changed seed

**Symptom.** `supabase/seeds/catalogue.sql` was applied to staging, then edited to set
`school.onboarded_at`, then pushed again. The CLI printed `Updating seed hash to
supabase/seeds/catalogue.sql...` and `Finished supabase db push`, exit 0, seed listed in the JSON
result — and **the file was never executed**. Editing it again and re-pushing did the same.

**Why it matters.** The first application had left `onboarded_at` null, and
`anon_school_onboarded` is `is_active and onboarded_at is not null and offboarded_at is null`, so
three real schools with 119 priced menu rows behind them were invisible to every signed-out
visitor. The school picker returned `[]` and the app rendered as though the database were empty —
`docs/ux-spec.md` §5.21 N2 wearing N1's clothes. And the fix appeared to deploy successfully each
time.

**The tell.** A run that actually executes prints `Seeding data from <file>...`. A run that only
records the hash prints `Updating seed hash to <file>...`. If you do not see *Seeding data from*,
nothing ran.

**What to do instead.** A correction to already-seeded data belongs in a migration, which always
applies — `supabase/migrations/0024_onboard_real_schools.sql` is the worked example: named ids,
`and onboarded_at is null` so it is idempotent, and a no-op in an environment where the catalogue
was never seeded. Seeds are for first application; migrations are for correction.

## 2026-08-11 — three things the real Bubble catalogue does that fixtures never did

Found while importing the real 85-dish catalogue (`E16-48`). All three were invisible against the
four-dish fixture set, and each stopped the seed dead:

1. **Six dishes exist twice** under the same name, violating `uq_dish_kitchen_name`
   `(kitchen_id, lower(name))`. They are the same dish entered years apart and they are *not*
   identical — one has marketing copy and no ingredients, the other a plain sentence and a full
   list — and four pairs **disagree on calories** ("160" vs "250–350" for one Cold Coffee). The
   merge keeps the row the live menu prices, fills blanks from the twin, and preserves the
   conflicting figure in `nutrition` rather than picking a winner.
2. **One dish is listed twice on one menu** (`menu_item_menu_dish_unique`), at the same price both
   times — parents see it duplicated today. Collapsed, but the generator throws rather than
   choosing if the two prices ever disagree.
3. **The export is double-encoded**: UTF-8 bytes decoded as cp1252 and re-encoded, so every
   en-dash arrives as `â€“`. `.encode('cp1252').decode('utf-8')` restores it — **not** latin-1,
   which cannot represent `0x80` and silently drops the character with `errors='ignore'`.

**And a fourth, in our own code:** the seed emitted `asset` rows for dish photos while
`tools/upload-dish-images` also writes them, under a `dishes/` key prefix that only the uploader
knows. Every seed-written path 404'd. Two writers for one relationship — the same shape as the two
sources of truth for the session (`E03-26`). The uploader owns it; the seed no longer writes
assets at all.

## `npm run test:db` passed while running zero assertions — 2026-08-11

`npm run test:all` was green. The database suite inside it printed
`Files=0, Tests=0, Result: NOTESTS` and `supabase test db` **exited 0**. Default-deny
authorization, consent atomicity, the ledger invariants and recipient erasure were all
reporting success on nothing.

**The cause is not in the repository.** `supabase test db` bind-mounts `supabase/tests` into a
container and runs `pg_prove` inside it. This checkout lives under `/Volumes/Data`, which is not
on Docker Desktop's file-sharing list, so the mount is empty. Reproduced in one line:

```bash
docker run --rm -v "$PWD/supabase/tests:/t" alpine ls /t   # → nothing
```

`supabase db reset` works regardless, which is what makes it convincing: migrations apply,
seeds load, everything scrolls past looking healthy, and only the tests are missing.

**Two fixes, and the second is the one that matters.** Adding `/Volumes/Data` under Docker
Desktop → Settings → Resources → File Sharing repairs the mount (`E14-31`, Andy's machine).
But `scripts/test-db.sh` now runs each file through `psql` over TCP instead, so the host
filesystem never has to cross into a container at all — fewer moving parts, and it is how every
suite in this repo was actually being verified by hand anyway.

**The general lesson, which this project has now learned three times:** a tool that reports
success having done nothing is worse than one that fails. `E02-24` was the same shape — a
colliding fixture id killed the first insert and `authorization.test.sql` silently contributed
zero assertions — and the guard written then lived only in CI. The floor guard is now in the
local script too, because `CLAUDE.md` sends a human to `npm run test:all` at the end of every
block, and that was the one place with nothing under it.
