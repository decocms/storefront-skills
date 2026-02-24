# Images Skill

Use this to improve how images are used on storefront and e-commerce pages. Check: pre-load, lazy-load, format, and size.

## Pre-load

- Pre-load **only** the main above-the-fold image (hero, first product image) so it appears as fast as possible.
- Use `<link rel="preload" as="image" href="…">` in `<head>` for that single critical image.
- Do **not** pre-load below-the-fold or many images; it wastes bandwidth and can hurt LCP for the real hero.

**Where to preload by Storefront page type:**

- **Home:** Main banner (hero). If it’s a carousel, preload only the first slide.
- **Product:** First product image. If it’s a gallery/carousel, preload only the first image.
- **Category/Search:** Banner image if present; otherwise the first product image in the grid.

Edge cases: 

- Multiple preloads are acceptable when each has a **media** attribute: the browser fetches only the one that matches the current viewport (e.g. desktop vs mobile).
<link as="image" rel="preload" href="image-here" media="(min-width: 1024px)">
<link as="image" rel="preload" href="image-here" media="(max-width: 1023px)">

Checks TO-DO:
Does it have more than one image as a preload? Wrong!
Does it have any preload tags? Probably wrong.

## Lazy Loading

- Use `loading="lazy"` on `<img>` (or equivalent in your framework) for images below the fold.
- Do **not** lazy-load the first visible image (hero / first product image); it should load immediately.
- Prefer native `loading="lazy"` over custom JS unless you need intersection-based behavior (e.g. fade-in).
- User `loading="eager"` on `<img>` for the main image (same chosen for pre-loading).

## Fetch priority

- Set `fetchpriority="high"` on the **one** image that is your LCP candidate (same as the one you preload or the first visible hero/product image).
- Set `fetchpriority="low"` on images that are below the fold or clearly non-critical (e.g. thumbnails, logos in the footer) so they don’t compete with the LCP image.
- Use `fetchpriority="auto"` (or omit the attribute) for everything else; the browser decides. No need to set it explicitly unless you want `high` or `low`.
- Don’t use `high` on multiple images; reserve it for the single above-the-fold image that matters most for LCP.

## Formats

- Prefer **AVIF**, then **WebP**, then JPEG/PNG. Use `<picture>` with `<source type="image/avif">` / `type="image/webp"` and `<img>` as fallback.
- Serve the right format via Accept header or client hints when possible; otherwise offer multiple sources in `<picture>`.

## Size

- Serve **responsive** images: use `srcset` and `sizes` so the browser picks a width that matches layout and DPR.
- Prefer **intrinsic** sizing (e.g. `width`/`height` or aspect-ratio) to avoid layout shift (CLS).
- Compress all images; aim for modern formats and reasonable quality (e.g. 80–85 for JPEG/WebP). Avoid oversized dimensions (e.g. 3000px for a 400px slot).