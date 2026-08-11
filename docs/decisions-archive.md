# Decision log — archive

Split out of `docs/decisions.md` on 2026-08-09 so the active file stays cheap to read into
context. **Nothing here is authoritative.** If an entry here disagrees with
`docs/decisions.md`, the active file wins.

Two kinds of thing live here, and nothing else:

1. **Superseded entries** — a decision that a later decision replaced or inverted. They are
   kept rather than deleted because "we tried X, it failed because Y" is worth as much as the
   fix, and because a reversed decision that leaves no trace gets quietly re-made.
2. **Build-log narrative** — the prose written *around* a decision table at the time a task
   ran, recording how the conclusion was reached. **The numbered decisions themselves stayed
   in `docs/decisions.md`**; only the surrounding commentary moved here. Every subsection below
   names which IDs are still live in the active file.

---

# Part 1 — Superseded

## `BR2` — inverted by `AR1`, 2026-08-08

`BR2` was written from the export dry run (`E19-04`) and read the empty `Child.Parent` column
as export damage. Andy's ruling the same day established that the column was never used in
Bubble at all, so there was no relationship to recover and nothing to reconstruct. `AR1` in the
active file is the live decision; `BR2`'s *reasoning about name-matching risk* is preserved
here because it is the argument for why `User.child` must never be used as a recovery path.

| # | Decision | Why |
|---|---|---|
| BR2 | **The parent↔child relationship is re-extracted from Bubble, never reconstructed by name matching** | The CSV export drops list-of-thing fields, so `Child.Parent` is empty on all 1,115 rows and `User.child` survives only as comma-joined *display names* — 48 of 376 references ambiguous, 33% of children reachable at all. Name matching at a 12.8% ambiguity rate, on data about minors, fails in exactly the direction non-negotiable #2 exists to prevent: showing one parent another family's child. A 90%-correct link is worse than no link, because no link is visible and a wrong link is not. `E16-21` gets the ids out properly instead |

**What replaced it.** `AR1`: parent↔child is derived from `Order` (`order-parent` + `child`),
not from `Child.Parent`. A child nobody has ordered for has no parent, and that is correct
data, not missing data. `AR2` then creates dependents *from* orders rather than matching them
*to* the roster, which removes the name-ambiguity problem at the point that matters.

## `BR6` — subsumed by `AR6`, 2026-08-08

`BR6` and `AR6` say the same thing; `AR6` is Andy's ruling and is the one that moved the work
out of the migration block. Only the duplicate is archived.

| # | Decision | Why |
|---|---|---|
| BR6 | **Dish images are mirrored now, not at cutover** | 82 of 85 resolve today and die with the Bubble app; the whole set is ~2.0 MB. Carrying a live external dependency into the cutover window buys nothing and can only get worse. The 3 that already return a permanent 403 are a content decision (`E16-29`), not a migration failure |

## The original "Phone + OTP" sign-in decision — superseded by `U1`

Recorded here only so the reversal is not invisible. The original entry was removed from the
active file before this archive existed, so no text survives to quote. `U1` carries the full
reasoning for the replacement: DLT SMS registration had weeks of lead time on the launch
critical path, and the legacy `mobile` field is a *number* type that had already lost leading
zeros and `+91`, making it an account-takeover vector as a migration key. Phone OTP remains a
fast-follow *addition*, never a replacement.

---

# Part 2 — Build-log narrative

## Design system and motion — the `E13` write-ups, 2026-08-09

`S1`–`S34` all remain live in `docs/decisions.md`. What follows is the commentary written
around those tables as each `E13` task ran. It is history: it explains how the rules were
arrived at, not what the rules are.

### Taken on reading the brand guidelines — `E13-15`

`00_Graybag_Brand Guidelines.pdf` had never been read; `docs/design-tokens.md` was provisional
on that fact (`DS-05`). It has now been read in full. The rule going in was **the brand document
wins on anything about the brand**, and `S12`–`S15` are the four places that rule actually bit.
The per-change table is §0 of `docs/design-tokens.md`.

### The failing role pairs, and why they were all the same mistake — `E13-17`

`DS-06` listed five semantic-role pairs failing the bar `E13-13` will assert, and filed them
under "Needs Andy — brand" on the assumption that fixing them meant repainting brand colours.
Walking the whole §2.9 map found eight, and found that they are one error repeated. `S16`–`S20`
are the result.

**One of those is worth reading twice.** `forest-500` on `amber-500` is the pair the **brand
guidelines themselves recommend** — their Colour Usage Guide puts `#145F48` on "Text on
yellow/light backgrounds". It misses AA by six ten-thousandths. Text on brand amber is
`forest-700` (7.40), which honours the instruction and is legal. The brand document is right
about the *direction* and has no way to be right about the *number*, because it contains no
contrast analysis anywhere — which is the same fact that governs `DS-01`.

