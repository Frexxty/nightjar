# Stratus brand

The mark is one band folded back on itself twice. The three horizontal runs are the layers of a stratus cloud, the flat sheet cloud the app is named after, and the two folds turn them into an S. On the colour version the folds are shaded darker, so the band reads as a ribbon passing behind itself.

Everything here is drawn as vector SVG by `source/generate.mjs`. No image model was involved. The rasters (PNG, ICNS, ICO) are rendered from those SVGs with `rsvg-convert` and `iconutil`.

![Brand board](brand-board.png)

## Palette

| Name | Hex | Use |
| --- | --- | --- |
| Ember | `#FF5500` | The accent. Same as the app's default `--accent`. |
| Ember Light | `#FF7A26` | Top stop of the mark gradient. |
| Ember Deep | `#FF4A00` | Bottom stop of the mark gradient. |
| Night | `#101012` | Window background, dark theme. |
| Panel | `#161618` | App icon tile, panels. |
| Raised | `#1F1F22` | Raised surfaces, chips. |
| Mist | `#F4F4F6` | Text and the wordmark on dark backgrounds. |
| Paper | `#ECECEF` | Window background, light theme. |
| Ink | `#121214` | Text and the wordmark on light backgrounds. |

The mark gradient runs top to bottom, Ember Light to Ember Deep. The folds get 28% black on top of it. Ember is the only accent. Don't add a second one.

## Type

Inter Semibold (600) for the wordmark and headlines, Medium (500) for labels, Regular (400) for body text. The wordmark is set at -0.025em tracking with the cap height matched to the mark's height, and every logo file has the letters converted to outlines, so no font needs to be installed. Inside the app the UI keeps the system font: SF Pro on macOS, Segoe UI on Windows.

## Construction

Band thickness `t` and gap `g` are in a 15 : 8 ratio (90 and 48 on the 612 wide master). Each fold is a pair of concentric half circles: outer radius `t + g/2`, inner radius `g/2`. The two loose ends have round caps. Keep clear space of at least `t` on every side of the mark. In the lockup, the gap between mark and wordmark is half the mark's height.

## Usage

- On dark backgrounds use `logo-wordmark.svg`. On light backgrounds use `logo-wordmark-light.svg`. The mark itself stays Ember on both.
- For a single colour, use `src/assets/logo-mark.svg`. It draws in `currentColor` with the folds at 50% opacity. When the mark is under about 20 px wide, drop the fold shading and fill the whole outline.
- Don't put the Ember mark on an Ember or other saturated background. Use the single-colour mark in Night instead, as on the brand board's tagline panel.
- Don't stretch the mark, re-space the bands, outline it, or add effects. Don't rebuild the wordmark in another typeface.
- Don't place the mark on a plain orange tile. SoundCloud's own icon is a white mark on an orange square, and Stratus should not be mistaken for an official SoundCloud app. The app icon is the Ember mark on a Panel tile.
- The tagline is "Hear every layer." Use it as written, with the full stop.

## Files

App icons, used by the build (keep these names, the packaging config points at them):

| File | What it is |
| --- | --- |
| `build/icon.svg` | Master macOS icon. Mark on a Panel tile, 824 px with continuous corners centred on a 1024 canvas per Apple's grid, with the drop shadow inside the canvas. |
| `build/icon.png` | 1024 px render of the above. |
| `build/icon.icns` | macOS icon, every size from 16 to 512@2x. The 16 and 32 px slots use hand-hinted versions with the bands snapped to whole pixels. |
| `build/icon.ico` | Windows icon: 16, 24, 32, 48, 64, 128 and 256 px. Near full bleed tile. 16 and 24 use a simplified tile without the fold shading. |
| `build/trayTemplate.png`, `build/trayTemplate@2x.png` | macOS menu bar template, black on transparent, 16 and 32 px, pixel snapped. |
| `build/tray.png` | Windows tray icon, Ember mark on transparent, 32 px. |
| `build/dmg-background.png`, `build/dmg-background@2x.png` | DMG window background, 540 x 380 and 1080 x 760. The app icon goes at (140, 190) and Applications at (400, 190). Both slots are left empty. |

Web and app:

| File | What it is |
| --- | --- |
| `public/favicon.svg`, `public/favicon.png` | Favicon, linked from `index.html`. The PNG is 64 px. |
| `src/assets/logo-mark.svg` | Single-colour mark in `currentColor`. The idle now-playing display uses it. |

Brand:

| File | What it is |
| --- | --- |
| `brand/logo-mark.svg` | Ember mark, transparent background, tight bounds. |
| `brand/logo-wordmark.svg` | Mark and wordmark for dark backgrounds. |
| `brand/logo-wordmark-light.svg` | Mark and wordmark for light backgrounds. |
| `brand/og-image.png` | 1200 x 630 social card. |
| `brand/brand-board.svg`, `brand/brand-board.png` | 3 x 3 brand board, 2400 x 1500. |

Source:

| File | What it is |
| --- | --- |
| `brand/source/mark.mjs` | Mark geometry. |
| `brand/source/generate.mjs` | Builds every file above. |
| `brand/source/check.mjs` | Unpacks the ICNS and lays the small sizes out at 1:1 for a legibility check. |
| `brand/source/concepts.mjs`, `brand/source/concepts/` | The three concepts explored first: A Strata (stacked bands), B Fold S (chosen), C Horizon (a sliced disc). `sheet.png` compares them at 190, 64, 32 and 16 px. |
| `brand/source/og-image.svg`, `brand/source/dmg-background.svg`, `brand/source/icon-windows*.svg` | Vector sources for the rasters above. |

## Regenerating

```sh
npm install --no-save opentype.js @fontsource/inter png-to-ico
node brand/source/generate.mjs
node brand/source/check.mjs   # optional, writes /tmp/stratus-check-x1.png
```

You need `rsvg-convert` (`brew install librsvg`), and `iconutil` for the ICNS, so this runs on macOS. `--no-save` keeps the tools out of `package.json`. The next plain `npm install` removes them again.
