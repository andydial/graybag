# upload-dish-images

Takes the 82 dish photographs that `E16-28` mirrored off the dying Bubble CDN and puts them
where the app can read them: the public `dish-images` bucket, an `asset` row each, and
`dish.image_asset_id` pointing at it so `public_menu.image_path` stops being null (`E16-43`).

The download half is already done and the binaries live **outside** the repository
(`tools/mirror-dish-images/manifest.json` names the directory). Nothing here copies them in.

## Run it

```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)

node tools/upload-dish-images/upload.mjs --project-ref jcagqjsibcpjyskvebeq --dry-run
node tools/upload-dish-images/upload.mjs --project-ref jcagqjsibcpjyskvebeq
```

`--fixture-aliases` additionally matches the seed fixtures — see "What it matched on staging".
`--verify-only` re-checks the local files against the committed checksums and touches no network.

### Credentials

Uploading needs the **service** key. The anon key in `apps/mobile/.env.staging` cannot write,
and no key is stored in this repository. The tool takes, in order:

1. `SUPABASE_SERVICE_ROLE_KEY`, used directly;
2. `SUPABASE_ACCESS_TOKEN` plus `--project-ref`, from which it fetches the service key out of
   the management API. On Andy's machine that token is in the login keychain under
   `Supabase CLI`, which is the line shown above.

## What it does, and what makes it safe to re-run

1. **Verifies before it uploads.** Every file is re-hashed and compared to the SHA-256 in
   `manifest.json`. One mismatch aborts the whole run. The manifest is the only auditable
   record that these bytes are the bytes that came off the CDN, and uploading a file that no
   longer matches it would quietly destroy that guarantee.
2. **Uploads** to `dish-images/dishes/<bubble-file-id>__<name>.<ext>` with
   `Cache-Control: public, max-age=31536000, immutable`. Bubble file ids are immutable, so a
   stored object never legitimately changes and a year-long cache is honest.
3. **Upserts an `asset` row** on the existing `(bucket, path)` unique constraint —
   `kind = 'dish_image'`, mime type, byte size, pixel dimensions read from the file header,
   and the checksum.
4. **Points `dish.image_asset_id`** at it, and only when the value would actually change.

An image is skipped when the object is in the bucket **and** the `asset` row records the same
checksum. Either alone can be stale, so both are checked. A second run therefore uploads
nothing, writes nothing and reports `skipped 82`.

That "only when it would change" matters more than it looks: an `after update` trigger on both
`dish` and `asset` (`0001` §14) bumps `school_menu_version`, which is what invalidates the
app's cached menu. A tool that rewrote the same value on every run would expire every client's
cache every run.

It writes to exactly two application tables, `asset` and `dish`, and to one storage bucket.

## The bucket already exists

`dish-images` is created by migration `0002` §15, public, alongside the three private ones.
This tool needed **no migration** — it checks the bucket rather than creating it. A public
bucket is served without consulting RLS, which is why there is no read policy on
`storage.objects` and why `curl` with no credentials returns the image.

## `image_path` is a KEY, not a URL

`public_menu.image_path` is `asset.path`, and `asset.path` is a storage key:

```
dishes/f1754873839418x787671876992162700__VegSandwichBrownBread-copy.png
```

The public URL is that key under the bucket's public prefix:

```
https://<ref>.supabase.co/storage/v1/object/public/dish-images/<image_path>
```

This is the shape the repository's own fixtures already assume — `menu.test.ts` uses
`image_path: 'dishes/veg.jpg'` and the pgTAP suite seeds `('dish-images', 'dish/a.jpg')` — and
it is the right one: `asset` has a separate `bucket` column and a `unique (bucket, path)`
constraint, both of which are meaningless if `path` holds an absolute URL. Storing URLs would
also bake one project's hostname into the data, so staging rows could not be promoted and a
move to a CDN or an image-transform endpoint would mean rewriting every row.

**The mobile app currently cannot consume it.** `packages/shared/src/api/menu.ts` maps
`imageUri: row.image_path` straight through, and `imageUri` is handed to React Native's
`<Image source={{ uri }}>`, which needs an absolute URL. Turning the key into a URL belongs in
the `api/` module — one place, using the already-configured Supabase URL — not in this tool
and not in the database. That change is **not** made here.

## What it matched on staging

Staging has the **five seed fixtures from `supabase/seed.sql`, not the 85 legacy dishes**, and
none of them carries a `legacy_bubble_id`. So the real join key does not exist yet and the
tool falls back to exact name matching:

| dish | matched | how |
|---|---|---|
| Cold Coffee | `…__Cold-Coffee-copy.png` | name (two legacy records share it; lowest id wins) |
| Paneer Wrap | `…__Paneer-Wrap.png` | name |
| Rajma Chawal | `…__Rajma-Rice-copy.jpg` | `--fixture-aliases` |
| Veg Sandwich | `…__VegSandwichBrownBread-copy.png` | `--fixture-aliases` |
| Egg Fried Rice | — | the legacy menu has no egg fried rice |

The alias table is opt-in and lives at the top of `upload.mjs`, because it is a human
judgement rather than a key. It covers the seed fixtures only. **When the real menu is
imported with its `legacy_bubble_id`s, delete it rather than extend it** — every one of the 82
images will then join on the id, exactly, and the remaining 78 images become live.

Name matching is exact after collapsing whitespace and case, never fuzzy. A wrong photo on a
dish is worse than no photo, so "Paneer Wraps" does not match "Paneer Wrap".

## The three that are missing

Aloo Channa Chat, the Tomato/Cucumber cheese sandwich and the brown-wheat mushroom-pesto pasta
return a permanent 403 at the legacy CDN and were never mirrored. They stay without photos
until `E16-29` (`owner:andy`) decides between re-shooting them and shipping a placeholder.

## Tests

```bash
npm --prefix tools/upload-dish-images test
```

They cover the matcher (precedence, exactness, determinism under duplicate names, aliases
being opt-in), the image-header parsing, and the manifest's own shape. They make no network
calls.
