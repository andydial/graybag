# Installing GrayBag on your Android phone today

**Direct download, no Play Console, no review:**

<https://expo.dev/artifacts/eas/BeF0MsEDTsFqVJ9leSH_S01LPLZjV2CVufTFgZ3bqUQ.apk>

Open that link on the phone, tap the download, then tap the file. Android will ask you to allow
installing from your browser — that permission is per-app and per-source, and you can revoke it
afterwards.

| | |
|---|---|
| Build | `db632eb3-cbb8-438f-88c6-3a201df658d6`, profile `production-apk` |
| Package | `com.Gracord.Graybag` — **"GrayBag"**, no suffix |
| Version | `4.0.0`, version code `1786591934` |
| Built from | `0f5f89c` |
| Backend | **production** |
| Payments | **live** Razorpay key |

It installs alongside "GrayBag Staging" and "GrayBag Dev" if you have them — different package
names, different icons, different data.

## Verified before it was sent

Not assumed — the APK was downloaded and its JS bundle inspected:

- production Supabase host present, **staging host: zero occurrences**
- `rzp_live_` key present
- the single `rzp_test` hit is the prefix *constant* in `env.ts`, not a key

This check exists because the first OTA published on 16 August silently carried staging
(`E17-57`), and the manifest was the only thing that showed it.

## What you should see, and what it proves

The **Account screen footer** names the running JS:

```
Production · 0f5f89c · bundled        ← the JS inside the APK
Production · 0f5f89c · OTA 01a007e    ← an over-the-air update applied
```

`0f5f89c` is the commit the **binary** came from and never changes. The third segment is the
update. Seeing it switch from `bundled` to `OTA …` on a relaunch **is** the end-to-end proof
that over-the-air shipping works — that is the whole point of the label.

> **The id shown is the platform update id, not the group id.** `eas update` and
> `eas update:list` print the *group* (`9f45a793…`); each platform inside it has its own id, and
> the app reports the one it is running — currently `01a007e9…` for Android. They are different
> strings for the same publish. Match on the publish message or the timestamp, not the prefix.

If it still says `bundled` after a relaunch: force-close from the app switcher and reopen.
Backgrounding is not enough — `expo-updates` checks on cold start.

## Paying — read this before you try

**Place the order and pay in one go.** There is no way to pay an order after leaving the
checkout flow (`E05-54`): if the Razorpay sheet is dismissed, or the app is backgrounded, or the
network drops, the order sits at "Payment pending" for ever. The screen will tell you it "will
close by itself" — it will not, and it will also block deleting that child until someone clears
it in the database.

Also: **the school serves Mon–Sat**, so today (Sunday) is refused. Order for tomorrow. The
refusal currently reads *"One of the dishes is no longer on the menu for that day"*, which points
at the dish rather than the day (`E05-55`) — that is the wrong message, not a broken menu.

Nothing has ever been paid on the live account, so yours will be the first real payment. It is a
live key and real money.
