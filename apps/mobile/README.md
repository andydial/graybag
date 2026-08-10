# The mobile app — which build to install, and how to run it

This file exists because the answer was rediscovered twice at a cost of several hours each
time. If you are about to guess, read §2 first.

---

## 1. The three builds, and how to tell them apart

All three install **side by side**. You can hold all of them at once, and the home screen says
which is which without opening anything.

| EAS profile | Home screen | Bundle id | Talks to Metro? | JS comes from |
|---|---|---|---|---|
| `development` | **GrayBag Dev** | `com.gracord.graybag.dev` | **Yes** | your laptop, live |
| `preview` / `staging` | **GrayBag Staging** | `com.gracord.graybag.staging` | **No** | baked into the binary |
| `production` | **GrayBag** | `com.gracord.graybag` | No | baked into the binary |

**Inside the app, the Account screen's footer reads `Dev · 394dd2f`** — environment and the
commit the binary was built from. Screenshot it whenever you report anything; it is the only
thing that reliably answers "which build was that?".

---

## 2. "The dev client never connects to Metro"

**Almost certainly you have a `preview` build installed, not a `development` one.**

`preview` extends `staging`, and neither sets `developmentClient`. They are **standalone
release builds**: the JavaScript is compiled into the binary and there is no Metro client in
them at all. They open straight into the app with Metro stopped — because that is what they are
built to do. No amount of `npx expo start` will make one connect.

Every build in `eas build:list` as of 2026-08-10 was `Profile: preview`. There has never been a
dev client installed.

### The URL scheme is a red herring

`E17-28` gave staging the scheme `graybag-staging`, and Metro advertises
`exp+graybag://expo-development-client/?url=…`. Those look like they disagree and they do not:
**`exp+<slug>` is derived from the `slug` in `app.json` (`graybag`), not from the app's custom
scheme.** `expo-dev-client` registers `exp+graybag://` in any dev build regardless of what
`scheme` says. Chasing this cost an afternoon; it was never the problem.

### What to actually do

```bash
# 1. Build a dev client. Once per native change, not once per JS change.
cd apps/mobile
npx eas build --profile development --platform ios     # or --platform android

# 2. Install it from the link EAS gives you. It appears as "GrayBag Dev".

# 3. Start Metro, from apps/mobile:
npx expo start --dev-client

# 4. Open "GrayBag Dev" on the phone. It lists development servers — tap yours,
#    or use "Scan QR code" from inside the app.
```

Both machines must be on the same network. If the phone cannot see
`http://<your-lan-ip>:8081`, add `--tunnel`.

### When you need a new dev client build

Only when the **native** side changes: a new native dependency, a config plugin, an SDK bump,
or a change to `app.config.js` identity. JavaScript and React changes reach an installed dev
client over Metro with no rebuild. `E04-15` (AsyncStorage) is the next change that will need
one.

---

## 3. Reviewing without a dev client

Perfectly reasonable, and what Andy has been doing:

```bash
npx eas build --profile preview --platform ios
```

Installs as **GrayBag Staging**, points at the staging Supabase project, and carries whatever
commit it was built from — which the Account footer will tell you. You cannot hot-reload it, so
every change needs a new build; use the dev client when iterating.

---

## 4. Which git ref am I building?

**Whoever asks you to look at something must say which ref.** Branch work is not on `main`
until its PR merges, and building `main` to review a branch is a wasted twenty minutes — it has
happened once already.

```bash
git fetch && git checkout <ref> && npx eas build --profile preview --platform ios
```

The Account footer's commit hash is how you confirm afterwards that you got what you meant.

---

## 5. Environment variables

`.env` and `.env.staging` are gitignored, so **EAS builds do not get them from the repo**. The
values come from EAS environment variables per profile:

```bash
npx eas env:list --environment preview
```

A dev client is different: its JavaScript comes from Metro, so it reads the `.env` on your
laptop. That is why a dev client can point somewhere a `preview` build of the same commit does
not.
