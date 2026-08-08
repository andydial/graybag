# Decisions — Navigation and the app shell

`NV1`–`NV4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E14-03`. `AR7` fixes the goal — signup-to-first-order conversion is a primary v1 goal,
not a quality attribute — and everything below is a choice about how the route graph makes that
hard to undo.

| # | Decision | Why |
|---|---|---|
| NV1 | **There is one navigator, not an authenticated one and an unauthenticated one.** `SessionProvider` sits above it and no route is conditional on session state | Two graphs is the shape that produces a sign-in wall, and it produces it without anybody deciding to: the moment an "authenticated navigator" exists, the cheapest place to put a new screen is inside it, and the menu ends up behind a gate one reasonable commit at a time. One graph means adding a gate is a visible, deliberate edit to a screen rather than a choice of which navigator to register in. `AR7` says the legacy funnel is the thing being replaced; this is the structural version of that |
| NV2 | **Exactly one screen is behind the gate, `SignIn`, and it is reached by intent — never by redirect on open.** It carries an `intent` param and is presented as a modal | A redirect fires as a side effect of arriving somewhere, which means the set of gated screens is whatever the redirect conditions happen to compute, and nobody can enumerate it. Reaching the gate by intent means the gate is a call site, and call sites are greppable — which is the only way `AR7`'s "any task that adds a step needs an explicit justification" can actually be reviewed. Modal rather than push because signing in interrupts something (a checkout); a push puts it in the back stack as a destination, and returning from it reads as going back rather than resuming |
| NV3 | **Four tabs — Home, Menu, Cart, Account — and `Orders` is a stack route, not a fifth tab** | `06_App UI/05.png` shows four and the design package is the authority on what the product looks like; a fifth tab is a design change nobody asked for, and five tabs on a 390pt-wide phone costs every tab its label. `E14-03`'s wording lists Orders among the destinations, which it is — it is reachable from Account and from Home, one tap from either place a returning parent would look. The test asserts the tab count so a fifth cannot arrive quietly |
| NV4 | **The `AR7` guarantee is asserted per route, in a test that names it**, rather than held as a review habit | The failure this prevents is not a decision anybody makes. It is one screen at a time, each with a defensible local reason, until browsing needs an account exactly as the legacy app did. A per-route assertion turns that into a failing test whose message says `AR7`, which is a conversation before a merge rather than a discovery after launch. `PUBLIC_ROUTES` is exported from the navigator so the list the test walks cannot drift from the list the app registers |

**Note on the tab labels.** React Navigation announces a tab as `"Menu, tab, 2 of 4"` — role and
position are part of the accessibility label rather than separate props. The tests match the
prefix, which asserts what a screen-reader user actually hears (`E13-08`'s territory) without
breaking when a later tab renumbers the others.
