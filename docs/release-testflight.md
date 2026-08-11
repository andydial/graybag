# Getting a build to TestFlight

For putting GrayBag in front of someone who is not on your wifi and not holding your laptop.

Decision `R9`. App Store Connect app id **6749555467**, team **Graycord Pty Ltd (F247T8Y2NT)** —
both now in `apps/mobile/eas.json`.

---

## What changed, and why you could not have done this before

`preview` extended the `staging` build profile, which is `distribution: "internal"`. That is an
**ad-hoc build**: it installs only on devices whose UDIDs are registered on the provisioning
profile. Which means it could never have reached a tester who is not holding a device you have
already registered — the exact thing you are trying to do.

TestFlight only accepts a **store** build. So `preview` now sets `ios.distribution: "store"` and
`android.buildType: "app-bundle"`, while keeping `APP_ENV=staging` and the `staging` update
channel.

The result is the combination that matters: **a store-signed binary pointed at the staging
backend.** Your tester gets it through TestFlight like any App Store beta, and it talks to
staging, not production.

---

## Run this

Both commands from `apps/mobile/`.

```bash
# 1. Build. ~15-25 min on EAS's queue. It will ask to generate a distribution
#    certificate and provisioning profile the first time — say yes; EAS manages them.
eas build --platform ios --profile preview

# 2. Submit the build you just made to App Store Connect.
eas submit --platform ios --profile preview --latest
```

`--latest` takes the most recent finished build for that profile, so you do not have to paste a
build id.

Then, in App Store Connect → **TestFlight**:

1. The build appears as "Processing" for 5–15 minutes. It is not available until that clears.
2. It will ask for **export compliance**. GrayBag uses HTTPS only and no proprietary encryption,
   so the answer to "does your app use non-exempt encryption" is **No**. Answer it once; it is
   remembered per version.
3. Add your tester under **Internal Testing** (up to 100 people, no review needed, available
   within minutes) — that is what you want. **External Testing** needs a Beta App Review and
   takes a day or more; do not start there.
4. They get an email, install **TestFlight** from the App Store, and open the invite.

**Internal testers must be added as Users in App Store Connect first** (Users and Access), with
any role. That is the step people miss.

---

## The API key, so submitting stops needing you at a 2FA prompt

Create it once. **App Store Connect → Users and Access → Integrations tab → App Store Connect API
→ Team Keys → the `+` button.**

| Field | Value |
|---|---|
| **Name** | `graybag-eas-submit` |
| **Access / role** | **App Manager** |

> Why App Manager rather than Admin: App Manager can upload builds and manage TestFlight, which is
> everything a submission needs, and cannot change users, banking or agreements. Developer is not
> enough — it cannot manage TestFlight distribution.
>
> It must be a **Team Key**, not an Individual Key. Individual keys inherit your personal
> permissions and break when your role changes.

**Download the `.p8` immediately.** Apple lets you download it exactly once, and there is no way
to retrieve it afterwards — if it is missed, the only path is to revoke the key and make another.

You need three values:

1. The **`.p8` file** itself (named `AuthKey_XXXXXXXXXX.p8`).
2. The **Key ID** — the 10-character string in the key's row, also in the filename.
3. The **Issuer ID** — a UUID shown once at the top of the Team Keys section, above the table. It
   is the same for every key on the team and it is easy to miss.

### Where to put it

**Not in the repository.** Non-negotiable #5 is about the Bubble export, but the reasoning is
identical: this key can upload builds to our App Store listing.

```bash
mkdir -p ~/.graybag-secrets
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/.graybag-secrets/
chmod 600 ~/.graybag-secrets/AuthKey_*.p8
```

Then hand it to EAS once, and it is stored server-side against the project:

```bash
cd apps/mobile
eas credentials --platform ios
# → select the `preview` profile
# → App Store Connect API Key → Set up your own
# → give it the path, the Key ID and the Issuer ID
```

After that, `eas submit` runs unattended — no 2FA prompt, and it works from CI.

**Tell me the Key ID and Issuer ID when you have them and I will finish the wiring.** Do not paste
the contents of the `.p8` into the chat — it is a private key, and the file path is all I need.

---

## Android, while you are here

The same `preview` profile now produces an `.aab`, which is what Play wants. Play needs a service
account JSON before `eas submit --platform android` will work, and that is a separate errand
(`E17-12`). iOS first — it is the one with a tester waiting.

---

## What the tester will see

A **staging** build. Which means:

- The build label at the foot of Account reads `staging · <commit>`. If they screenshot anything,
  that line tells us which binary it was.
- Empty screens carry a diagnostic panel (`E14-31`) showing school id, cache version, source and
  row count. It is deliberately non-production only, so it will be visible to them.
- The data is the real Sky Bites catalogue on the staging project — real dish names and real
  prices, but **not** the production database. Nothing they do creates a real order.
- Payments are Razorpay **test** keys. No real money moves.
