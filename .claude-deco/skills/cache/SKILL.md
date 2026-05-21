---
name: cache
description: Audit and improve deco store caching across all three layers: loader cache, stale edge cache (async render), and HTML page cache. Use when the user asks to improve cache, reduce latency, optimize loaders, configure TTL/cache keys, enable HTML cache, or debug cache-control headers on a deco storefront.
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

To set a custom TTL together with SWR mode, export `maxAge` as a separate number alongside `cache = "stale-while-revalidate"`:

```ts
export const cache = "stale-while-revalidate";
export const maxAge = 300; // 5 minutes
```

Default TTL: **60 seconds** (override via `CACHE_MAX_AGE_S` env var or per-loader `maxAge`).

### Cache key rules

The final key is composed of: **resolver name** + **return value of `cacheKey`**.

- **Never use the raw `req.url` or `url.href` as the key.** Real URLs carry tracking params (`utm_*`, `gclid`, `fbclid`, session tokens, etc.) that make every request look unique, effectively disabling the cache. Also avoid including the `origin` (hostname) — the same site may run under multiple origins (staging, custom domain, `*.deco.site`) and hostname variance causes unnecessary cache misses.
- **Build the key from props, not from the URL.** Use the loader `props` as the primary source of truth — they already represent the canonical inputs the framework parsed.
- If you do use the URL, reconstruct it using only `pathname` and the specific params you need (see examples below).
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

### How it works

The deco runtime middleware (`runtime/middleware.ts`) sets a `Cache-Control` header on HTML responses. The CDN (Cloudflare, Azion) caches the page when it sees a cacheable `Cache-Control`.

#### Cache-Control decision tree

```
Request arrives
│
├─ Set-Cookie header present?
│   └─ YES → Cache-Control: no-store, no-cache, must-revalidate  (never cached)
│
└─ NO → HTML response? + DECO_PAGE_CACHE_ENABLED=true + page not dirty?
    ├─ Any A/B flag not cacheable?
    │   └─ YES → Cache-Control: no-store, no-cache, must-revalidate
    │
    └─ NO → Cache-Control header already set?
        ├─ YES → keep it (app set its own value)
        └─ NO  → Cache-Control: <DECO_PAGE_CACHE_CONTROL>
                 (default: "public, max-age=90, s-maxage=90, stale-while-revalidate=30")
```

#### "Page dirty"

App middlewares (VTEX, WAKE) mark a page as **dirty** when per-user state is present (auth cookies, personalized content). Dirty pages are never cached.

For VTEX sites, the middleware marks pages dirty when it detects `VtexIdclientAutCookie`. Logged-in users always receive uncached responses.

### Eligibility

**Cached:**
- Anonymous visitors with no active session
- Standard page navigation requests
- Pages with no dynamic per-user state

**Always bypassed (served fresh):**
- Logged-in users
- Responses that set cookies
- Pages with active non-cacheable A/B flags
- VTEX: users with active campaigns, price tables, or region-specific pricing

### Step 1 — Set env vars (Kubernetes)

Set in the site's Kubernetes `state` secret (namespace `sites-<sitename>`):

| Env var | Required | Value |
|---------|----------|-------|
| `DECO_PAGE_CACHE_ENABLED` | Yes | `true` |
| `DECO_PAGE_CACHE_CONTROL` | No | Custom `Cache-Control`. Default: `public, max-age=90, s-maxage=90, stale-while-revalidate=30` |

### Step 2 — Add site to Cloudflare Page Cache rule

Two existing rules in Cloudflare handle HTML caching. Add the site's hostname to the appropriate one — no new rules need to be created:

| Rule | When to use |
|------|-------------|
| **Page Cache** | Standard — excludes logged-in users via `VtexIdclientAutCookie` cookie filter |
| **Page Cache - With UTM** | Same, but also caches pages with UTM query params in the URL |

Edit the rule and add a `Hostname equals www.site.com.br` condition to the existing list. The expression pattern:

```
(
  (http.host eq "www.site.com.br") or
  (http.host eq "www.other-site.com.br") or
  ...
) and not (http.cookie contains "VtexIdclientAutCookie")
```

> `contains "VtexIdclientAutCookie"` without `=` matches all VTEX auth cookie variants (`VtexIdclientAutCookie_accountname`, `VtexIdclientAutCookie_uuid`, etc.).

Both rules use:
- **Cache eligibility:** Eligible for cache
- **Browser TTL:** Use cache-control header if present, bypass cache if not

### Step 3 — Verify

```bash
# Anonymous user — expect cacheable header
curl -sI https://www.site.com.br/ | grep -i cache-control
# → cache-control: public, max-age=90, s-maxage=90, stale-while-revalidate=30

# Logged-in user — expect no-cache
curl -sI https://www.site.com.br/ \
  -H "Cookie: VtexIdclientAutCookie=somevalue" \
  | grep -i cache-control
# → cache-control: no-store, no-cache, must-revalidate
```

### Common issues

| Symptom | Likely cause |
|---------|-------------|
| `Cache-Control: no-store` even with env var set | `Set-Cookie` in response, or page is dirty (auth cookie present) |
| Cloudflare still serving MISS | Rule not added or cookie filter blocking the request |

### ⚠️ VTEX — do NOT use a site-level `_middleware.ts` to strip cookies

As of `apps/vtex@0.47+`, the VTEX app already guarantees that anonymous requests on the default sales channel emit **no `Set-Cookie` headers** — so deco's runtime middleware sets the correct cacheable `Cache-Control` automatically. The VTEX middleware also correctly marks responses dirty (sets `no-store`) for logged-in users, non-default sales channels, and active campaigns.

Adding a `routes/_middleware.ts` that strips VTEX cookies and overrides `no-store` is **dangerous**: when the VTEX app intentionally marks a response non-cacheable (e.g. user with a non-default price table), the site middleware will re-enable caching for that response, serving wrong prices or promotions to other users.

If a site already has such a middleware, **remove it** and rely on the env vars + Cloudflare rule instead.

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
6. **Check HTML page cache eligibility** — inspect `Cache-Control` headers on anonymous requests. If missing or `no-store`, check: is `DECO_PAGE_CACHE_ENABLED=true`? Is the site in the Cloudflare rule?

### Priority order
1. Add `cache` + `cacheKey` to every public **async** loader missing them.
2. Fix loaders using `"no-store"` unnecessarily (blocking section CDN caching).
3. Audit existing `cacheKey` implementations — replace any that use `req.url` or `url.href` directly with prop-based keys.
4. Tune TTLs: shorter for volatile data, longer (5–30 min) for stable catalog data.
5. Enable HTML page cache via `DECO_PAGE_CACHE_ENABLED=true` + Cloudflare rule.
