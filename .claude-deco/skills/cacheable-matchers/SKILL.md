---
name: cacheable-matchers
description: "Make deco storefront pages with matchers (A/B tests, date windows, segment targeting) cacheable at the CDN edge. Use when a page uses matcher blocks or MultivariateFlag and returns Cache-Control: no-store. Covers the framework's cache-decision gates, the cache: 'no-store' default on site loaders, the missing cacheable=true on custom matchers, the Deco-Cache-Vary-Cookies hint header, and a diagnostic checklist."
---

# Cacheable Matchers

Pages that use matcher blocks (A/B tests, date windows, query-string variants, sticky session matchers) **can** be cached at the CDN edge — but only when the site is configured correctly. The framework default for loaders is `cache: "no-store"`, and matchers without an explicit `cacheable: true` declaration also kill caching. This skill walks every gate the framework checks, the gotchas you'll hit, and a diagnostic checklist to fix a matcher page stuck on `Cache-Control: no-store`.

For the broader caching picture (loader / section / page layers), see the companion `cache` skill. This skill is the deep-dive for matcher-wrapped pages specifically.

---

## Minimum versions

```json
// deno.json
{
  "imports": {
    "deco/": "https://denopkg.com/deco-cx/deco@1.201.0/",
    "apps/": "https://denopkg.com/deco-cx/apps@0.154.0/"
  }
}
```

If the site is on older versions, the runtime doesn't yet apply the matcher-aware cache decision. Bump the deps first.

---

## How the framework decides cacheability

The deco runtime applies `Cache-Control` to HTML responses based on a chain of gates. If ANY gate fails, the page falls back to `no-store, no-cache, must-revalidate`. Order of checks:

1. **App middleware allow** — the active commerce app's middleware (e.g. `apps/vtex/middleware.ts`) decides per-request whether the response is safe to cache (anonymous + default segment for VTEX). It signals "yes" by setting a per-request bag key the framework reads.
2. **No foreign Set-Cookie** — the response can carry framework cookies (`deco_matcher_*`, `deco_segment`) but any OTHER `Set-Cookie` (e.g. session, cart, tracking) makes it uncacheable.
3. **`vary.shouldCache !== false`** — every loader called during the render contributes to a "should we cache?" decision. Any loader with `cache: "no-store"` OR `cacheKey` returning `null` flips this to false.
4. **All flags cacheable** — every matcher / flag that fired must export `cacheable = true` (strict equality — `undefined` fails).
5. **HTML content type** — must be `text/html`.

If all five pass, the framework emits the cacheable header pattern:

```
Cache-Control: public, max-age=90, stale-while-revalidate=3600, stale-if-error=86400
Vary: Accept-Encoding
Deco-Cache-Vary-Cookies: deco_matcher_<hash>_<split>, deco_segment
```

---

## Gotcha #1 — Site loaders default to `cache: "no-store"`

**The single most common reason** a matcher page stays uncacheable.

