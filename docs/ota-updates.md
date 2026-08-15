# Shipping a fix over the air

**The one line.** From the repository root, on the commit you want live:

```sh
npm run ship:ota -- "what changed"
```

That is `eas update --branch production --message "…"`. It publishes the current working tree's
JS to every install of the matching app version, usually within a minute of the next app launch.

Nothing else is required. No build, no review, no store.

---

## What it can and cannot fix

**`runtimeVersion` is `appVersion`** (`app.json`), so an update only reaches builds carrying the
*same* app version — `4.0.0` right now. That is the guarantee that makes OTA safe: a JS bundle
can never land on a binary whose native side it needs.

| Change | Ships over the air? |
|---|---|
| Screen copy, layout, colours, spacing | **Yes** |
| Business logic, validation, pricing display, error handling | **Yes** |
| A new call to an existing Edge Function or table | **Yes** |
| Anything under `supabase/` | Not applicable — that is a migration, and it is live the moment you apply it |
| A new native module, an Expo SDK bump, a permission string | **No — needs a new build and a new review** |
| A change to `app.json`'s `version` | **No, and it breaks OTA for the old version** — see below |

The last row is the trap. Bumping `version` to `4.0.1` changes the runtime version, so updates
published afterwards reach **nothing** until a `4.0.1` binary is in people's hands. During the
launch window, leave `version` alone and ship JS.

## Confirming it actually landed

The Account screen's footer says which JS is running:

```
Production · 394dd2f · bundled        ← the JS baked into the binary
Production · 394dd2f · OTA 4625c38    ← a downloaded update, id shown
```

`394dd2f` is the commit the **binary** was built from and never moves when an update lands —
that is why the third segment exists. Match the `OTA` id against:

```sh
npx eas update:list --branch production
```

**On build 12 this is self-proving.** That binary was compiled before the OTA segment existed,
so the segment can only appear if an update replaced its JS. If you see `· OTA …` at all, the
update applied.

## When it applies

`expo-updates` checks on launch and `fallbackToCacheTimeout` is 10 seconds, so:

- a new update is usually **already running on the next cold start**;
- if the network is slow, that launch uses the cached bundle and the update applies on the
  launch after.

Force it while testing: kill the app from the app switcher and reopen it. Backgrounding is not
enough.

The app never reloads under you mid-session. That is deliberate — `applyUpdateNow` exists and
nothing calls it from a timer or a focus listener, because a reload during checkout is how a
payment reaches a state nobody can reconcile.

## Rolling back

There is no undo. You publish a *new* update whose contents are the last good commit:

```sh
git stash                       # or: git checkout <last-good-sha>
npm run ship:ota -- "rollback to <sha>"
```

Check what is currently out before you do, so you know what you are reverting to:

```sh
npx eas update:list --branch production --limit 5
```

## If an update must not be skipped

OTA is the fast lever for a *fix*. Making a version mandatory is a different mechanism —
`min_supported_app_version` in `platform_config`, described in `docs/force-update-plan.md`. Do
not reach for OTA to force anything; it cannot, by design.
