# mirror-dish-images

Pulls the legacy dish photos off the Bubble CDN before that CDN disappears with the Bubble
app (`E16-28`, decision `AR6`). Run once; re-runnable.

Of the 85 dish records in the legacy export, **82 images still resolve and 3 return a
permanent 403** — Aloo Chana Chaat, the Tomato/Cucumber cheese sandwich, and the brown-wheat
mushroom-pesto pasta. Those three need new photography or a placeholder (`E16-29`).

## Where the bytes go, and why not here

Downloads land **outside the repository** (default `~/graybag-dish-images`). Git is a poor
store for 1.56 MB of binaries that will be served from Supabase Storage anyway, and the repo
has already paid once for putting binary assets in history.

What *is* committed is `manifest.json`: for each dish, the source URL, the local filename, byte
count, content type and a SHA-256. That makes the mirror auditable and verifiable from a clean
checkout without carrying the payload.

## Usage

```bash
# mirror (the export lives outside the repo and must stay there)
node tools/mirror-dish-images/mirror.mjs \
  --dishes ../bubble-export-recon/Dishes.csv \
  --out ~/graybag-dish-images

# re-check local copies against the committed checksums
npm --prefix tools/mirror-dish-images run verify
```

`--dishes` is deliberately not defaulted. The Bubble export contains children's personal data in
its other CSVs and must never be copied into this repository; only the `photo` and `name`
columns of `Dishes.csv` are read, and only catalogue fields reach the manifest — a test asserts
that.

## Next

`E16-43` uploads from this manifest into Supabase Storage and repoints the dish records.
