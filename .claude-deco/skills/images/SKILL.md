---
name: images
description: Understand and configure image optimization in deco.cx storefronts — components, quality settings, bypass rules, platform-specific handling, CDN proxy, and format negotiation. Use when the user asks about images, image quality, image optimization, or image components.
---

# Images in deco.cx

Deco provides a full image optimization pipeline: components that generate responsive markup, a multi-engine server-side optimizer, platform-aware URL rewriting, and CDN caching with next-gen format negotiation.

---

## Image Components

### `Image`

**Import:** `apps/website/components/Image.tsx`

The primary image component. Wraps a standard `<img>` with automatic srcset generation, optimization URL rewriting, and optional preloading.

| Prop | Type | Default | Description |
|---|---|---|---|
| `src` | `string` | *(required)* | Image source URL |
| `width` | `number` | *(required)* | Display width — used for aspect ratio and srcset |
| `height` | `number` | — | Display height |
| `quality` | `QualityOptions` | context default | `"low"` (60) \| `"medium"` (70) \| `"high"` (80) \| `"original"` (100) |
| `fit` | `string` | — | `"contain"` or `"cover"` |
| `preload` | `boolean` | `false` | Adds `<link rel="preload">` for LCP optimization |
| `fetchPriority` | `string` | — | `"high"` \| `"low"` \| `"auto"` |
| `loading` | `string` | `"lazy"` | Native lazy loading attribute |

```tsx
import Image from "apps/website/components/Image.tsx";

<Image
  src="https://example.com/hero.jpg"
  width={1200}
  height={600}
  quality="high"
  preload
  fetchPriority="high"
  loading="eager"
/>
```

### `Picture` and `Source`

**Import:** `apps/website/components/Picture.tsx`

Use `Picture` with `Source` children for art-direction — serving different images or crops per breakpoint.

| Source Prop | Type | Description |
|---|---|---|
| `src` | `string` | Image source URL |
| `width` | `number` | Image width |
| `height` | `number` | Image height |
| `quality` | `QualityOptions` | Quality override |
| `media` | `string` | CSS media query (e.g. `"(max-width: 767px)"`) |
| `preload` | `boolean` | Enable preload for this source |

```tsx
import { Picture, Source } from "apps/website/components/Picture.tsx";

<Picture preload>
  <Source src="/mobile.jpg" width={360} height={480} media="(max-width: 767px)" />
  <Source src="/desktop.jpg" width={1200} height={600} media="(min-width: 768px)" />
  <img src="/desktop.jpg" width={1200} height={600} loading="eager" />
</Picture>
```

### `Video`

**Import:** `apps/website/components/Video.tsx`

Video element with optional image optimization via `forceOptimizedSrc`.

---

## Responsive Images (srcset)

The `Image` and `Source` components automatically generate a srcset with density descriptors.

- **Default factors:** `[1, 2]` — produces `1x` and `2x` variants
- When `preload` is enabled, only the highest factor (2x) is used for the preload link to optimize LCP
- Custom srcset can be passed via the `srcSet` prop to override automatic generation

---

## Default Image Quality

### Quality Levels

| Value | Encoded quality |
|---|---|
| `"low"` | 60 |
| `"medium"` | 70 |
| `"high"` | 80 |
| `"original"` | 100 |

### Setting a Site-Wide Default

Configure `defaultImageQuality` in the website app props (`mod.ts`). This sets the quality for every `Image`, `Source`, and `Picture` component that doesn't explicitly override it.

- Type: `DefaultQualityOptions` — allows `"low"`, `"medium"`, or `"high"` (excludes `"original"` to protect performance)
- Provided to components via `DefaultImageQualityContext` (React context)
- Any component can override the default with its own `quality` prop

---

## Image Optimization Pipeline

### Two-Tier System

Deco uses a two-tier optimization strategy:

1. **Platform-specific optimization** (default) — rewrites the URL using the e-commerce platform's native image CDN
2. **Deco optimization** — falls back to the deco CDN proxy when no platform matches

### Platform-Specific URL Rewriting

The component rewrites URLs based on the detected platform:

| Platform | URL strategy |
|---|---|
| **VNDA** | `/{width}x{height}{pathname}` |
| **Shopify** | Query params `?width=&height=&crop=center` |
| **VTEX** | Path format `{trueId}-{width}-{height}` |
| **Wake** | Query params `?w=&h=` |
| **Sourei** | Query params `?w=&h=&fit=&q=` |
| **Magento** | Query params `?width=&height=&canvas=&optimize=low&fit=` |

### Deco CDN Proxy

When no platform matches, the image URL is rewritten to pass through the deco CDN:

```
https://decoims.com/image?src={src}&width={w}&height={h}&quality={q}&fit={f}
```

- **Default host:** `https://decoims.com`
- **Override:** `DECO_CDN_HOST` environment variable or `window.DECO.featureFlags.cdnHost` browser flag

### Data URLs

Images with `src` starting with `data:` are returned as-is — no optimization is applied.

