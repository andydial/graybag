# Getting 4.0.0 onto the Play internal track

**I could not do this for you.** `eas submit --platform android` needs a Google Play service
account JSON, and there is none on this machine or in `~/.graybag-secrets/`. Creating one is a
Play Console action tied to your Google account (`E17-51`). Everything else is done: the bundle
is built, signed, and on the production update channel.

Three steps, about five minutes.

---

## 1. Download the bundle

```sh
curl -L -o graybag-4.0.0.aab \
  "https://expo.dev/artifacts/eas/K1wq3wx4jpl5gMld1nG_rhjc3Is7N2jaz_P2vh4B0g4.aab"
```

| | |
|---|---|
| Build | `ee8dfe09-ee30-4d8c-a990-08fdda62576d` |
| Package | `com.Gracord.Graybag` |
| Version | `4.0.0`, **version code `1786591933`** |
| Channel | `production` — so it receives OTA updates like the TestFlight build |
| Built from | `bd8b295` |

EAS artifact links expire. If that 404s, the current one is at the bottom of
`npx eas build:view ee8dfe09-ee30-4d8c-a990-08fdda62576d` (run from `apps/mobile`).

## 2. Upload it

Play Console → **GrayBag** → Testing → **Internal testing** → *Create new release* → drop the
`.aab` in.

Release notes — the same words as the App Store listing, so the two stores do not disagree:

> A new GrayBag. Faster menu, a clearer cart, and order history that stays put.

## 3. Roll it out

*Save* → *Review release* → **Start rollout to Internal testing**. Add yourself as a tester if
the list is empty (Testers tab → create an email list with your address).

Internal testing has no review queue, so it is installable within minutes — unlike the App
Store, where 4.0.0 is currently `WAITING_FOR_REVIEW`.

---

## What to expect, and the two things worth checking

**It will already be behind the OTA.** The bundle was built from `bd8b295`, before the fixes of
15–16 August. Because it is on the `production` channel with runtime `4.0.0`, it downloads the
current JS on first launch. That is the intended behaviour and it is also a free test of the
update path — see `docs/ota-updates.md`.

So when it installs, check the **Account screen footer**:

- `Production · bd8b295 · bundled` — the update has not applied yet. Force-close and reopen.
- `Production · bd8b295 · OTA c4342c44` — the update applied. The commit stays at `bd8b295`
  because that is the *binary*; the OTA id is the JS.

**Signing.** This is an EAS-managed upload key. If Play rejects it with a signing-key mismatch,
that means the Play listing expects a different key from the one EAS holds — stop and do not
"fix" it by generating a new key, because an upload key cannot be changed without Google's
help. `~/.graybag-secrets/graybag-upload.keystore` is the key this project has been using.
