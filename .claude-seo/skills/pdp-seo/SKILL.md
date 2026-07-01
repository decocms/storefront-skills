---
name: pdp-seo
description: Use when LD+JSON, og:tags, or page title are absent from deco PDP pages for crawlers. Applies when configuring structured data, setting up SeoPDPV2, enabling HTMX head-support, or auditing why rich snippets or social previews don't show product data.
---

On deco PDP pages, SEO metadata (LD+JSON, og:tags, `<title>`) works differently for bots and normal users. See [[deco-bot-rendering]] for how deco detects bots and forces SSR. This skill covers how to configure the SEO section correctly and verify it works.

## Correct SEO section: SeoPDPV2

Use `commerce/sections/Seo/SeoPDPV2.tsx` with the **same loader** as the product page (`vtex/loaders/product/productPage.ts` — the "PDP Loader").

What it delivers:
- LD+JSON: `Product`, `BreadcrumbList`, `AggregateOffer` (with price and availability)
- og:tags: `og:title`, `og:description`, `og:image`
- `<title>` with product name

**For bots:** `shouldForceRender` triggers SSR — SeoPDPV2 is included in the first HTTP response with full metadata.

**For normal users:** SeoPDPV2 injects `<title>` and og:tags into `<head>` via HTMX `head-support` after the page loads. Users don't see SEO metadata in the initial HTML — this is correct behavior, not a bug.

## HTMX head-support is required

Without the `head-support` extension, HTMX can only update `<body>` content — the `<title>` and og:tags in SeoPDPV2's HTMX response never reach `<head>` for regular users.

Enable in `.deco/blocks/site.json`:

```json
{
  "htmx": {
    "version": "1.9.12",
    "extensions": ["head-support"]
  }
}
```

## Section position matters

Place SeoPDPV2 **near the top** of the sections array in the page config (`.deco/blocks/pages-productpage-*.json`), before any deferred sections. If placed after the Footer, bots that don't scroll will never reach it.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| SeoPDP placed after Footer | LD+JSON absent for all bots | Move SEO section to the top of the sections array |
| Custom SEO component without LD+JSON | `<title>` present but 0 rich snippets in Google | Use `SeoPDPV2` or ensure the component emits `<script type="application/ld+json">` |
| HTMX missing `head-support` | Bots see SEO correctly; normal users don't get `<title>`/og:tags | Add `"head-support"` to HTMX extensions in site.json |
| Wrong loader in SeoPDPV2 | LD+JSON renders with missing or wrong product data | Use the same PDP Loader (`vtex/loaders/product/productPage.ts`) as the product page |
| Auditing with plain curl | Appears broken — no SEO metadata | This is expected for normal users; use `?__decoFBT=0` to see the bot view |

## Quick audit checklist

```bash
PDP="https://www.store.com/product-slug/p"

# Bot view — must have title, og:tags, LD+JSON
curl -s "$PDP?__decoFBT=0" | grep -E "<title|og:|ld\+json"

# Check firstByteThresholdMS (must be false)
grep "firstByteThresholdMS" .deco/blocks/site.json

# Check HTMX head-support enabled
grep "head-support" .deco/blocks/site.json
```

Expected after correct setup: `?__decoFBT=0` returns `<title>` with product name, all og:tags, and LD+JSON with price and availability.
