# `apps/web` — the public GrayBag site

The sales page for school decision-makers, the three policy documents, and (later) the admin,
kitchen-ops and school-reporting surfaces `P7` puts in this same app.

**Audience: principals, administrators and canteen managers.** Not parents — parents arrive
through their school and go to the mobile app. Nothing here is addressed to them.

**One action: get in touch.** One enquiry form, one destination.

---

## Running it

```bash
npm install                 # from the repository root, once
npm run dev:web             # http://localhost:4321
```

That is all you need for the whole site. The dish photographs, the brand assets, the font and
`tokens.css` are all committed, so a clean checkout runs with no build step and no network.

```bash
npm run build:web           # build + budget, link and store-link checks
npm run check:a11y          # axe-core against every built page, in a real browser
npm --prefix apps/web test  # 120 unit tests
```

The enquiry form posts to a **local mock** in development
(`scripts/dev-enquiry-endpoint.mjs`), which implements
`docs/enquiry-submission-contract.md` exactly and appends each submission to
`.dev-enquiries.jsonl`. Fill the form in and look at that file. The mock is registered only when
Astro's command is `dev`, so it can never reach a build.

### Regenerating the committed inputs

Only needed when the design package, the dish mirror or the design tokens change. All three
write files that are committed:

```bash
npm --prefix apps/web run tokens    # tokens.css, from packages/shared/src/design (S8)
npm --prefix apps/web run assets    # public/img/*, needs ../Legacy-Application + the dish mirror
npm --prefix apps/web run fonts     # public/fonts/*, needs network
```

`npm run build` fails if `tokens.css` is stale, so a token change nobody regenerated stops CI
rather than shipping a palette that disagrees with the app's.

---

## How it is put together

| | |
|---|---|
| **Astro 5, `output: 'static'`, no adapter** | Ships zero JavaScript by default (`P11` — the constraint is network, not CPU), real HTML for SEO, and React islands are available later for the admin surfaces without revisiting the choice. Decision `A9` |
| **Netlify** | `A5`. Static on a CDN. Netlify Functions are **not** used — `A5` rules them out for API work because Netlify has no India region |
| **Supabase Edge Function for the one write** | `A4`, non-negotiable #1. The site holds no Supabase key of any kind |
| **No nutrition or health claims** | The positioning is healthy school food, made **by description**. "Healthy", "nutritious", "wholesome" and their family are close to nutrition claims under the FSSAI Labelling and Display regulations and need substantiation we do not hold, so a unit test fails the build if any of them appears in the copy. What is said instead — atta bases, brown bread, quinoa and sprouts — is verifiable against `tools/mirror-dish-images/manifest.json` |
| **No service-level dietary claim** | The same test bans "vegetarian", "no meat", "meat-free" and their family **as statements about the service**, because non-vegetarian food is planned and a dietary position we intend to change is not something to sell a school on. The per-dish veg / egg / non-veg marker vocabulary is untouched — it is a fact about one dish and stays true however the menu changes. What the site says instead is that the school chooses its own menu and every dish is marked |
| **`tokens.css` generated from `packages/shared/src/design`** | `S8`, one source and two outputs. Every colour, size, radius and duration on the site is a `var(--gb-*)`; a test asserts the committed file matches its generator, and another asserts `site.css` contains no colour literal |
| **Nunito, self-hosted, one variable file** | `DS-02`. VAG Rounded Next is the brand face and its licence is unresolved (`E19-03`), so it is never served. Self-hosted because the budget is zero third-party requests |

## Things that are true and easy to break

- **No app-store links, anywhere.** Neither app is published; `E12-05` stays open. The build
  fails if a store URL appears in any page, and a unit test fails if one appears in the copy.
- **No third-party requests.** No analytics, no fonts CDN, no embeds, no captcha. Enforced by
  `scripts/check-build.mjs` and again by the CSP in `netlify.toml`.
- **The policy pages are a view of `docs/`, not a copy** (`PP1`). All three are still drafts,
  and **a production build containing an unresolved `«…-PENDING-…»` token fails** (`E20-22`).
  That is why they render with a pre-launch notice today.
- **The photographs are 120 pixels and are never upscaled.** See below.
- **No school is named.** The three names that were here are out until each agrees in writing
  (`E12-11`), and a test fails if one reappears.
- **Nothing implies GrayBag is a vegetarian service.** Non-vegetarian food is planned. The page
  argues the school's control over its own menu instead, which stays true either way.

## The photography, which is the one thing that constrains the design

Every dish photograph GrayBag owns is between 80 and 213 pixels wide; 72 of the 82 are exactly
120 × 120. That was checked against the source CDN directly — both `?w=1200` and the Cloudflare
resize path return 120 × 120, so no larger original exists.

There is therefore **no full-bleed food hero available**. The food section does not try to win
on photography: it is five category cards — a breakfast, a main, a wrap, a salad, a bake — with
the photograph at 96 CSS px beside the copy rather than carrying the section. The argument is
made in words, and the words are checkable against the catalogue.

**Real photography is the single biggest available upgrade to this page.** It is an `owner:andy`
task on `E12`.

## Layout

```
scripts/          build-tokens · build-web-assets · fetch-fonts · check-build · check-a11y
                  dev-enquiry-endpoint (astro dev only)
src/content/      the copy, as typed data, with every factual claim sourced
src/lib/          enquiry validation, policy rendering — pure, tested
src/styles/       tokens.css (generated, committed) · site.css
src/components/   EnquiryForm · Icon
src/layouts/      Base
src/pages/        index · [policy] · thanks · robots.txt · sitemap.xml
public/img/       committed build output — see MANIFEST.json for provenance and budget
public/fonts/     Nunito, SIL OFL — see SOURCE.txt
```
