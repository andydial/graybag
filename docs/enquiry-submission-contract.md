---
title: The enquiry-submission contract
status: The web half is built (`E12-02`). The Supabase half is specified here and not yet built.
covers: E12-02, and the table that replaces the legacy `Interest_Submission`
audience: whoever owns `supabase/` — this is written to be implemented as-is
---

# `enquiry-submit` — the contract

The public website's enquiry form is built and working (`apps/web/src/components/EnquiryForm.astro`).
It posts to an Edge Function that does not exist yet. **This document is that function's
specification**, written by the side that calls it so the two halves cannot disagree.

Nothing in `supabase/` has been touched by the web thread. The migration and the function belong
to whoever owns that directory.

Until it lands, `apps/web` posts to a local mock (`apps/web/scripts/dev-enquiry-endpoint.mjs`)
that implements exactly the shapes below. The mock is registered only when Astro's command is
`dev`, so it cannot reach a build.

---

## 1. Why an Edge Function and not a Netlify Function

`A5`: Netlify is the CDN, and **Netlify Functions are not used for API work** because Netlify has
no India region — a form post from Mohali would round-trip to Virginia. `A2` puts Supabase in
`ap-south-1`, ~2 ms away.

`A4` and non-negotiable #1: **writes always go through Edge Functions.** An enquiry is a write.
The site is static and holds no Supabase key of any kind.

---

## 2. The table

Replaces the legacy Bubble `Interest_Submission` (`findoutmoresubmission`), which held
`name, email, phone, city, school, message, reason_to_use, most_important_thing`
(`docs/legacy-bubble-schema.md`).

**`reason_to_use` and `most_important_thing` are dropped.** They were survey questions answered
by nobody in a hurry, and a longer form on a patchy connection converts worse. Everything else
maps one to one.

```sql
create type enquiry_role as enum (
  'principal',
  'vice_principal',
  'administrator',
  'canteen_manager',
  'management',
  'other'
);

create table public.enquiry (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  name          text  not null check (length(btrim(name))    between 2 and 80),
  role          enquiry_role not null,
  school        text  not null check (length(btrim(school))  between 2 and 120),
  city          text  not null check (length(btrim(city))    between 2 and 60),
  email         text  not null check (length(email) <= 254 and position('@' in email) > 1),
  -- Normalised to +91XXXXXXXXXX by the client and re-normalised by the function. Stored as
  -- text, never as a number: the legacy `mobile` column was a Bubble *number* field and lost
  -- every leading zero and every `+91` it was ever given (see U1).
  phone         text  not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  message       text  null     check (message is null or length(message) <= 2000),

  -- Operational, not content. Who has picked this up and what came of it.
  status        text  not null default 'new'
                  check (status in ('new', 'contacted', 'qualified', 'declined', 'spam')),
  notes         text  null,

  -- Provenance, for working out where enquiries come from. No IP address and no user agent:
  -- neither is needed to answer an enquiry, and both are personal data we would then have to
  -- justify holding.
  source        text  not null default 'website'
);

create index enquiry_created_at_idx on public.enquiry (created_at desc);
```

### Authorization

`D`-series default-deny, non-negotiable #2. The legacy table's rule was **"everyone: create only;
creator: full"**, which `docs/legacy-bubble-schema.md` assessed as *correct* — one of the few
things the Bubble app got right. Keep the shape, drop the "creator" half, because a website
visitor has no account:

```sql
alter table public.enquiry enable row level security;
-- No policy for anon or authenticated. Nothing may read this table through PostgREST.
-- Inserts arrive only via the Edge Function's service role; back-office reads come later
-- through a scoped grant (D3), when there is a back office to read them.
```

**There is deliberately no `anon` insert policy.** Letting the browser insert directly would put a
public, unrate-limited write endpoint on the database, and it would break `A4`. The function is
the only writer.

---

## 3. The endpoint

`POST /functions/v1/enquiry-submit`

It must accept **two content types**, because the form works with JavaScript disabled:

| Content type | Who sends it | Success response |
|---|---|---|
| `application/json` | The enhanced form (`fetch`) | `201` + JSON body |
| `application/x-www-form-urlencoded` | A native browser form post, no JS | `303 See Other` + `Location` |

The no-JavaScript path is not a nicety. The audience is on patchy mobile data in tier-1 Indian
cities (`P11`); a dropped script bundle must not cost an enquiry.

### CORS

The site is served from `graybag.com` and the function from `*.supabase.co`, so the JSON path is
cross-origin and needs a preflight:

```
Access-Control-Allow-Origin: https://graybag.com   (plus the Netlify preview origin in staging)
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Methods: POST, OPTIONS
```

`OPTIONS` returns `204`. Do **not** use `*` in production: it is not a security control here, but
an allowlist keeps someone else's page from posting to our endpoint as if it were theirs.

### `redirect_to`

The form-encoded path sends `redirect_to=/thanks`. **Validate it against an allowlist**
(`/thanks` only) and ignore anything else, defaulting to `/thanks`. Reflecting an arbitrary
value into a `Location` header is an open redirect, and open redirects on a real domain get used
for phishing.

---

## 4. Request body

Field names are identical in both encodings.

