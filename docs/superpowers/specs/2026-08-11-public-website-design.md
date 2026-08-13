# The public GrayBag website — design

**Task:** `E12` (`E12-01`, `E12-02`, `E12-04`, `E12-07`, `E12-08`, `E12-09`), plus `E20-13`
(the three policy documents are published in `docs/` and linked from nowhere).

**Audience:** school decision-makers — principals, administrators, canteen managers —
evaluating a food partner. **Not parents.** Parents arrive through their school and go to the
app; nothing on this site is addressed to them.

**The single action a visitor can take:** get in touch about bringing GrayBag to their school.
One enquiry form, one destination. Everything else on the page exists to get them to it or to
let them leave informed.

---

## 1. What is deliberately absent

| Absent | Why |
|---|---|
| App-store badges and download buttons | Neither app is published. A dead download button is worse than none (`E12-05` stays open) |
| A back-office login link | `E12-06` is its own task, and a second call-to-action on a page whose whole job is one call-to-action costs more than it earns |
| Any parent-facing signup | Parents arrive through their school. A parent path here would dilute the one message a principal needs |
| A cookie banner | The site sets no cookies and loads no third-party script, so there is nothing to consent to. A banner would be theatre |
| Prices | A per-school commercial conversation, not a web page |

---

## 2. Stack

**Astro 5 with the Netlify adapter, in `apps/web`.** No web framework decision existed in the
log; this becomes `A9`.

| Considered | Verdict |
|---|---|
| **Astro** | **Chosen.** Ships zero JavaScript by default, which is the whole of `P11` — the constraint is network, not CPU. Real static HTML for `E12-07`'s SEO. React islands are available for the admin, kitchen and school-report surfaces `P7` says land in this same app later, so the choice does not have to be revisited then |
| Next.js | A server runtime and a hydration payload for a page that needs neither. Heavier on Netlify, and its value (data fetching, routing at scale) is value this page cannot spend |
| Vite + React SPA | Fails first paint and SEO outright. A marketing page that renders from JavaScript on a patchy Indian mobile connection is a blank screen |

**Tokens.** `apps/web` generates `src/styles/tokens.css` from `@graybag/shared`'s
`cssVariableSheet()` at build time. Every colour, size, radius, weight and duration in the site
is a `var(--gb-*)`. This is decision `S8` — one source, two outputs — and it is what stops the
site drifting from the app. `scripts/build-tokens.mjs` writes the file; a test asserts the
checked-in copy matches what the generator produces, so a token change that is not regenerated
fails CI rather than shipping a stale palette.

**Type.** Nunito 400/500/600, self-hosted as latin-subset `woff2`, preloaded, `font-display:
swap` with a `size-adjust` fallback so the swap does not reflow. Nunito is SIL OFL, so unlike
VAG Rounded Next it can be committed and served without `E19-03` being answered — decision
`DS-02` already names it as the substitute.

---

## 3. Photography — what is actually available

`tools/mirror-dish-images/manifest.json` records 82 resolving dish photographs. **Every one of
them is between 80 and 213 pixels wide; 72 of the 82 are exactly 120 × 120.** The bytes on disk
match the manifest checksums, and the Bubble CDN was probed directly — both `?w=` and the
Cloudflare `/cdn-cgi/image/w=1200/` path return 120 × 120. There is no higher-resolution
original. This is the company's real catalogue photography, at the size it was shot for.

**Consequence for the design, stated rather than worked around:** there is no full-bleed food
hero, and there cannot be one from this source. Blowing a 120px asset up to 1200px would look
exactly like what it is.

So the food is carried by **a dense mosaic of small rounded dish tiles**, displayed at 72–88 CSS
pixels, where a 120px asset is still above 1× and acceptable at 2×. That is honest, and it says
the thing a principal actually needs to hear — *the menu is broad and it is real food* — better
than one large photograph would.

**Real photography is an `owner:andy` task**, appended to `E12`, and it is the single biggest
available upgrade to this page.

### Assets committed to the repository

`RH1` keeps the 46 MB design package outside git. That reasoning — undiffable binary sources
that change twice a year and are read by humans — does not extend to a few hundred kilobytes of
web-optimised build inputs that CI cannot build without. Netlify's checkout has no access to
`~/graybag-dish-images` or to `../Legacy-Application/`.

So `apps/web/public/img/` holds a **curated, re-encoded, budgeted** set:

- 5 dish tiles, WebP, 120px, one per menu category
- the logo (full-colour and white lockups) and one pattern tile
- the OG/social preview image

`scripts/build-web-assets.mjs` regenerates all of it from the mirror and the design package, so
the committed files are an output with a reproducible input, not a hand-curated pile.
`apps/web/public/img/MANIFEST.json` records provenance and byte counts, and a test asserts the
directory stays under its size budget. Recorded as an amendment to `RH1` (`RH5`). The committed
set is **113 KB**; it was 232 KB before the food section was cut from 28 tiles to five.

---

## 4. The page

One page. A principal reading on a phone between two meetings gets the whole argument by
scrolling, and the form is reachable from the top.

