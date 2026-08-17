---
name: image-resolution
description: Diagnose and fix blurry/pixelated/distorted images on deco.cx storefronts caused by a source image smaller than what the slot needs on retina (DPR2) screens. Use when an image "looks fine when opened directly but pixelated on the site", when a banner/section image is soft on mobile, or when someone asks why an image is distorted or how big to upload it.
---

# Image resolution & distortion in deco.cx storefronts

The most common "distorted image" report is **not** stretching — it's a **source image with fewer pixels than the slot needs on retina screens**, so the CDN proxy (or the browser) has to upscale it and it blurs.

Tell-tale sign: **the image looks sharp when opened directly, but pixelated on the site.** That's because opening it shows the small native size; the site displays it larger.

---

## The mechanism (why it blurs)

1. A deco image component (`Image`, or `Picture` + `Source`) declares a **base** `width`/`height` — the 1× size the slot occupies on a normal screen.
2. deco **auto-generates a 2× (and 3×) variant in the `srcset`** for retina screens. On a **DPR2** device, `width={700}` means the browser fetches the **1400px** variant. (DPR = Device Pixel Ratio; "retina" = DPR ≥ 2; most phones and Macs are DPR2–3.)
3. If the uploaded source has fewer pixels than that (e.g. 542px for a 1400px slot), the pixels are invented by upscaling ~2.6×. **No parameter fixes this** — `quality=original` does not add detail that was never photographed; it only inflates bytes.

**Required pixels = rendered CSS width × DPR.** For a card that renders ~700px wide, DPR2 needs **1400px**. The source must be ≥ that.

Secondary effect: if the source aspect ratio ≠ the slot ratio, `fit=cover` **crops** to fill (a slight top/bottom or side crop), which people also read as "distorted."

---

## Diagnose

### 1. Measure the real source (not the served size)

Request the source **without** `width`/`height` so the proxy returns the original file, then measure it:

```bash
# strip width/height from the deco image URL → original file
curl -sL "https://decoims.com/image?quality=original&src=<ENCODED_SRC>" -o /tmp/orig.webp
sips -g pixelWidth -g pixelHeight /tmp/orig.webp   # macOS; or: identify orig.webp
```

⚠️ If you keep `width=1400` in the URL, `naturalWidth` will report **1400** — that's the already-upscaled output, not the source. The real size only shows with the resize params removed.

### 2. Find what the component asks for

Locate the `Image`/`Source` for that slot and read its `width`. The retina requirement is **`width × 2`**. Example from a `Picture`:

```tsx
<Source src={imageDesktop} width={700} height={342} media="(min-width: 1024px)" /> // → needs 1400×684
<Source src={imageMobile}  width={375} height={184} media="(max-width: 1023px)" /> // → needs 750×368
```

### 3. Confirm in the browser (optional)

On the live page: `img.naturalWidth` vs the slot's rendered `getBoundingClientRect().width × devicePixelRatio`. If natural < required, it's upscaled. To check a specific breakpoint, emulate the viewport with a DPR (e.g. `390x844x3` mobile) and re-measure.

### Quick verdict

| Source pixels vs `width × 2` | Result |
|---|---|
| ≥ | sharp |
| < | blurry (upscaled) — **this is the bug** |

---

## Fix

**Upload a larger source.** Minimum = the slot's 2× size, in the slot's aspect ratio.

- Desktop card ~700px wide → **1400×684** (≈2.05:1)
- Full-width mobile ~375px wide → **750×368** (or **700×700** if the mobile slot is square — check the `Source`, see below)
- Bigger than the minimum is fine (the proxy downscales, which never blurs). **Smaller is the bug.**

Things that do **not** fix it (don't bother):
- Changing `width`/`height` in the component — the on-screen slot is unchanged, the browser upscales anyway.
- `quality=original` — adds no detail on an upscaled image; drop it to `quality=high`/`75` to save bytes.
- CDN sharpening — deco/VTEX barely sharpens.
- Shrinking the component in CSS — only helps if you shrink it a lot (to ≤ source/2 CSS px), and it changes the design for **every** place that reuses the component.

### No larger original? AI upscale as a fallback

If the uploaded file truly is the only source, upscale it with AI (e.g. **Upscayl**, free/local): pick a scale that clears the target (3× on a 542px source → 1626px > 1400 ✓; 2× → 1084px < 1400 ✗). **Caveat:** AI invents detail — zoom in and verify fine features (gemstones, engraved text, logos) before shipping. A real higher-res photo always beats an upscale.

### Keep the admin guidance honest

deco renders a field's `@description` / `@title` JSDoc as the **help text in the CMS admin**. If it says a 1× size (e.g. `572x280`), editors upload undersized images. **State the 2× retina target** so people upload the right size the first time:

```tsx
interface CardImage {
  /** @description size Image 750x368 */   // mobile, 2×
  imageMobile: ImageWidget;
  /** @description size Image 1400x684 */   // desktop, 2×
  imageDesktop: ImageWidget;
}
```

---

## Mobile vs desktop: watch the per-breakpoint `Source`

A `Picture` has a separate `Source` per media query, each with its own `width`/`height` — so the **aspect ratio can differ between mobile and desktop**. A common bug: the desktop `Source` is a wide rectangle (e.g. 700×342, ~2:1) but the mobile `Source` is **square** (e.g. 350×350, 1:1). That makes mobile `fit=cover`-crop the photo into a square (joia floating in whitespace).

Decide the intended mobile shape by **looking at the live mobile render** (emulate DPR and screenshot), not by guessing from code. Then make the `Source` and the uploaded image agree:
- Rectangular mobile → `Source` like `375×184` (2×→750×368), image **750×368**.
- Square mobile → `Source` `350×350` (2×→700×700), image **700×700**.

---

## One-paragraph answer for a non-technical stakeholder

> The image looks pixelated because the uploaded file is smaller than the space it fills on the site. The banner needs an image of **1400×684 px** (and **750×368 px** for the mobile version), but the current one is only 542×280 px, so the site has to stretch it. It looks sharp when you open the file directly because there it shows at its small original size; on the site it's enlarged. Fix: upload the image at the larger size — ideally the original high-resolution photo.