A loader file without an explicit `export const cache = ...` defaults to `cache: "no-store"`. That setting flips `vary.shouldCache = false` (gate #3 above), which makes the entire page no-store regardless of matcher state.

### Detect

```bash
for f in loaders/*.ts loaders/*.tsx; do
  base=$(basename "$f")
  cache=$(grep -m1 -E "^export const cache" "$f" 2>/dev/null || echo "MISSING → defaults to no-store ❌")
  echo "$base: $cache"
done
```

### Fix

For loaders that return public/static data (admin-configured passthroughs, lookups that don't depend on user identity), declare an explicit cache mode:

```ts
// loaders/PaymentMethods.ts
export default function PaymentMethods(props: Props) { ... }

// Add this:
export const cache = 'stale-while-revalidate'
```

For loaders whose result varies by inputs (skuId, coupon, postal code), also declare a `cacheKey`:

```ts
// loaders/getProductPrice.ts
export const cache = 'stale-while-revalidate'
export const cacheKey = (props: Props) => props.skuId ?? ''
```

For loaders that genuinely vary per user (cart, profile, session) and should NOT be SSR-cached, declare `cache: "no-store"` explicitly AND consider moving the rendering client-side (Gotcha #5).

---

## Gotcha #2 — Custom matchers default `cacheable` to `undefined`

The framework gates the page cache decision on `flag.cacheable === true` (strict). Without an explicit declaration, `flag.cacheable` is `undefined` and the page goes no-store.

### When `cacheable = true` is safe

A matcher is safe to cache when its result is fully determined by inputs the CDN cache key can capture:

- **Sticky-session matchers** (`sticky = "session"`) — result persists in a `deco_matcher_*` cookie; the CDN cache key includes that cookie via `deco_segment`. ✅
- **Date-based matchers** with short cache TTLs — result is deterministic for the request time; cache TTL bridges transitions. ✅
- **Static matchers** (always, never, site, device, pathname, queryString) — result is request-deterministic. ✅
- **User-agent / geo / cookie matchers** — only safe if your CDN cache key already partitions by UA/geo/cookie. Otherwise leave `cacheable` undeclared. ⚠️

### Audit your custom matchers

```bash
for f in matchers/*.ts; do
  base=$(basename "$f")
  cacheable=$(grep -E "^export const cacheable" "$f" 2>/dev/null || echo "MISSING → page won't cache ❌")
  echo "$base: $cacheable"
done
```

### Reference — `apps@0.154.0` matcher cacheable status

✅ `always`, `date`, `site`, `device`, `environment`, `host`, `queryString`, `multi`, `negate`, `never`, `pathname`, `random`

❌ `userAgent`, `location`, `cookie`, `cron` — still missing `cacheable`. If your site uses any of these, the page won't cache until they're either fixed upstream or shadowed locally.

### Fix

```ts
// matchers/myCustomMatcher.ts
export const sticky = "session";
export const cacheable = true; // ← add this

const MatchSomething = (props) => /* ... */;
export default MatchSomething;
```

---

## Gotcha #3 — `cacheKey` defaults to `() => ""`

If a loader has `cache: "stale-while-revalidate"` but no explicit `cacheKey`, ALL invocations from the same resolver share one cache entry. For loaders with varying props, this means the first call's result is cached and returned for every subsequent call — silent correctness bug, not a cache-control issue.

### Fix

Always declare `cacheKey` when the loader's result depends on `props` or `req`:

```ts
export const cacheKey = (props: Props, req: Request) => {
  return `${props.category}:${props.page}`;
};
```

For pure passthrough loaders where props are baked at admin level (per block instance), the default empty cacheKey is fine because the framework prefixes the key with the resolver ID, which differs per block instance.

---

## Gotcha #4 — Foreign Set-Cookies kill caching

The framework distinguishes between:

- **Framework cookies** — `deco_matcher_*` and `deco_segment`. These are expected and don't disqualify caching.
- **Foreign cookies** — anything else. If a loader, section, or middleware emits a non-framework Set-Cookie on the response, the page goes no-store immediately.

### Common foreign-cookie offenders

- A site middleware setting an analytics or session cookie server-side.
- A section that calls `setCookie` on the response.
- A loader that returns an effect-laden response with a Set-Cookie header.

### Fix

Move cookie-setting to client-side JavaScript wherever possible:

```ts
// ❌ Don't do this in a loader / section
ctx.response.headers.append("set-cookie", "tracker=abc");

// ✅ Do this in an island / client script
document.cookie = "tracker=abc; path=/; SameSite=Lax";
```

For cookies that genuinely must be set server-side, accept the cache penalty for that page.

---

## Gotcha #5 — Personalizing loaders need explicit `cache: "no-store"`

`apps@0.154.0` adds `cache: "no-store"` to ~30 loaders that return user-personalized data (vtex/linx/shopify cart, user, wishlist, sessions, orders, etc.). This is the **correct** behavior for those loaders — but it means **any page that calls them server-side cannot cache**.

If your Header section calls `vtex/loaders/user.ts` to render "Hi, $name", the entire page becomes no-store. The Header is on every page, so every page becomes no-store.

### Fix — render personalization client-side

```tsx
// ❌ Server-rendered user greeting kills the page cache
export async function loader(_, req, ctx) {
  const user = await ctx.invoke.vtex.loaders.user({});
  return { user };
}

// ✅ Render a placeholder server-side, populate client-side via island
import { useEffect, useState } from "preact/hooks";

export default function HeaderGreeting() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch("/api/me").then(r => r.json()).then(setUser);
  }, []);
  return <span>{user ? `Hi, ${user.firstName}` : "Login"}</span>;
}
```

Same pattern for cart counts, wishlist badges, etc. The page renders a stable skeleton (cacheable); the user-specific bits hydrate from the browser.

---

## Diagnostic checklist — page returns `Cache-Control: no-store`

Work down this list in order. Each step is independent — once you find the culprit, the rest are sanity checks.

### 1. Check the response

```bash
curl -sI -A "Mozilla/5.0 Chrome" https://your-site.com/your-pdp-slug/p \
  | grep -iE "x-powered-by|cache-control|vary|set-cookie|deco-cache-vary-cookies"
```

- `x-powered-by: deco@<version>` — confirm `1.201.0+`.
- `cache-control: no-store` — confirmed problem.
- `set-cookie:` — if any cookie OTHER than `deco_matcher_*`/`deco_segment` appears, **Gotcha #4**.
- `deco-cache-vary-cookies` absent — the framework didn't even consider the page cacheable. One of gates 1–5 failed earlier.

### 2. Map the page's loaders

Look at the page's CMS block JSON (`.deco/blocks/pages-*.json` for Fresh-era sites) for the page slug. Walk every block referenced and collect `__resolveType` values. Filter for anything containing `loaders/`.

```bash
python3 -c "
import json
with open('.deco/blocks/pages-<slug>.json') as f:
    data = json.load(f)

def walk(obj, out):
    if isinstance(obj, dict):
        if '__resolveType' in obj: out.add(obj['__resolveType'])
        for v in obj.values(): walk(v, out)
    elif isinstance(obj, list):
        for v in obj: walk(v, out)

refs = set()
walk(data, refs)
for r in sorted(r for r in refs if 'loaders/' in r):
    print(r)
"
```

For each loader, verify `cache` is declared (and not `'no-store'` unless intentional). See Gotcha #1.

### 3. Map the page's matchers / flags

Same scan, this time filtering for `matchers/` or `flags/multivariate*`. For each matcher file, verify it exports `cacheable = true`. See Gotcha #2.

### 4. Check for personalizing loaders bleeding through

Headers and footers run on every page. If your Header calls a personalizing loader (`vtex/loaders/user.ts`, cart, session etc.), that single call disqualifies every page from caching. See Gotcha #5.

### 5. Try with no cookies (cold visitor)

```bash
curl -sI -A "Mozilla/5.0 Chrome" https://your-site.com/your-pdp-slug/p
```

If the response includes `Set-Cookie: deco_matcher_*` AND `Cache-Control: public`, the framework gates are passing. The first cold visitor will always trigger a Set-Cookie (matcher fires for the first time), and CDNs typically bypass caching when Set-Cookie is in the response. Subsequent visitors who already carry the cookie won't trigger a Set-Cookie → CDN can cache.

### 6. Try with framework cookies on the request

Take the `deco_matcher_*` and `deco_segment` cookies from the cold response and replay:

```bash
curl -sI -A "Mozilla/5.0 Chrome" \
  -H "Cookie: deco_matcher_<hash>=<value>; deco_segment=<value>" \
  https://your-site.com/your-pdp-slug/p
```

This should return WITHOUT a fresh `Set-Cookie` for the matcher (the cookie is stable), and the response should be `Cache-Control: public, max-age=...`.

---

## Verifying the cache is actually working

Once the origin headers look right, CDN edge caching depends on your CDN configuration — your hosting provider handles the cache key and TTL.

Markers of healthy edge caching:

- Provider-specific cache HIT header (e.g. `cf-cache-status: HIT`) on warm requests.
- The `age:` response header is non-zero on HIT responses.
- Variants are isolated: requests with two different `deco_segment` cookie values get separate cache entries (curl with both sets, observe that `age` doesn't bleed between them).

---

## The `Deco-Cache-Vary-Cookies` hint header

When the framework emits a cacheable response, it includes:

```
Deco-Cache-Vary-Cookies: deco_matcher_3425517349_0.5, deco_segment
```

This is a documentation header — it lists which framework cookies are part of the cache identity contract for that response. Your CDN operator should ensure their cache key includes these cookies (or specifically `deco_segment`, which aggregates all sticky flag state).

It only appears when the framework actually sets Set-Cookies on this response. On warm requests where the cookies are stable (matching the request), no new Set-Cookie is emitted and the hint header is absent — but the cache contract is still in effect.

---

## When NOT to chase matcher caching

- **Logged-in user flows** — checkout, account, order history. These rightly stay no-store.
- **Non-default VTEX segments** — campaigns, price tables, region overrides. The apps middleware will keep these requests no-store; that's correct.
- **Content-different A/B tests where statistical balance matters from cold traffic** — the first cold visitor's variant gets cached and served to subsequent cold visitors for the TTL window, which can bias the test. Acceptable for visual A/B tests (e.g. button color, CSS tweaks); problematic for major content swaps.

If you're in any of these cases, the page legitimately should not cache. This skill applies to truly cacheable matcher pages: visual A/B tests, date-window banners, sticky segment-based variants where the variant difference is bounded and the cache TTL is acceptable.

---

## Agent workflow — applying this to a site

1. **Confirm versions** — `deco@1.201.0+` and `apps@0.154.0+` in `deno.json`. Bump if needed.
2. **Audit site loaders** (`loaders/*.ts`) — every loader missing `export const cache` defaults to no-store. Declare `cache: "stale-while-revalidate"` (and an explicit `cacheKey` if props vary) on every loader that returns public data. Mark genuinely personalizing loaders `cache: "no-store"` and plan to move that rendering client-side.
3. **Audit custom matchers** (`matchers/*.ts`) — every matcher missing `export const cacheable = true` will keep the pages it lands on uncacheable. Add the export to every matcher whose result is deterministic from cache-key inputs.
4. **Audit personalizing loaders bleeding into shared sections** — Header, Footer, and any site-wide section. If they call `vtex/loaders/user.ts` or similar, move that rendering to an island.
5. **Audit foreign Set-Cookies** — grep `setCookie\|Set-Cookie` across loaders/sections/middleware. Move tracking and session cookies to client-side JS.
6. **Verify with curl** — work down the diagnostic checklist above. Both cold and warm requests should produce the expected headers.

### Priority order

1. Loader `cache` declarations (Gotcha #1) — biggest impact, fastest fix.
2. Matcher `cacheable = true` declarations (Gotcha #2) — page-level unlock.
3. Move personalizing renders client-side (Gotcha #5) — unblocks shared sections (Header/Footer).
4. Strip foreign Set-Cookies (Gotcha #4) — usually small but cumulative.
5. Loader `cacheKey` correctness (Gotcha #3) — correctness fix, doesn't affect headers but affects cache hit rates.