**What the brand document did *not* settle, and what got worse.** Its Colour Usage Guide assigns
`#00AF52` to **"Buttons & CTAs in UI"** in as many words. `S6`, the 500 rule, puts the button
fill at `primary-700` because white on `#00af52` is 2.90:1. **`DS-01` is therefore no longer a
correction to the mocks — it is a documented deviation from the brand guideline**, and that is
what `E13-14` now asks Andy to approve. It was not resolved here: `E13-15`'s mandate was to
reconcile, the brand document contains no contrast analysis to weigh against, and the change is
visible on every screen in the product. Recorded in §2.1 and §2.11 of the token file so that
nobody re-derives the conflict from scratch and quietly picks a side.

### Writing the tokens as code — `E13-01`

`packages/shared/src/design/` now exists: `color.ts`, `semantic.ts`, `type.ts`, `space.ts`,
`radius.ts`, `elevation.ts`, `index.ts`, and 129 assertions across three test files. Three
choices in it were not forced by `docs/design-tokens.md` — `S22`, `S23`, `S24`.

One thing the module deliberately does **not** do: it contains no contrast function. That
arrives with `E13-13`, which is the task that has a bar to assert.

### The lint gate names four paths, three of which do not exist — `E13-11`

`S31`–`S34` are the decisions. The test lints snippets at real paths against the **repository's
actual config**, not a fixture config, and asserts both halves of every exemption — that the
rule fires outside it and that it does not fire inside. "The rule is in the config" and "the
rule fires" are different claims and only the second is worth anything.

### The contrast test, and the hex that is three roles — `E13-13`

`S19` said the test asserts a declared list of pairs plus a second list asserted to keep
failing. Building it surfaced one thing that had not been anticipated, recorded as `S28`–`S30`.

`text.onBrand` on `bg.surfaceBrand` appears in **both** lists — legal at 3:1, forbidden at
4.5:1. That is the entire content of "large text and controls only", expressed as two
assertions rather than as a comment, and the test asserts it is the only pair allowed to
appear twice.

### The reduce-motion substitute is data, not a convention — `E13-12`

`S25`–`S27` are the decisions. The spring's numbers are asserted from physics rather than
transcribed: ζ = damping / 2√(stiffness·mass) must sit between 0.5 and 1 (below that it reads
as jelly, at 1 it does not pop, and the cart badge exists to be noticed from across the
screen), and the ~4τ settle must land inside the 350ms ceiling. That way a future tweak to
`stiffness` fails on the property that matters instead of on a number somebody copied.

One test bug of mine, fixed rather than accommodated: six staggered items is **five**
steps of 30ms, not six — the first item has no delay. The spec's own "150ms" was right and
my assertion was arithmetic.

### A timeout is only offered on a write that cannot move money — `E13-20`

`S21` is the decision. The reduce-motion substitute follows the same split rather than
collapsing to one label: Ending B reads "Waiting for your bank…" and does not time out. A
reduce-motion user must not get a version of the flow that quietly gives up where the default
one waits.

## The legacy design package is not in git — 2026-08-08

`RH1`–`RH4` stay live in `docs/decisions.md`: the package is kept outside git, the font licence
is still an open question (`E19-03`, `[DS-02]`), and the assets must never be committed again.
The narrative of the rewrite itself is history and lives here.

`Legacy-Application/` was removed from all 66 commits with `git filter-repo` on 2026-08-08,
before the repository had ever been pushed. Nothing was published, there were no
collaborators and no remote history, so this was the cheapest possible moment to do it —
every commit SHA below the root changed, which is only harmless because nobody had a clone.

**The assets are not lost.** They live at `../Legacy-Application-backup/` — a sibling of this
repository, `/Volumes/Data/AD/Projects/Claude/Code/GrayBag/Legacy-Application-backup`, 63
files, 46 MB, copied and verified byte-for-byte before the rewrite. `Legacy-Application/` is
now in `.gitignore`, so the directory can be copied back into the working tree whenever a
task needs it (`planning/OVERNIGHT.md` step 3 does exactly that) without any risk of it being
committed again.

**One caution, and it is still live.** `../Legacy-Application-backup/` contains
`Legacy-DB/gray-bag-23660.bubble`, the Bubble export with live secrets. It was never
committed — `*.bubble` has always been gitignored — and it must not be moved into this or any
other repository. Non-negotiable #5.

## The privilege baseline is stated, not inherited — 2026-08-08

`PB1`–`PB5` stay live in `docs/decisions.md`; they describe the privilege model the
authorization suite asserts against today. The framing below is why `0005` had to exist.

