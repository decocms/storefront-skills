---
name: cache
description: Audit and improve deco store caching across all three layers: loader cache, stale edge cache (async render), and HTML page cache. Use when the user asks to improve cache, reduce latency, optimize loaders, or configure TTL/cache keys on a deco storefront.
---

# Deco Cache

Deco has three caching layers, each operating at a different level. Apply all three together for lowest possible latency.

---

## Layer 1 — Loader Cache (server-side, per loader)

Caches the data fetched by a loader before the section is rendered.

> **Sync loaders do not need cache.** A sync loader runs entirely in memory with no I/O — it is already instant. Adding `cache` to it only introduces overhead (key computation, serialization, cache lookup) and makes the code harder to reason about. Cache applies exclusively to async loaders that perform network calls or other I/O.

### Configuration

`cache` and `cacheKey` must be exported from a dedicated loader file inside the `loaders/` folder.

**They never work when defined inline inside a section file.** If the loader is written directly inside the section, extract it to `loaders/` first, then add the cache config there.

```ts
// loaders/myLoader.ts  ✅
export const cache =
  // "no-store" | "no-cache" | "stale-while-revalidate" | { maxAge: number }

export const cacheKey = (props, req, ctx) => string | null

// sections/MySection.tsx  ❌ — cache config here is ignored
export const loader = ...
export const cache = "stale-while-revalidate"; // never do this
```

### Cache modes

| Mode | Behavior | When to use |
|---|---|---|
| `"no-store"` *(default)* | Disables cache; also prevents CDN section caching | Carts, sessions, user-specific data |
| `"no-cache"` | Always fetches fresh, but section can still be CDN-cached | Loader must be fresh but section is safe to cache |
| `"stale-while-revalidate"` | Returns cached data, revalidates in background (default TTL: 60s) | **Best default** for public, read-mostly loaders |
| `{ maxAge: number }` | Same SWR behavior but with a longer TTL in seconds — use this when you want to enforce more cache time | Public data that is stable for longer periods (e.g. `maxAge: 60 * 60` for 1 hour) |

Default TTL: **60 seconds** (override via `CACHE_MAX_AGE_S` env var or per-loader `maxAge`).

### Cache key rules

The final key is composed of: **resolver name** + **return value of `cacheKey`**.

- **Never use the raw `req.url` or `url.href` as the key.** Real URLs carry tracking params (`utm_*`, `gclid`, `fbclid`, session tokens, etc.) that make every request look unique, effectively disabling the cache.
- **Build the key from props, not from the URL.** Use the loader `props` as the primary source of truth — they already represent the canonical inputs the framework parsed.
- If you do use the URL, reconstruct it with only the params you need (see examples below).
- Include segmentation traits (locale, currency, segment token) when they affect the result.
- Return `null` to disable caching for a specific invocation (e.g. logged-in user).

### Examples

```ts
// Public loader — key built from props only (safe, no URL noise)
export const cache = "stale-while-revalidate";
export const cacheKey = (props: { slug: string }) => props.slug;

// Segment-aware — bypass for logged-in users
export const cache = "stale-while-revalidate";
export const cacheKey = (_props: unknown, _req: Request, ctx: AppContext) => {
  if (!ctx.isAnonymous) return null;
  return ctx.segment?.token ?? "anonymous";
};

// Multi-prop key — compose from props, not from req.url
export const cache = "stale-while-revalidate";
export const cacheKey = (props: { category: string; page: number }) =>
  `${props.category}:${props.page}`;

// Enforce longer cache time (1 hour) — still uses SWR, just with a bigger maxAge
export const cache = { maxAge: 60 * 60 };
export const cacheKey = (props: { category: string }) => props.category;

// If you must use the URL, reconstruct it with only known-safe params
export const cache = "stale-while-revalidate";
export const cacheKey = (props: { slug: string }, req: Request) => {
  const { origin, pathname } = new URL(req.url);
  // Append only the props-derived params — never spread the original search string
  return `${origin}${pathname}?slug=${props.slug}`;
};

// Opt-out (cart, session)
export const cache = "no-store";
```

