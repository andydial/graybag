# Decisions — Architecture

`A1`–`A8` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

| # | Decision | Why |
|---|---|---|
| A1 | **React Native + Expo** for mobile, not Flutter | Flutter has a genuine edge in animation on bottom-tier Android and Shorebird gives it OTA. But Claude Code produces better TypeScript than Dart, Flutter Web is unusable for the marketing site (so web is TS either way), and EAS Build/Submit/Update is materially simpler for a solo non-developer. Output quality beat the framework's ceiling. |
| A2 | **Supabase in Mumbai (`ap-south-1`)** for Postgres, Auth, Storage, Edge Functions | ~2ms to Mumbai vs ~200ms to the US, per request. Runs on AWS ap-south-1, not consumer Indian infrastructure. Data residency for free. Fewest vendors. |
| A3 | **No separate API server in v1** | Edge Functions cover it. Kept cheap to add later by the `api/` module rule (A4). |
| A4 | **All app backend calls go through one `api/` module**; reads may use the Supabase client, **writes always via Edge Functions** | Makes "add a dedicated API server" a base-URL change, not a rewrite. Enforced by a lint rule. |
| A5 | **Netlify** for the marketing site + admin web | Static/edge, global CDN. Netlify Functions are *not* used for the API — they have no India region. |
| A6 | **Razorpay only**; Stripe removed entirely | Stripe was half-wired and adds a whole surface for no benefit. |
| A7 | **Two environments (staging + prod) plus PR previews** | Eliminates the current practice of hand-swapping Razorpay keys to test. Costs ~$0–10/month. |
| A8 | **Sentry + Better Stack**, both wired into Claude Code via MCP | Andy is not a developer. Supabase is an official Claude connector; Sentry has an official MCP server. Failures can be investigated by describing them in English. |
| A9 | **Astro 5, static output, no adapter**, for `apps/web` — the marketing site and, later, the admin/kitchen/report surfaces `P7` puts in the same app | Made in `E12`, because no web framework had ever been chosen and `A1` only ruled Flutter Web out. Astro ships **zero JavaScript by default**, which is the whole of `P11`: the binding constraint is a patchy Indian mobile connection, not device CPU. It emits real HTML, so `E12-07`'s SEO is a property of the output rather than something to bolt on. And it supports React islands, so the authenticated surfaces land later without revisiting this. **Next.js** was rejected as a server runtime and a hydration payload for pages that need neither; a **Vite SPA** was rejected outright — a marketing page that renders from JavaScript on a bad connection is a blank screen. `output: 'static'` and no adapter means the deploy has no cold start and nothing that can fall over. The one write on the site is an Edge Function, per `A4`/`A5` |

