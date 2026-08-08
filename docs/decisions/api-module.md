# Decisions — The `api/` module rule

`AP1`–`AP4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E14-02` while building `config/eslint-api-module.js`. `A4` and non-negotiable #1 fix
the rule; everything below is a choice about how it is **enforced**.

| # | Decision | Why |
|---|---|---|
| AP1 | **The gate ships before the `api/` module it polices, and names `packages/shared/src/api/**` as an exempt path that does not yet exist** | Identical reasoning to `S31`: the rule's whole job is to stop the *first* screen importing the Supabase client directly, and arriving after the first screen means arriving after the habit. `E13-11` proved the shape works and `E13-19` proved the failure mode — a gate that names paths nobody has built is fine; a gate that names the *wrong number* of them is not, which is why the test lints at each path rather than trusting the list |
| AP2 | **`no-restricted-syntax` is a single shared slot, and the api rules are composed into `designSystemConfigs()` rather than set in a block of their own** | This is `S33` promoted from a warning to a mechanism. ESLint flat config **replaces** a rule's options rather than merging them, so a second block setting `no-restricted-syntax` would not add the api gates — it would delete E13-11's design-system gates for every file it matched, silently, with the build still green. Passing them in as `extraRestrictedSyntax` means every exemption block downstream re-states the *composed* set, so an exemption for a hex cannot cost a secrets check. The regression test asserts one file failing a design rule and an api rule at the same time, and that every design-system exempt path still enforces the api rules |
| AP3 | **The write ban is not relaxed inside the `api/` module.** The module is exempt from "no Supabase query outside `api/`" and from nothing else | The natural shape is "the module is exempt", and it is wrong. `A4` says reads may use the client and **writes always go through Edge Functions** — the module exists to obey that rule, not to be excused from it. A write from the client is a write with no server-side idempotency key and no `order_event` row, which is the failure `D16` makes structural by putting idempotency in database constraints. Four tests, one per mutating verb, assert the ban holds at the one path where somebody would expect it not to |
| AP4 | **The server-only secret names are written down a second time in the lint config, and a test asserts the two lists are identical** | A lint config cannot import a TypeScript module, so `SERVER_ONLY_VARS` in `env.ts` and the copy in `eslint-api-module.js` cannot share a source. Same instinct as `S22`, where the brand hexes are duplicated into the test on purpose: the duplicate *is* the check. Without the assertion a fifth secret added to `env.ts` is simply unguarded by lint, and nothing anywhere says so. The string-literal selector sits alongside the member-expression one because `process.env['SUPABASE_SERVICE_ROLE_KEY']` reaches the bundle exactly as well as the dotted form |

**What this gate does not cover, said out loud** (the `S34` habit). It cannot see a Supabase
client obtained indirectly — passed in as a parameter, or re-exported under another name from a
module that is itself allowed to import it. The selector for a read matches
`supabase|client|db` as the receiver, which is a naming convention rather than a type check. An
approximate gate that fires on the ordinary case beats no gate, but only while nobody believes
it is complete: `E01-18` asserts the built bundle carries no server-only secret, and that is the
check with no false negatives.