### Invalidation
Automatically invalidated on every new deployment. No manual invalidation before TTL expiry.

---

## Layer 2 — Stale Edge Cache (CDN, per section)

Caches the fully rendered section HTML at the CDN edge. Sections load asynchronously; those that exceed the render time budget are served as skeletons on first load, then fetched and patched from the CDN.

### Default TTL headers

| Directive | Value | Meaning |
|---|---|---|
| `s-maxage` | 60s | CDN holds the section for 60 seconds |
| `stale-while-revalidate` | 3600s | Serve stale for up to 1 hour while revalidating |
| `stale-if-error` | 86400s | Serve stale for up to 24 hours on origin errors |

### Cacheability rule

A section is cached at the CDN **only if all of its loaders are configured for caching** (i.e. none use `"no-store"`). A single uncached loader makes the whole section uncacheable.

### Async rendering

- Enabled by default for all sections.
- To disable: turn off **Optimization** in section properties in the Admin.
- Off-screen sections are deferred until the user scrolls near them.

---

## Layer 3 — HTML Page Cache (CDN, full page)

Caches the fully assembled page HTML at the CDN edge. A cache hit means zero server involvement.

> Currently enabled on select sites only. Contact the deco team to enable.

### Eligibility (cached)
- Anonymous visitors with no active session
- Standard page navigation requests
- Pages with no dynamic per-user state

### Always bypassed (served fresh)
- Logged-in users
- Responses that set cookies
- Pages with active non-cacheable A/B flags
- VTEX: users with active campaigns, price tables, or region-specific pricing

### Default Cache-Control
```
public, max-age=90, s-maxage=90, stale-while-revalidate=30
```
If the application sets its own `Cache-Control`, the platform default is ignored.

### Verify
```bash
curl -sI https://www.yoursite.com/ | grep -i cache-control
```
- Cacheable: `public, max-age=90, s-maxage=90, stale-while-revalidate=30`
- Not cacheable: `no-store, no-cache, must-revalidate`

### Invalidation
No manual purge. Pages expire naturally after TTL.

---

## How the layers interact

```
Request
  └─ HTML Page Cache (CDN) ──── HIT → serve page, done
       └─ MISS
            └─ Stale Edge Cache (CDN, per section) ── HIT → serve section HTML
                 └─ MISS
                      └─ Loader Cache (server) ── HIT → serve cached data, render
                           └─ MISS → fetch from upstream API, render, populate caches
```

---

## Agent workflow — improving cache on a store

When auditing or improving a store's cache:

1. **Find all async loaders** — look for files in the `loaders/` folder exporting a `loader` function that performs I/O (API calls, fetches). Skip sync loaders that only transform props — caching them is actively harmful. Also skip any `loader` defined inline inside a section file — cache config does not work there and the loader must be extracted to `loaders/` before cache can be applied.
2. **Check for missing cache config** — any async loader without `export const cache` defaults to `"no-store"` and blocks CDN section caching.
3. **Classify each loader**:
   - Public / read-mostly → `"stale-while-revalidate"` or `{ maxAge }` + a stable `cacheKey`
   - Must-be-fresh but section is safe → `"no-cache"` + `cacheKey`
   - User-specific / session → `"no-store"` (no `cacheKey` needed)
4. **Write `cacheKey` from props, not from the URL.** The URL contains tracking params and query strings that vary per visitor and destroy cache hit rates. Build the key by composing only the props fields that affect the result. Return `null` for authenticated contexts.
5. **Verify CDN cacheability** — after configuring loaders, check that sections whose loaders are all cached are actually being served from the edge.
6. **Check HTML page cache eligibility** — inspect `Cache-Control` headers on anonymous requests.

### Priority order
1. Add `cache` + `cacheKey` to every public **async** loader missing them.
2. Fix loaders using `"no-store"` unnecessarily (blocking section CDN caching).
3. Audit existing `cacheKey` implementations — replace any that use `req.url` or `url.href` directly with prop-based keys.
4. Tune TTLs: shorter for volatile data, longer (5–30 min) for stable catalog data.
