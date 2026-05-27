---
name: cacheable-matchers
description: "Make deco storefront pages with matchers (A/B tests, date windows, segment targeting) cacheable at the CDN edge. Use when a page uses matcher blocks or MultivariateFlag and returns Cache-Control: no-store. Covers the framework's cache-decision gates, the cache: 'no-store' default on site loaders, the missing cacheable=true on custom matchers, the inline-cookie script (1.201.2+), the cold-visitor bias trade-off, and a diagnostic checklist."
---

# Cacheable Matchers

Pages that use matcher blocks (A/B tests, date windows, query-string variants, sticky session matchers) **can** be cached at the CDN edge — but only when the site is configured correctly. The framework default for loaders is `cache: "no-store"`, and matchers without an explicit `cacheable: true` declaration also kill caching. This skill walks every gate the framework checks, the gotchas you'll hit, the cold-visitor bias trade-off you're accepting, and a diagnostic checklist to fix a matcher page stuck on `Cache-Control: no-store`.

For the broader caching picture (loader / section / page layers), see the companion `cache` skill. This is the deep-dive for matcher-wrapped pages specifically.

---

## Minimum versions

```json
// deno.json
{
  "imports": {
    "deco/": "https://denopkg.com/deco-cx/deco@1.201.2/",
    "apps/": "https://denopkg.com/deco-cx/apps@0.154.0/"
  }
}
```

Don't forget the matching JSR pins if your `deno.json` carries both styles:

```json
"@deco/deco": "jsr:@deco/deco@1.201.2",
"@deco/dev": "jsr:@deco/dev@1.201.2"
```

### Why 1.201.2 specifically