`0005_explicit_table_privileges.sql` closed `E02-25` and the implementation half of
`E02-21`. §10 of `docs/authorization-model.md` has always opened by asserting that *Supabase's
default privileges give `anon` and `authenticated` SELECT/INSERT/UPDATE/DELETE on new tables in
`public`, and RLS is what actually stops them*. That is true on a hosted project and false on
the local CLI stack, so `0001` and `0002` were revoking from a baseline they never established
— three layers of REVOKE and not one GRANT.

**The rollback is asymmetric and says so.** On a hosted project `0005`'s down migration also
removes the platform's own grant, because Postgres does not record who granted what. The end
state is therefore not the pre-`0005` state; it is an app returning permission denied for every
read, and a backend that cannot write. `0001` and `0002`'s revokes are deliberately not undone:
rolling back a baseline must never re-open a class-3 write.

## What the real Bubble export changed — 2026-08-08

`BR1`, `BR3`, `BR4`, `BR5` and `BR7` stay live in `docs/decisions.md` — `E16` has not run yet
and they are its constraints. `BR2` and `BR6` are in Part 1 above. The framing is here.

`E19-04`, the export dry run. Full evidence in `docs/bubble-recon-findings.md`; the export folder
itself is deleted after review and was never copied into the repo. Six of `E16`'s known constraints
were written from the schema and turned out to be wrong about the data.

**One thing the data confirmed rather than changed.** `order-total ÷ Σ line_total` is exactly
**1.05** on 280 of 282 non-draft orders. The `docs/mvp-scope.md` fact that menu prices are
GST-exclusive and 5% is added at checkout is not just Andy's recollection — it is measurable to the
paise in fourteen months of production orders. Every total also converts to whole paise with no
float artefact, so non-negotiable #3 costs nothing here.

## Authorization fixes found by running the suite — `E02-08` / `E02-09`

`AZ8`–`AZ10` stay live in `docs/decisions.md`. They were made on the first execution of
`supabase/tests/authorization.test.sql` — the run that turned three statements in
`docs/authorization-model.md` from claims into tested properties.

## Scope confirmations — 2026-08-07

`SC1` (Mohali only) and `SC2` (menu prices GST-exclusive) stay live in `docs/decisions.md` and
in CLAUDE.md's non-negotiables. Both were previously carried as "assumed" in
`docs/open-questions.md`; those entries are struck and point at the decision log.

**Consequence recorded at the time, and still tracked:**
`platform_config.price_is_tax_inclusive` is `NULL` in `0001`, which was deliberate — `[DM-20]`
chose "nullable and unset so tax calculation refuses to run until answered" precisely so that
this moment would be explicit. `0001` is already applied to staging and must not be edited
(`MG5`), so the value is set by a new migration and the column made `NOT NULL`. Tracked under
`E02-06`.

## One App Store Connect record for both profiles — `R9`, superseded by `R10` the same day

`R9` put `ascAppId` `6749555467` on **both** `submit.production` and `submit.preview`. Apple
rejected the first preview submission with `ITMS-90054`: an App Store Connect record accepts
exactly one bundle id, and `preview` builds `com.gracord.graybag.staging` — the identity
`E17-28` had split off precisely so internal builds could not touch the live app.

So `R9` was unsatisfiable from the moment it was written, and the reason nobody noticed is
worth keeping: the app id was correct, the bundle id was correct, and **nothing related the
two**. Each was asserted alone, and neither assertion could fail.

Replaced by `R10` — a second record, `6800175123`, for the staging bundle id, with the
record-to-identity pairing asserted in `apps/mobile/src/app-config.test.ts`. `R9`'s other
half, that `preview` must be an iOS store build to reach TestFlight at all, survives in `R10`.

## `G4` — the CGST/SGST versus IGST split, derived per invoice

**Superseded 2026-08-11 by `SC1`.** Replaced by the assertion form recorded in
`docs/decisions/gst-invoicing.md`: invoicing asserts `left(seller_gstin, 2) = '03'` and refuses
to issue if it does not, rather than deriving a split.

The original entry, as it stood:

> **The CGST+SGST versus IGST split is derived per invoice from the seller GSTIN's state code
> against `place_of_supply_state_code`. It is never hard-coded.** `M2` asserts intra-state on
> the basis that the place of supply is Mohali, but intra-state-ness depends on GrayBag's
> *registered* state, which is the first two digits of a GSTIN we do not have. Deriving it costs
> one comparison, makes `M2` a consequence rather than an assumption, and is what lets `D9`'s
> second city work at all. `[GST-02]`

**Why it went.** The premise expired rather than the reasoning failing. `G4` needed two
variables and `SC1` fixed one of them: the place of supply is `03` for every invoice v1 will
ever issue. A derivation over one unknown is an assertion wearing a branch, and the branch is
what `E07-21` then grew into a cart and checkout pricing path for a case with no school, no
kitchen and no menu in it. `D9`'s second city is still expected; it will need this decision back,
and it can have it when there is a second city.
