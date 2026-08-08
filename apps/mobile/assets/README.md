# App icons and splash — provenance

Generated from the brand package, which is **not in this repository** (`RH1`). It lives at
`../Legacy-Application-backup/Graybag_Design Package/`. These four PNGs are committed because
they are build inputs of a few KB each; the 46 MB package they came from is not (`RH1`, `RH3`).

**The fonts are deliberately absent.** `VAG-Rounded-Next-*.ttf` sits in the same package and is
**not** copied here: the licence has never been checked (`E19-03`, `owner:andy`, `[DS-02]`), and
`RH2` is explicit that a git repository is a redistribution channel. The app uses system fonts
until `E13-02`, which is blocked on that licence answer.

## Regenerating

Requires macOS `sips` and the brand package at the path above.

```sh
B="../Legacy-Application-backup/Graybag_Design Package/01_Graybag_Logo"

# App icon — square, wordmark on brand green.
sips -Z 1024 "$B/Logo/Graybag_Logo_Filled_Green BG.png" --out assets/icon.png

# Android adaptive foreground — white mark at ~60% of the canvas so it clears the
# 66% safe zone, padded with #00AF52 to match adaptiveIcon.backgroundColor in app.json.
sips -Z 620 "$B/Icons/Graybag_Icon Filled_White.png" --out /tmp/fg.png
sips -p 1024 1024 --padColor 00AF52 /tmp/fg.png --out assets/adaptive-icon.png

# Splash — white wordmark, transparent. Expo composites it on the green backgroundColor.
sips -Z 1200 "$B/Black&White/Graybag_Logo_White_Transparent.png" --out assets/splash-icon.png

# Web favicon.
sips -Z 44 "$B/Icons/Graybag_Icon Filled_White.png" --out /tmp/fav.png
sips -p 48 48 --padColor 00AF52 /tmp/fav.png --out assets/favicon.png
```

## Why white-on-green is legal here

`S6` (the 500 rule) forbids `#00af52` anywhere something legible sits on it — white on it is
2.90:1. It explicitly permits identity uses: "logo, pattern, illustration, brand fields with
nothing legible on them". A wordmark on a splash screen is a logo, not text, and mock
`06_App UI/01.png` in the brand package shows exactly this composition. No product text is ever
placed on `#00af52`.