| # | Section | Job |
|---|---|---|
| 1 | **Hero** | What GrayBag is, in one sentence a principal can repeat to a colleague: parents order and pay in advance from their phone, food arrives at the right child at the right break, no cash at school. Pattern-on-green. One CTA |
| 2 | **How it works** | Four steps, showing the parent side and the school side together — because the school's question is "what does this cost *me* to run", and the answer is "nothing you do not already do" |
| 3 | **What the school stops dealing with** | The benefit block: no cash handling, no queues at the counter, allergen-aware ordering, per-school reporting, a kitchen already operating in Mohali |
| 4 | **The food** | Five category cards (§3). The menu is built per school and rotates; every descriptive line is checkable against the catalogue, and no nutrition claim is made |
| 5 | **Already serving schools across Mohali** | **No school is named** (Andy, 2026-08-11) until each agrees in writing — `E12-11`. What stands in place of a reference list is an invitation to come and watch a morning's delivery, which for a principal is worth more than a logo strip |
| 6 | **The monthly report** | `P6` — a real artefact the principal receives, not a portal they must remember to visit |
| 7 | **Questions administrators ask** | Short, honest answers: what it costs the school, what we need from you, how allergies are handled, food safety |
| 8 | **Enquiry form** | The one action |
| 9 | **Footer** | Privacy, terms, refunds, the DPDP grievance officer, company identity |

**Voice.** The brand's lowercase habit is a headline device only (`design-tokens.md` §3.3):
allowed on the hero display line, sentence case everywhere else.

**Colour.** The 500 rule (`§2.1`) holds here exactly as in the app — `primary-500 #00af52` is
the identity green for brand fields and the pattern and carries nothing legible; every button,
link and price is `primary-700`. The site is bound by the same `LEGAL_PAIRS` table the app is.

---

## 5. The enquiry form

**Fields:** name, role, school, city, email, phone, message. All required except message; role
is a select with an "other" free-text fallback, city defaults to Mohali and stays editable.

The legacy `Interest_Submission` (`findoutmoresubmission`) carried
`name, email, phone, city, school, message, reason_to_use, most_important_thing`. The last two
are dropped: they were survey questions answered by nobody in a hurry, and a longer form on a
patchy connection converts worse. Everything else maps one to one.

**Behaviour.** A plain HTML `POST` that works with JavaScript disabled, progressively enhanced
to an inline success state. No captcha — a captcha is third-party JavaScript on exactly the
connection this site is built for. Spam is handled by a honeypot field and a
submission-timing floor, both checked server-side.

**Persistence and notification.** The form posts to a Supabase Edge Function `enquiry-submit`
in `ap-south-1`, which inserts an `enquiry` row and sends one notification email.
**Netlify Functions are not used** — `A5` rules them out for API work because they have no India
region. Writes go through an Edge Function, which is `A4` and non-negotiable #1.

`supabase/` belongs to another thread. This design therefore ships:

- the form, its validation, and the payload builder, in `apps/web`, with tests
- `docs/enquiry-submission-contract.md` — the table DDL, the RLS posture, the function
  signature, the error codes and the notification shape, written to be implemented as-is
- a local mock endpoint so the form is runnable and testable today

**Notification address** is `ENQUIRY_NOTIFY_EMAIL`, unset by default and flagged, sent from
`GrayBag <orders@graybag.com>` per `U4`.

**No child data is involved,** so nothing here is tier P or S. The submitter is an adult acting
in a professional capacity. Their name, email and phone are ordinary personal data: the privacy
notice's existing "enquiries" purpose covers it, retention is stated, and the row is not logged.

---

## 6. Policy pages

`/privacy`, `/terms`, `/refunds` are rendered at build time from `docs/privacy-policy.md`,
`docs/terms.md` and `docs/refund-policy.md`. **The markdown stays the source** — `PP1` says one
source per fact, and a second copy of a legal document is the worst possible place for a fork.

The documents contain `«…-PENDING-…»` tokens guarded by `E20-22`. The build **fails** if a page
renders with an unresolved token in it, because a published policy with a placeholder in it is
worse than an unpublished one. Until `E20-01` resolves them, the pages carry a visible
pre-launch notice — which is honest, and which stops the DNS cutover (`E12-10`) happening with
placeholder law on the site.

---

## 7. Performance and accessibility budgets

`E12-08` asks for thresholds with actual numbers. These are they, enforced in CI:

| Budget | Threshold |
|---|---|
| Third-party requests | **0** |
| JavaScript shipped to the browser | ≤ 10 KB gzipped |
| HTML, home page | ≤ 45 KB gzipped |
| CSS | ≤ 18 KB gzipped, one file |
| Total home-page payload | ≤ 400 KB |
| Fonts | 3 files, subset, preloaded |
| Lighthouse performance | ≥ 95 (mobile, simulated slow 4G) |
| Lighthouse accessibility | 100 |
| axe violations | 0 |

Images are `loading="lazy"` below the fold, explicit `width`/`height` on every one so nothing
shifts, and AVIF with a WebP fallback.

---

## 8. Testing

| What | How |
|---|---|
| Enquiry validation (every field, every failure) | vitest, pure functions in `src/lib/` |
| The payload sent to `enquiry-submit` | vitest, asserted against the contract document's shape |
| Tokens are not stale | vitest — regenerate and compare to the committed `tokens.css` |
| No colour literals in the site's CSS | a test that greps the built CSS for hex outside `tokens.css` |
| Policy pages carry no unresolved `«PENDING»` token | build-time assertion, fails the build |
| Committed image budget | vitest against `public/img/MANIFEST.json` |
| Every internal link resolves | build-time crawl of the emitted `dist/` |

---

## 9. What this design needs from elsewhere

| Need | Owner |
|---|---|
| `enquiry` table + RLS + `enquiry-submit` Edge Function + notification email | the `supabase/` thread, to `docs/enquiry-submission-contract.md` |
| The notification address for `ENQUIRY_NOTIFY_EMAIL` | Andy |
| Whether the three named schools may be named publicly | Andy |
| Real photography — the one big upgrade this page can get | Andy |
| `E20-01` resolving the `«PENDING»` tokens before `E12-10` | Andy / lawyer |
