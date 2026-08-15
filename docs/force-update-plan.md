# The force-update gate — what to set on 19 August, and what it does not do

**Nothing is set. `min_supported_app_version` is `0.0.0` on production today, which supports
everything.** This document is the plan; setting it is a deliberate act, described below.

---

## Read this first: the gate cannot reach the parents you are thinking of

The mandatory update on the 19th is about moving people off the **Bubble** app, version `3.7.0`.
`min_supported_app_version` **cannot do that**, and it is worth being exact about why before the
day rather than after:

- The gate works by the app calling `app_version_support(p_version)` on our Supabase project and
  obeying the answer. That RPC arrived in `0055`, and `VersionGate` is a screen in **this**
  codebase.
- `3.7.0` is the Bubble binary. It has never heard of `VersionGate`, does not call
  `app_version_support`, and does not talk to our Supabase project at all. **It asks nothing, so
  there is nothing to refuse.**

Setting the floor to `4.0.0` on the 19th therefore blocks **nobody**: `3.7.0` never asks, and
`4.0.0` is not below `4.0.0`. It is a no-op on the day, and believing otherwise is the risk this
section exists to remove.

**What actually moves parents off `3.7.0` is the Bubble freeze** (`docs/cutover-runbook.md`,
phase B): ordering and payments are disabled there, and the public Data API is locked. After
that, a parent still on the old app cannot order — not because we refused them, but because the
system behind that app has stopped. What they see is whatever Bubble shows, which is **not
controlled by this repository and is not a screen we have written**. If a clean message matters
on the day, it has to be arranged inside Bubble before the freeze, or by the store listing and
the email.

## What the gate *is* for

Being able to stop a **4.0.x** build that is actively harmful — a bad checkout path, a wrong
price, a compliance problem — where waiting for people to update is not acceptable and OTA
cannot fix it because the problem is native.

That is a real lever and it is worth having armed. It is just not the lever for the 19th.

## Setting it, when the time comes

```sh
# The value, and the words a parent will read. Both, in one statement.
psql "$PROD" -c "update platform_config
                    set min_supported_app_version = '4.0.1',
                        update_required_message   = 'GrayBag has a fix for ordering. Update to
                                                     carry on — your children, orders and
                                                     invoices are all still there.'
                  where id = 1;"
```

Then confirm what a real client is told, without a device:

```sh
curl -s -X POST "$SUPABASE_PROD_URL/rest/v1/rpc/app_version_support" \
  -H "apikey: $SUPABASE_PROD_ANON_KEY" -H "content-type: application/json" \
  -d '{"p_version":"4.0.0"}'
# expect: {"supported": false, "minimum_version": "4.0.1", "message": "…"}
```

**Three rules for the value:**

1. **Never set it above a version that is actually downloadable.** The floor must be a build
   already approved and released, or every parent is told to update to something that does not
   exist and has no way out. Check App Store Connect says `READY_FOR_SALE` first.
2. **Set the message in the same statement as the version.** `update_required_message` is `NULL`
   today, and the default copy is deliberately generic. If you raise the floor for a specific
   reason, say the reason.
3. **It takes effect immediately, on the next launch of every install.** There is no staged
   rollout, no percentage, no undo window. Setting it back to `0.0.0` releases everyone again,
   but anyone who was blocked in between saw the screen.

## What a blocked parent sees

`VersionGate` renders `UpdateRequiredScreen` — full screen, nothing behind it:

> **Time to update GrayBag**
>
> This version of GrayBag is too old to order with. Update to the latest version and everything
> will be where you left it — your children, your orders and your invoices.
>
> **[ Update GrayBag ]**
>
> Needs version 4.0.1 or newer.

The button opens the store listing. `update_required_message` replaces the middle paragraph.
There is no dismiss, no "later", and no way back into the app — which is the point, and also why
rule 1 above is not negotiable.

## What it will not do to a healthy parent

`VersionGate` was written to fail open, and `version-gate.test.tsx` pins eleven ways:

- the check is still in flight → **the app renders**, no spinner wall;
- the check fails, the network is down, the transport cannot do RPCs, the API was never
  configured, the answer is malformed, the RPC throws → **the app renders**;
- the build states no version, or an unparseable one → **supported**, deliberately.

Only an explicit `supported: false` blocks. A parent wrongly blocked has no recovery — the screen
says update, the store says they are already current — so every uncertain path admits.

## The decision, in one line

**On 19 August: set nothing.** The floor stays `0.0.0`. The cutover moves people, not the gate.
Arm the gate only if a released 4.0.x turns out to be harmful, and only ever to a version that is
live in the store.
