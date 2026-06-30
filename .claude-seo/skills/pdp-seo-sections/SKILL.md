---
name: pdp-seo-sections
description: Use when LD+JSON, og:tags, or page title are absent from PDP HTML for crawlers. Applies when auditing deco PDP SEO, configuring structured data sections, verifying bot rendering, or diagnosing why rich snippets or social previews don't show product data.
---

SEO metadata (LD+JSON, og:tags, `<title>`) on deco PDP pages requires specific configuration because sections load lazily by default. Bots that don't execute JavaScript — Bing, WhatsApp/Telegram previews, most price-comparison crawlers — never see product data unless forced to render server-side.

---

## How deco renders PDP sections

deco delivers sections in two modes:

| Mode | How it arrives | Who sees it |
|---|---|---|
| **SSR** | Full HTML in first response | Everyone (users + bots) |
| **Deferred** | Empty `<div hx-trigger="intersect once">` | Nobody until HTMX fires a `/deco/render` request |

Product content (`ProductDetails.tsx`) is deferred by default — the initial HTML contains only a loading spinner. A second request to `/deco/render` fetches the full product HTML when the element enters the viewport.

**Consequence:** Any SEO section placed in the `sections` array without forced SSR will also be deferred. LD+JSON and og:tags placed after the footer load only if the user scrolls there.

### Verify with curl

```bash
# Initial HTML — what bots see
curl -s "https://www.store.com/product/p" | grep -E "application/ld\+json|og:title|og:image|<title"

# Bot view — forced SSR (see below)
curl -s "https://www.store.com/product/p?__decoFBT=0" | grep -E "application/ld\+json|og:title"
```

---

## Bot rendering: `shouldForceRender`

deco uses `shouldForceRender` (in `apps/utils/deferred.ts`) to bypass deferred loading:

```typescript
export const shouldForceRender = <Ctx extends { isBot?: boolean }>(
  { ctx, searchParams }: { ctx: Ctx; searchParams: URLSearchParams },
): boolean => ctx.isBot || searchParams.get("__decoFBT") === "0";
```

When `true`, all deferred sections render SSR in a single request.

**`isBot` detection** (`deco/utils/userAgent.ts`) checks in order:
1. Cloudflare header `cf-verified-bot: true`
2. `KNOWN_BOTS` list (e.g. `"Google-InspectionTool"`)
3. UA parser (`ua-parser-js` Bots extension) — covers Googlebot, Bingbot, etc.

**`?__decoFBT=0`** simulates bot rendering for debugging — append to any URL to see exactly what crawlers receive.

---

## `firstByteThresholdMS` — deprecated async render flag

`site.json` may contain `firstByteThresholdMS: true`. When active, it sets `delay = 1` in `website/handlers/fresh.ts`, which aborts all loaders immediately and activates async render site-wide (every page becomes "casca vazia" for all users, not just deferred sections).

```typescript
const delayFromProps = appContext.firstByteThresholdMS ? 1 : 0;
const delay = Number(url.searchParams.get("__decoFBT") ?? delayFromProps);
```

**Fix:** Set `firstByteThresholdMS: false` (or remove it) in `site.json`. This field is deprecated and should not be `true`.

---

## Correct SEO section setup for PDPs

Use `commerce/sections/Seo/SeoPDPV2.tsx` with the same loader as the product page (`PDP Loader` / `vtex/loaders/product/productPage.ts`).

**Why SeoPDPV2 and not a custom component:**
- Delivers full LD+JSON: `Product`, `BreadcrumbList`, `AggregateOffer`
- Delivers all og:tags: `og:title`, `og:description`, `og:image`
- Bots trigger `shouldForceRender` → entire page renders SSR, including SeoPDPV2
- Regular users get `<title>` + og:tags injected into `<head>` via HTMX partial after `/deco/render`

**HTMX head-support is required** for SeoPDPV2 to inject tags into `<head>` for non-bot users. Without it, HTMX can only update `<body>` content. Enable it in the site config:

```json
{
  "htmx": {
    "version": "1.9.12",
    "extensions": ["head-support"]
  }
}
```

**Section position:** Place SeoPDPV2 near the top of the sections array (before any deferred sections), so it loads early even when not in bot mode.

---

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| SeoPDP placed after Footer | LD+JSON only loads if user scrolls past footer | Move SEO section to top of sections array |
| `firstByteThresholdMS: true` in site.json | All pages are casca vazia; async render active site-wide | Set to `false` |
| Custom SEO component without LD+JSON | `<title>` present but 0 rich snippets in Google | Use `SeoPDPV2` or ensure component emits `<script type="application/ld+json">` |
| HTMX without `head-support` extension | SEO section renders but og:tags/title absent for users | Add `"head-support"` to HTMX extensions |
| Using wrong loader in SeoPDPV2 | LD+JSON renders with missing price / wrong product | Use the same `PDP Loader` (`vtex/loaders/product/productPage.ts`) configured for the page |

---

## Quick audit checklist

```bash
STORE="https://www.store.com"
PDP="$STORE/product-slug/p"

# 1. Title present in initial HTML?
curl -s "$PDP" | grep -i "<title"

# 2. og:tags in initial HTML?
curl -s "$PDP" | grep "og:"

# 3. LD+JSON in initial HTML?
curl -s "$PDP" | grep "application/ld+json"

# 4. What bots see (forced SSR)?
curl -s "$PDP?__decoFBT=0" | grep -E "og:|ld\+json"

# 5. firstByteThresholdMS active?
curl -s "$STORE/live/release" | grep firstByteThresholdMS
# Or check .deco/blocks/site.json directly
```

Expected after correct setup: items 1–4 all return content; `?__decoFBT=0` shows LD+JSON with product name, price, and availability.