| Field | Required | Rule |
|---|---|---|
| `name` | yes | 2–80 characters after trimming and collapsing whitespace |
| `role` | yes | one of the six `enquiry_role` values |
| `school` | yes | 2–120 characters |
| `city` | yes | 2–60 characters. Defaults to Mohali in the form; still editable |
| `email` | yes | ≤254 characters, contains `@` and a dotted domain, lowercased |
| `phone` | yes | normalises to `+91[6-9]\d{9}` |
| `message` | no | ≤2000 characters. Empty becomes `null`, never `''` |
| `website` | — | **honeypot.** Must be empty |
| `elapsed_ms` | — | milliseconds the form was on screen. Absent when JS is off |
| `redirect_to` | — | form-encoded path only; allowlisted |

**Re-run every rule server-side.** `apps/web/src/lib/enquiry.ts` implements all of them and is
covered by 52 tests, but it runs in the visitor's browser and is therefore advice, not
enforcement — the same reasoning `ux-spec.md` R7 gives for the order cutoff. Reuse the rules if
the function can import from `packages/shared`; restate them if it cannot.

### Phone normalisation

Accept what people type: `98765 43210`, `+91 98765-43210`, `09876543210`, `0091 9876543210`,
`(+91) 98765.43210`. Strip spaces, hyphens, brackets and dots; strip a leading `+91`, `0091`,
`91` **only when what remains is exactly ten digits**, or a single leading `0`; require
`^[6-9]\d{9}$`; store as `+91` + those ten digits.

The "only when ten digits remain" condition is load-bearing: `9176543210` is a valid mobile
beginning `9`, and stripping its first two characters as a country code corrupts it. There is a
test for exactly this case.

---

## 5. Responses

| Status | When | Body |
|---|---|---|
| `201` | Stored | `{ "status": "created", "id": "<uuid>" }` |
| `202` | Looked automated — **accepted and dropped** | `{ "status": "accepted" }` |
| `303` | Form-encoded success or drop | `Location: /thanks` |
| `422` | Validation failed | `{ "error": "validation_failed", "fields": { "phone": "invalid" } }` |
| `400` | Body was not parseable | `{ "error": "malformed_body" }` |
| `429` | Rate limited | `{ "error": "rate_limited" }` |
| `405` | Not `POST` or `OPTIONS` | `{ "error": "method_not_allowed" }` |

**A submission that looks automated is answered `202`, stored nowhere, and never told it
failed.** A bot that is told it failed retries with a variation; a bot that is told it succeeded
goes away. It also means a false positive costs a real person nothing visible — which matters,
because the alternative is a principal who thinks they have contacted us and has not. Log the
drop so a false-positive rate is observable.

**Looked automated** means: `website` is non-empty after trimming, **or** `elapsed_ms` is present,
positive and under `3000`. Absent `elapsed_ms` is *not* automated — that is the no-JavaScript
case, which is exactly the visitor the fallback exists for.

No captcha. Every captcha worth the name is third-party JavaScript, and the site's budget is zero
third-party requests. The honeypot and the timing floor are not security controls — anyone
reading the HTML defeats both — and they do not need to be. They stop undirected form spam,
which is essentially all of the volume.

---

## 6. Notification

One email per stored enquiry.

- **From** `GrayBag <orders@graybag.com>`, **Reply-To** `support@graybag.com` — `U4`. No
  `no-reply@` address anywhere.
- **To** the value of the `ENQUIRY_NOTIFY_EMAIL` secret. **This is currently unset and needs
  Andy to name an address** — see §8.
- **Subject** `New school enquiry — <school>, <city>`
- **Body** every field, plus the enquiry id, plus a `mailto:` link to the sender so replying is
  one tap on a phone.

**The email is best-effort and must not fail the request.** The row is the record; the email is a
convenience. If the send throws, log it and still return `201` — an enquiry lost because a mail
provider had a bad minute is the worst outcome this endpoint can produce.

`E08` owns the transactional-mail infrastructure. If it is not ready, sending via the provider
`E07-05` already needs for GST invoices is fine — the SPF/DKIM work is shared, not extra.

---

## 7. Rate limiting

Per IP, generous: **10 per hour, 30 per day.** A school with several administrators behind one
NAT is a real case and must not be blocked, so the limits are set to catch volume, not
enthusiasm. Exceeding them returns `429`.

The IP is used for rate limiting and **not stored on the row** — §2's `enquiry` table has no
`ip` column deliberately. A counter keyed by a hash of the IP with a short TTL does the job
without the table becoming a log of who visited.

---

## 8. What the web side needs back

| # | Need | Blocking? |
|---|---|---|
| 1 | The deployed function URL, to set as `PUBLIC_ENQUIRY_ENDPOINT` in Netlify | **Yes** — until then the form posts to the dev mock and production submissions go nowhere |
| 2 | `ENQUIRY_NOTIFY_EMAIL` — the address enquiries land in. **Andy's to name** | **Yes** — without it a stored enquiry is not seen by a human |
| 3 | The migration and RLS above, applied to staging | Yes, to test end to end |
| 4 | Confirmation of the CORS origin allowlist, including the Netlify preview domain | No — a preview can use the mock |

Nothing else in `supabase/`, `packages/shared/` or `apps/mobile/` is touched by `E12`.

---

## 9. What is deliberately not here

- **No investor-submission form.** That is `E12-03`, it is creator-only visibility, and it is
  not in the MVP list. It is not built and no table is proposed for it.
- **No account, no session, no captcha, no analytics.**
- **No child data.** The submitter is an adult acting professionally; their name, work email and
  phone are ordinary personal data. Nothing here is tier P or S, so `R6`'s no-logging rule does
  not bind — but do not log the row wholesale anyway, because there is no reason to.