---

## Image Engines (Server-Side)

The image loader (`/live/invoke/website/loaders/image.ts`) picks an engine based on the runtime environment.

| Engine | When selected | How it works |
|---|---|---|
| **Pass-through** | `IMAGES_ENGINE=pass-through` or default | Returns the original URL with no processing |
| **WASM** | Worker available (Deno) | Server-side encoding via WebAssembly — supports JPEG, PNG, WebP, AVIF |
| **Cloudflare** | Running in Cloudflare Workers | Uses `cf.image` transform: `fetch(src, { cf: { image: { format, fit, width, height, quality } } })` |
| **Deco (ImageKit)** | Fallback | Proxies through ImageKit: `https://ik.imagekit.io/{id}/tr:w-{w},h-{h},q-{q}/{src}` |

### Environment Variables

| Variable | Values | Description |
|---|---|---|
| `IMAGES_ENGINE` | `pass-through` \| *(unset)* | Force a specific engine |
| `DECO_IK_ID` | string (default `"decocx"`) | ImageKit account ID for the Deco engine |

---

## Bypass Rules

### Bypass Platform Image Optimization

> **Removed in v1.152.0.** The `BYPASS_PLATFORM_IMAGE_OPTIMIZATION` env var and `window.DECO.featureFlags.bypassPlatformImageOptimization` browser flag were removed. Platform-specific URL rewriting is now always active when a platform is detected. If you are on a version older than 1.152.0, these flags still apply.

### Bypass Deco Image Optimization

Disables all optimization — returns original image URLs untouched.

- **Env var:** `BYPASS_DECO_IMAGE_OPTIMIZATION=true`
- **Browser flag:** `window.DECO.featureFlags.bypassDecoImageOptimization`

Use for debugging or when images are pre-optimized externally.

### Proxy Disable & Whitelist

Configured in the website app props (`mod.ts`):

- `disableProxy: true` — disables the image proxy entirely
- `whitelistURLs` — array of URL patterns; only matching sources are proxied (empty = allow all). Returns 403 for non-matching sources.

---

## Format Negotiation

The image loader negotiates the best format based on the browser's `Accept` header:

- **AVIF** — served when `image/avif` is in Accept (smallest file size, widest modern support)
- **WebP** — served when `image/webp` is in Accept
- **Original format** — fallback when neither is supported

Format detection also uses binary signature matching (byte-level) with fallback to `Content-Type` header.

Supported formats for processing: **JPEG, PNG, WebP, AVIF**.

---

## Caching

Optimized images are cached aggressively:

```
Cache-Control: public, s-maxage=15552000, max-age=15552000, immutable
```

This is ~6 months of immutable caching. The loader also uses the Cache API server-side to avoid re-processing identical requests.

Response headers include:
- `x-img-engine` — which engine processed the image
- `x-cache` — `HIT` or `MISS` for the server-side cache

---

## Performance Best Practices

1. **Preload LCP images** — set `preload` and `fetchPriority="high"` on the hero/banner image
2. **Set width and height** — prevents Cumulative Layout Shift (CLS)
3. **Use `Picture` for responsive art direction** — serve appropriately sized images per breakpoint
4. **Use `"high"` quality for hero images, `"medium"` or `"low"` for thumbnails** — balance visual quality vs file size
5. **Set a site-wide `defaultImageQuality`** — avoid forgetting quality on individual components; `"medium"` (70) is a good default
6. **Let lazy loading work** — only set `loading="eager"` on above-the-fold images
7. **Don't bypass optimization without reason** — the platform and deco CDN pipelines significantly reduce payload size

---

## Asset URL Prefixes

Before sending images to the CDN proxy, these known asset prefixes are stripped to hit storage directly:

- `https://decoims.com/`
- `https://storage.googleapis.com/deco-assets/`
- `https://assets.decocache.com/`
- `https://deco-sites-assets.s3.sa-east-1.amazonaws.com/`
- `https://data.decoassets.com/`

---

## Quick Reference — All Environment Variables & Feature Flags

| Variable / Flag | Type | Description |
|---|---|---|
| ~~`BYPASS_PLATFORM_IMAGE_OPTIMIZATION`~~ | env | **Removed in v1.152.0.** Previously skipped platform CDN to use deco proxy |
| `BYPASS_DECO_IMAGE_OPTIMIZATION` | env | Skip all optimization |
| `DECO_CDN_HOST` | env | Override CDN host (default `https://decoims.com`) |
| `IMAGES_ENGINE` | env | Force image engine (`pass-through`) |
| `DECO_IK_ID` | env | ImageKit account ID (default `decocx`) |
| ~~`window.DECO.featureFlags.bypassPlatformImageOptimization`~~ | browser | **Removed in v1.152.0.** Previously same as env, client-side |
| `window.DECO.featureFlags.bypassDecoImageOptimization` | browser | Same as env, client-side |
| `window.DECO.featureFlags.cdnHost` | browser | Override CDN host, client-side |
