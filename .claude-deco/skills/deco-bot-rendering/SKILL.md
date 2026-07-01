---
name: deco-bot-rendering
description: Use when debugging what crawlers or bots see on a deco site, verifying if SSR is active for bots, diagnosing firstByteThresholdMS behavior, or returning HTTP 404 from a section loader.
---

deco renders pages differently for bots vs. normal users. Understanding this distinction is essential for debugging SEO issues, auditing crawlability, and handling missing products correctly.

## SSR vs. deferred sections

| Mode | Initial HTML | Who sees it |
|---|---|---|
| **SSR** | Full section content | Everyone |
| **Deferred** | `<div hx-trigger="intersect once">` placeholder | Nobody — HTMX fetches via `/deco/render` on scroll |

By default, `ProductDetails` and other above-the-fold sections are deferred. Bots that don't execute JavaScript never trigger HTMX and never see deferred content.

## shouldForceRender — bot bypass

`apps/utils/deferred.ts` exports `shouldForceRender`, which bypasses deferred loading entirely:

```typescript
export const shouldForceRender = <Ctx extends { isBot?: boolean }>(
  { ctx, searchParams }: { ctx: Ctx; searchParams: URLSearchParams },
): boolean => ctx.isBot || searchParams.get("__decoFBT") === "0";
```

When `true`, all sections render SSR in the initial request — no placeholders, no second `/deco/render` call.

## isBot detection

`deco/utils/userAgent.ts` checks in order:

1. Cloudflare header `cf-verified-bot: true` (Business/Enterprise plans only)
2. `KNOWN_BOTS` hardcoded list — e.g. `"Google-InspectionTool"`
3. UA parser (`ua-parser-js` Bots extension) — covers Googlebot, GPTBot, ClaudeBot, PerplexityBot, Bingbot, etc.

## `?__decoFBT=0` — simulate bot rendering

Append `?__decoFBT=0` to any URL to force SSR for all sections — shows exactly what crawlers receive:

```bash
# What a bot sees (forced SSR)
curl -s "https://www.store.com/product/p?__decoFBT=0" | grep -E "ld\+json|og:title|<title"

# What a normal user sees (deferred — SEO metadata absent is expected)
curl -s "https://www.store.com/product/p" | grep -E "ld\+json|og:title"
```

Plain `curl` always shows the user view. `?__decoFBT=0` is the only way to audit bot rendering without a real crawler.

## `firstByteThresholdMS` — deprecated site-wide async flag

`site.json` may contain `firstByteThresholdMS: true`. When active, it forces `delay = 1` in `website/handlers/fresh.ts`, aborting all loaders immediately and making the entire site async — even bots get deferred content:

```typescript
const delayFromProps = appContext.firstByteThresholdMS ? 1 : 0;
const delay = Number(url.searchParams.get("__decoFBT") ?? delayFromProps);
```

**Fix:** Set `firstByteThresholdMS: false` in `.deco/blocks/site.json`. This field is deprecated and must not be `true`.

## Returning HTTP 404 from a section loader

`return null` from a loader does **not** emit HTTP 404. Use `notFound()` from `@deco/deco`, which calls `shortcircuit()` and throws `HttpError(404)`:

```typescript
import { notFound } from "@deco/deco";

export const loader = async (props: Props, _req: Request, ctx: AppContext) => {
  if (!props.page) {
    notFound(); // HTTP 404 for bots (SSR); user gets deferred error state
  }
  // ...
};
```

For bots (`shouldForceRender = true`), `notFound()` fires during the initial SSR request — the entire response is HTTP 404. For regular users (deferred), the `/deco/render` partial always returns HTTP 200 regardless.