| Version | What it added |
|---|---|
| `1.200.0` | Framework cookie-aware page cache decision (no more `Vary: cookie`, framework Set-Cookies don't auto-trigger no-store) |
| `1.201.0` | Stable release of the above |
| `1.201.1` | Inline `<script>document.cookie="..."</script>` injected into HTML body for framework cookies — survives CDN Set-Cookie stripping |
| **`1.201.2`** | **Set-Cookie response headers stripped on cacheable HTML 200 responses** — the inline script is the source of truth. Lets CDNs running `respect_origin` cache cold-visit responses cleanly. |

`apps@0.154.0` adds `cacheable=true` on `website/matchers/random.ts` and `cache: "no-store"` on ~30 personalizing loaders (cart, user, wishlist, session, orders, profile…).

---

## How the framework decides cacheability

The deco runtime applies `Cache-Control` to HTML responses based on a chain of gates. If ANY gate fails, the page falls back to `no-store, no-cache, must-revalidate`. Order of checks:

1. **App middleware allow** — the active commerce app's middleware (e.g. `apps/vtex/middleware.ts`) decides per-request whether the response is safe to cache (anonymous + default segment for VTEX). It signals "yes" by setting a per-request bag key the framework reads.
2. **No foreign Set-Cookie** — the response can carry framework cookies (`deco_matcher_*`, `deco_segment`) but any OTHER `Set-Cookie` (session, cart, tracking) disqualifies the response.
3. **`vary.shouldCache !== false`** — every loader called during the render contributes to a "should we cache?" decision. Any loader with `cache: "no-store"` OR `cacheKey` returning `null` flips this to false.
4. **All flags cacheable** — every matcher / flag that fired must export `cacheable = true` (strict equality — `undefined` fails).
5. **HTML content type** — must be `text/html`.

If all five pass, the response looks like this (as of `1.201.2`):

```
Cache-Control: public, max-age=90, stale-while-revalidate=3600, stale-if-error=86400
Vary: Accept-Encoding
Deco-Cache-Vary-Cookies: deco_matcher_<hash>, deco_segment

<html>...
  <script>
    document.cookie="deco_matcher_<hash>=<value>; path=/; max-age=2592000; samesite=Lax";
    document.cookie="deco_segment=<value>; path=/; max-age=2592000; samesite=Lax";
  </script>
...</html>
```

**Notice what's missing**: there is no `Set-Cookie: deco_matcher_*` or `Set-Cookie: deco_segment` response header. Since `1.201.2` the framework strips them. The inline `<script>` in the HTML body handles client-side cookie persistence. This is what makes the response cleanly cacheable at CDNs running `respect_origin` mode (which treat any Set-Cookie as a personalization signal).

**Trade-off**: this approach is JavaScript-dependent. No-JS clients (curl without a cookie jar, very old crawlers, RSS readers) won't persist matcher cookies and will re-evaluate on every request. Acceptable per the upstream rationale — matcher stickiness has been JS-dependent since `1.201.1`.

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

A matcher is safe to mark cacheable when its result is **fully determined by inputs the CDN cache key can capture**:

| Matcher type | Reads | Safe? |
|---|---|---|
| **Sticky-session** (`sticky = "session"`) | Result persisted in `deco_matcher_*` cookie, aggregated into `deco_segment` | ✅ Yes — CDN cache key includes `deco_segment` |
| **URL-based** (path or pathname matchers) | `request.url.pathname` | ✅ Yes — URL is in cache key by default |
| **Date / cron / static** (`always`, `never`, `date`, `cron`) | Request time or constants | ✅ Yes — short edge TTL bridges time-based transitions |
| **Device-type** | UA hash → mobile/desktop | ✅ Yes IF CDN cache key includes device-type (it usually does on deco sites) |
| **Query-string** | Specific URL search params | ⚠️ ONLY safe if the params are NOT in your CDN's exclude list. UTM params, gclid, fbclid etc. are typically stripped — matchers reading them would be undetectable to the cache key, causing collisions |
| **User-agent** | Full UA string | ⚠️ Only if CDN cache key includes UA — most don't by default |
| **Geo / IP** | Visitor location | ⚠️ Only if CDN cache key has geo bucket |
| **Identity-keyed** (auth, session) | Per-user state from cookies the CDN strips | ❌ Never — leaks personalization across visitors |

### Audit your site's custom matchers

```bash
for f in matchers/*.ts; do
  base=$(basename "$f")
  c=$(grep -E "^export const cacheable" "$f" 2>/dev/null || echo "MISSING ❌")
  echo "$base: $c"
done
```

### Reference — `apps@0.154.0` matcher cacheable status

✅ HAS `cacheable = true`: `always`, `date`, `site`, `device`, `environment`, `host`, `queryString`, `multi`, `negate`, `never`, `pathname`, `random`

❌ MISSING `cacheable`: `userAgent`, `location`, `cookie`, `cron` — pages using these will keep going no-store until the framework declares them.

### Real-world site-matcher audit (Lojas Torra example)

Sites commonly accumulate custom matchers in their own `matchers/` directory. Same rules apply:

| Matcher | Reads | Decision |
|---|---|---|
| `canonical.ts` | URL pathname + admin-baked regex | Marked `cacheable = true` ✅ |
| `multipleCanonical.ts` | URL pathname + admin URL list | Marked `cacheable = true` ✅ |
| `hasKitlook.ts` | PDP product data (loaded via URL+segment) | Marked `cacheable = true` ✅ — data is deterministic from cache key inputs |
| `hasProduct.ts` | PLP product list (loaded via URL+segment) | Marked `cacheable = true` ✅ — same reasoning |
| `utm.ts` | `?utmcampaign` query param | **NOT marked** — the CDN strips UTM params from the cache key, so matcher results would collide across UTM variants |

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

For pure passthrough loaders where props are baked at admin level (per block instance), the default empty cacheKey is fine — the framework prefixes the cache key with the resolver ID, which differs per block instance.

---

## Gotcha #4 — Foreign Set-Cookies kill caching

The framework distinguishes between:

- **Framework cookies** — `deco_matcher_*` and `deco_segment`. Stripped from response headers post-`1.201.2`; persisted via inline script in HTML body instead.
- **Foreign cookies** — anything else. If a loader, section, or middleware emits a non-framework `Set-Cookie` on the response, the page goes no-store immediately.

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
UA="Mozilla/5.0 Chrome/126"
curl -sD /tmp/h -A "$UA" -o /tmp/b "https://your-site.com/your-page/p"
grep -iE "x-powered-by|cache-control|vary|deco-cache-vary-cookies|^set-cookie" /tmp/h
grep -oE 'document\.cookie="deco_(matcher_[a-z0-9_]+\.[0-9]+|segment)[^<]{0,180}' /tmp/b | head -3
```

Expected on a cold matcher-firing request (`deco@1.201.2+`):

- `x-powered-by: deco@1.201.2` (or later)
- `cache-control: public, max-age=...` ← if this says `no-store`, the page failed a gate
- `vary: Accept-Encoding` (NOT `Accept-Encoding, cookie`)
- `Deco-Cache-Vary-Cookies: deco_matcher_..., deco_segment` ← framework signals which cookies are cache-identity
- **NO `Set-Cookie: deco_matcher_*`** and **NO `Set-Cookie: deco_segment`** ← framework strips these post-`1.201.2`
- **Inline `<script>document.cookie="deco_matcher_..."` in the HTML body** ← the new persistence mechanism

If `cache-control` is `no-store` and `Deco-Cache-Vary-Cookies` is **absent**, the framework didn't even consider the page cacheable. One of gates 1–5 failed earlier.

If you DO see `Set-Cookie: deco_matcher_*` in response headers, your site is on a version older than `1.201.2`. Bump.

### 2. Map the page's loaders

Look at the page's CMS block JSON (`.deco/blocks/pages-*.json` for Fresh-era sites) for the page slug. Walk every block referenced and collect `__resolveType` values. Filter for `loaders/`.

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

### 4. Look for the catch-all `/*` page trap

Many sites have a `pages-category-*.json` (or similar) with `pathTemplate: /*` that catches every URL without its own page JSON. If THAT page references a matcher missing `cacheable=true`, every catch-all-matched route goes no-store while specifically-pathed routes cache fine.

Lojas Torra hit this exact pattern: `/feminino`, `/masculino`, etc. fell through to a `/*` page using `site/matchers/multipleCanonical.ts` → no `cacheable` → all category PLPs went no-store, while specific category pages like `/amarelo` (with their own page JSON) cached fine.

### 5. Check for personalizing loaders bleeding through

Headers and footers run on every page. If your Header calls a personalizing loader (`vtex/loaders/user.ts`, cart, session etc.), that single call disqualifies every page from caching. See Gotcha #5.

### 6. Try with no cookies (cold visitor)

```bash
curl -sI -A "Mozilla/5.0 Chrome" https://your-site.com/your-page/p
```

If the response is `Cache-Control: public, ...` and the body contains the inline `document.cookie="..."` script, the framework gates are passing.

### 7. Try with framework cookies on the request

```bash
curl -sI -A "Mozilla/5.0 Chrome" \
  -H "Cookie: deco_matcher_<hash>=<value>; deco_segment=<value>" \
  https://your-site.com/your-page/p
```

This should return WITHOUT a fresh `Deco-Cache-Vary-Cookies` header AND no inline script for framework cookies in the body — the framework correctly skips both when cookies are stable.

---

## The cold-visitor bias — important trade-off to understand

When you mark a sticky `random.ts`-style matcher as `cacheable = true`, you accept a specific statistical trade-off. Anyone running A/B tests should understand it.

### What happens

Picture the CDN cache as a row of boxes, one per `(URL × cache-key cookies × device-type)`. All cold visitors (no cookies) for a given URL share the SAME box because their `deco_segment` cookie is empty.

```
Cold visitor request
  → CDN cache key: (URL, device, deco_segment="", vtex_segment="", VTEXSC="")
  → All cold visitors share this single key
  → Cache box contains: whatever variant Math.random() picked
     on the last origin refresh of this box (every ~max-age seconds)
  → Inline <script> in cached HTML sets visitor's cookie to that variant
```

The randomness lives at the **box refresh moment** (every ~max-age seconds, when CDN re-fetches from origin), not the **visitor request moment**.

### Concrete consequence

If your edge TTL is 300s (5 min), the cache box re-rolls Math.random() at most every 5 minutes. Within any 5-minute window, **every cold visitor to that URL sees the same variant**. The variant rotates over time as the box refreshes.

A visitor doing 5 incognito sessions in 5 minutes will see the same variant all 5 times — that's one cache window, one variant.

### Does this break a 50/50 test?

It depends on traffic shape:

**Long-tail catalog (most stores)**: A typical e-commerce site has tens of thousands of PDPs, each with a few visits per day. Each PDP has its OWN independent cache box, rolling Math.random() independently on its own refresh schedule. A new cold visitor lands on some PDP; that PDP's current box has either A or B with ~50% probability at any moment. Aggregate across visitors and PDPs: **functionally indistinguishable from per-visitor 50/50 randomization**.

**Concentrated traffic (single-product launches, viral items, single-page tests)**: One URL gets thousands of hits per hour. Each 5-min window batches hundreds of visitors into one variant. The aggregate still trends ~50/50 over enough time, but variance within any short window is severe (100/0 splits per window). Statistical power to detect small lift drops. Time-of-day buying behavior can correlate with variant assignment and confound the analysis.

### Rule of thumb

- **Visual / CSS-only A/B tests** (e.g., button color, mobile button position, layout tweaks): the bias doesn't matter. Mark sticky matchers cacheable, get the edge-caching win.
- **Content-different A/B tests** (different copy, different hero images, different promo logic): consider one of the mitigations below.
- **Small-lift conversion tests on a top-10 SKU**: don't mark the matcher cacheable. Take the origin-load hit for that test's pages.

### Mitigations

| Option | Effect | Cost |
|---|---|---|
| **Lower edge TTL** (e.g. `max-age=60`) | Variant rotates 5× more often per box | 5× more origin requests during the test |
| **Don't mark this specific matcher `cacheable`** | Pages using it go no-store; other matchers/pages still cache | Loses edge caching for affected pages only |
| **Deterministic bucketing** (custom matcher) | Hash visitor IP/UA into 2 buckets, each bucket → one variant; per-visitor stable; cache key includes bucket → variants get separate boxes | New matcher work; 2× cache entries per URL |
| **Move matcher to client-side** | Server renders bucket-agnostic shell; JS picks variant on hydrate | First-paint can't show variant; different UX pattern |

---

## When NOT to chase matcher caching

- **Logged-in user flows** — checkout, account, order history. These rightly stay no-store.
- **Non-default VTEX segments** — campaigns, price tables, region overrides. The apps middleware keeps these requests no-store; that's correct.
- **Identity-keyed matchers** — anything reading auth, session, or per-user state. Never mark these cacheable.
- **Long-tail search queries** — `vtex/loaders/intelligentSearch/productListingPage.ts` explicitly returns `cacheKey: null` for search terms not in the site's `cachedSearchTerms` allowlist. Search for popular terms caches; long-tail doesn't. Working as designed; not a bug. Customers who want a specific term cached add it to `cachedSearchTerms.extraTerms`.

If you're in any of these cases, the page legitimately should not cache.

---

## The `Deco-Cache-Vary-Cookies` hint header

When the framework emits a cacheable response, it includes:

```
Deco-Cache-Vary-Cookies: deco_matcher_3425517349_0.5, deco_segment
```

This is a documentation header — it lists which framework cookies are part of the cache identity contract for that response. Your CDN operator should ensure the cache key includes these cookies (or specifically `deco_segment`, which aggregates all sticky flag state).

It only appears when the framework actually had framework Set-Cookies queued for this response (which it then stripped). Warm requests where cookies were stable on the way in don't emit it, but the cache contract is still in effect.

---

## Agent workflow — applying this to a site

1. **Confirm versions** — `deco@1.201.2+` and `apps@0.154.0+` in `deno.json` (URL and JSR pins). Bump if needed.
2. **Audit site loaders** (`loaders/*.ts`) — every loader missing `export const cache` defaults to no-store. Declare `cache: "stale-while-revalidate"` (and an explicit `cacheKey` if props vary) on every loader that returns public data. Mark genuinely personalizing loaders `cache: "no-store"` and plan to move that rendering client-side.
3. **Audit custom matchers** (`matchers/*.ts`) — every matcher missing `export const cacheable = true` will keep the pages it lands on uncacheable. Add the export to every matcher whose result is deterministic from cache-key inputs. **Audit query-param matchers separately**: if your CDN strips a param from the cache key (UTM, gclid, etc.) and a matcher reads it, do NOT mark that matcher cacheable.
4. **Check the catch-all `/*` page trap** — if a `pages-category-*.json` (or similar) covers `/*`, look at its matchers. A missing `cacheable=true` there flips every category route off the cache.
5. **Audit personalizing loaders bleeding into shared sections** — Header, Footer, and any site-wide section. If they call `vtex/loaders/user.ts` or similar, move that rendering to an island.
6. **Audit foreign Set-Cookies** — grep `setCookie\|Set-Cookie` across loaders/sections/middleware. Move tracking and session cookies to client-side JS.
7. **Verify with curl** — work down the diagnostic checklist above. Cold and warm requests should produce the expected headers + inline script.
8. **Understand the cold-visitor bias** — if any of your sticky-session matchers is marked `cacheable: true`, you've accepted that all cold visitors to a given URL during a cache window see the same variant. Confirm this is acceptable for each test; for visual tests it's fine, for content-meaningful tests consider the mitigations.

### Priority order

1. Loader `cache` declarations (Gotcha #1) — biggest impact, fastest fix.
2. Matcher `cacheable = true` declarations (Gotcha #2) — page-level unlock. Don't forget the catch-all page.
3. Move personalizing renders client-side (Gotcha #5) — unblocks shared sections (Header/Footer).
4. Strip foreign Set-Cookies (Gotcha #4) — usually small but cumulative.
5. Loader `cacheKey` correctness (Gotcha #3) — correctness fix, doesn't affect headers but affects cache hit rates.

The expected outcome: a representative PDP/PLP/home/search-with-popular-term returns `Cache-Control: public, max-age=...` with `Vary: Accept-Encoding`, `Deco-Cache-Vary-Cookies` listing the framework cookies, and an inline `<script>document.cookie=...</script>` in the HTML body. Long-tail search, cart, checkout, and logged-in flows correctly stay `no-store`.
