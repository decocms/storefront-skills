---
name: pdp-seo-sections
description: Use when LD+JSON, og:tags, or page title are absent from PDP HTML for crawlers. Applies when auditing deco PDP SEO, configuring structured data sections, verifying bot rendering, or diagnosing why rich snippets or social previews don't show product data.
---

**Applies to:** sites using the standard `deco/apps` stack — specifically `commerce/sections/Seo/SeoPDPV2.tsx`, `isBot` from `deco/utils/userAgent.ts`, and `shouldForceRender` from `apps/utils/deferred.ts`. Sites with custom SEO components or custom rendering logic may not have these mechanisms; verify the stack before applying this skill.

SEO metadata (LD+JSON, og:tags, `<title>`) on deco PDP pages requires specific configuration because sections load lazily by default. Bots that don't execute JavaScript — Bing, WhatsApp/Telegram previews, most price-comparison crawlers — never see product data unless forced to render server-side.

---

## How SEO metadata reaches users vs. bots

This is the core behavior to understand: **SEO is async for normal users, SSR for bots.**

| Visitor | `<title>` / og:tags / LD+JSON in initial HTML | How they arrive |
|---|---|---|
| **Bot** (`isBot = true`) | ✅ present in first response | `shouldForceRender` bypasses all deferred sections; full SSR in one request |
| **Normal user** | ❌ absent in initial HTML | SEO section renders later via HTMX `head-support`, injected into `<head>` after `/deco/render` |
| **curl (no JS)** | ❌ absent | Same as normal user — deferred, never fires HTMX |

**Why this is intentional:** Normal users don't need SEO metadata in the initial HTML for UX — their browser receives it shortly after via HTMX. Bots need it in the first response because they don't execute JavaScript and don't trigger HTMX. The deco architecture handles this by detecting bots and forcing SSR only for them.

**Consequence for auditing:** `curl` without `?__decoFBT=0` always shows the user view (no SEO metadata). This is correct behavior, not a bug. Use `?__decoFBT=0` to see the bot view.

---

## How deco renders PDP sections

deco delivers sections in two modes:

| Mode | How it arrives | Who sees it |
|---|---|---|
| **SSR** | Full HTML in first response | Everyone (users + bots) |
| **Deferred** | Empty `<div hx-trigger="intersect once">` | Nobody until HTMX fires a `/deco/render` request |

Product content (`ProductDetails.tsx`) is deferred by default — the initial HTML contains only a loading spinner. A second request to `/deco/render` fetches the full product HTML when the element enters the viewport.

**Consequence:** Any SEO section placed without forced SSR is also deferred. LD+JSON and og:tags placed after the footer only load if the user scrolls there — and bots never scroll.

### Verify with curl

```bash
# User view (no JS) — SEO metadata absent, this is expected
curl -s "https://www.store.com/product/p" | grep -E "application/ld\+json|og:title|<title"

# Bot view — forced SSR, SEO metadata must be present
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

When `true`, all deferred sections — including the SEO section — render SSR in a single request.

**`isBot` detection** (`deco/utils/userAgent.ts`) checks in order:
1. Cloudflare header `cf-verified-bot: true`
2. `KNOWN_BOTS` list (e.g. `"Google-InspectionTool"`)
3. UA parser (`ua-parser-js` Bots extension) — covers Googlebot, GPTBot, ClaudeBot, etc.

**`?__decoFBT=0`** simulates bot rendering for debugging — append to any URL to see exactly what crawlers receive.

---

## `firstByteThresholdMS` — deprecated async render flag

`site.json` may contain `firstByteThresholdMS: true`. When active, it sets `delay = 1` in `website/handlers/fresh.ts`, which aborts all loaders immediately and activates async render site-wide — every page becomes fully deferred for all users, not just the sections configured as lazy.

```typescript
const delayFromProps = appContext.firstByteThresholdMS ? 1 : 0;
const delay = Number(url.searchParams.get("__decoFBT") ?? delayFromProps);
```

**Fix:** Set `firstByteThresholdMS: false` (or remove it) in `site.json`. This field is deprecated and should not be `true`.

---

## Correct SEO section setup for PDPs

Use `commerce/sections/Seo/SeoPDPV2.tsx` with the same loader as the product page (`PDP Loader` / `vtex/loaders/product/productPage.ts`).

**Why SeoPDPV2:**
- Delivers full LD+JSON: `Product`, `BreadcrumbList`, `AggregateOffer`
- Delivers all og:tags: `og:title`, `og:description`, `og:image`
- Bots: `shouldForceRender` forces SSR → SeoPDPV2 included in first response
- Normal users: HTMX injects `<title>` + og:tags into `<head>` via `head-support` extension after page loads

**HTMX `head-support` is required** for the user-side async injection to work. Without it, HTMX can only update `<body>` — the `<title>` and og:tags never reach the `<head>` for regular users. Enable in site config:

```json
{
  "htmx": {
    "version": "1.9.12",
    "extensions": ["head-support"]
  }
}
```

**Section position:** Place SeoPDPV2 near the top of the sections array, before any deferred sections.

---

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| SeoPDP placed after Footer | Bots never see LD+JSON (footer is past their scroll depth) | Move SEO section to top of sections array |
| `firstByteThresholdMS: true` in site.json | Even bots get async render, no SEO in any first response | Set to `false` in site.json |
| Custom SEO component without LD+JSON | `<title>` present but 0 rich snippets in Google | Use `SeoPDPV2` or ensure component emits `<script type="application/ld+json">` |
| HTMX without `head-support` extension | Bots get SEO correctly; normal users don't see title/og:tags | Add `"head-support"` to HTMX extensions |
| Wrong loader in SeoPDPV2 | LD+JSON renders with missing price or wrong product data | Use the same `PDP Loader` (`vtex/loaders/product/productPage.ts`) configured for the page |
| Expecting SEO in initial HTML for users | Appears broken in curl but works for bots — correct behavior | Use `?__decoFBT=0` to audit bot view; plain curl shows user view |

---

## Quick audit checklist

```bash
STORE="https://www.store.com"
PDP="$STORE/product-slug/p"

# 1. Bot view — must have title, og:tags, LD+JSON
curl -s "$PDP?__decoFBT=0" | grep -E "<title|og:|ld\+json"

# 2. User view — title/og absent is expected; product placeholder confirms deferred pattern
curl -s "$PDP" | grep -E "<title|og:|ld\+json"

# 3. firstByteThresholdMS active? (must be false)
grep "firstByteThresholdMS" .deco/blocks/site.json

# 4. HTMX head-support enabled?
grep "head-support" .deco/blocks/site.json
```

After correct setup: `?__decoFBT=0` returns title, og:tags, and LD+JSON with product name, price, and availability. Plain curl returns none of those — that is the expected behavior for normal users.
