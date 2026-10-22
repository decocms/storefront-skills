# Cache correctness on the worker

There are up to four layers (edge HTML, worker response cache, `/_serverFn`,
loader cache in KV keyed by build hash). "HTML is not cached" on a TanStack
site is a **bug**, not a feature — usually a stray `Set-Cookie`. Run
`parity cache probe` on the candidate for the automated part.

---

## Segment and user data

🔴 These leak data or break login; they block go-live.

| Symptom | Root cause | Fix |
|---|---|---|
| Logged-in users get the anonymous cached `/`, login loop (Zee.Dog) | `buildSegment` returned only `regionId` | segment by device and login; logged-in bypasses the HTML cache |
| Wishlist of one user shown to another (Zee.Dog) | `export const cache = "listing"` on a section whose loader reads cookies | no section cache on cookie/user-reading loaders |
| Customer data from cache (Granado) | commerce client cached account GraphQL | account loaders always fresh; `registerCachePattern({ profile: "private" })` for logged-in paths |

```bash
grep -rn "export const cache" src/sections src/loaders
# for each hit: does its loader read cookies / headers / user? → remove the cache
curl -sI -H "Cookie: <real session cookies>" https://$HOST/ | grep -i "x-cache\|cache-control"   # must not be HIT from anon
```

## Set-Cookie kills the HTML cache

| Cause | Where | Fix |
|---|---|---|
| `cart` / `showCart` prop still declared on `Global` in `.deco/blocks`; the framework resolves every `__resolveType` even if unused → `Set-Cookie: cart_*` | Zee.Dog (70 blocks), Zee.Now | remove the prop from the blocks |
| backend re-sets cookies on every request (`user_id=""`…) | Zee.Dog | set only on first visit or on change |
| non-VTEX site with default `DEFAULT_SAFE_COOKIES` (VTEX names) | Zee.Now: 10 Set-Cookie per visit, TTFB 3–7 s vs 0.4 s on HIT | `safeCookies: [...]` with the site's identity cookies |
| A/B matcher cookie on cached entries | Monte Carlo (split stuck 59/41) | add a fingerprint of the random matchers to `buildSegment().flags` |

```bash
for p in / /<plp> /<pdp>/p; do
  echo "== $p"; curl -sI -A "Mozilla/5.0 Chrome/139" "https://$HOST$p" | grep -i "set-cookie\|x-cache\|cache-control"
done   # no Set-Cookie without cookies; second run → x-cache: HIT
```

Also see **cacheable-matchers** (Fresh side) for the same rule.

## Loader cache wiring

- [ ] `cacheStorage` passed to `createDecoWorkerEntry` — without it the loader cache is memory-only per isolate (~0% hit rate, Monte Carlo/Zee.Dog). Tiered `caches.default` → KV, each op with a deadline.
- [ ] `cdnCacheControl` set explicitly. The default `"serverfn-segment"` let the CDN cache `/_serverFn` separately from the HTML; the product count changed after sorting (Monte Carlo). Check `X-Cache-Age` on a `/_serverFn` call.
- [ ] Custom fetch caches prefixed with the build hash (`__DECO_BUILD_HASH__`) — Granado served 24h-stale data after deploys.
- [ ] `export const cache = "stale-while-revalidate"` in a site loader only does single-flight, it does **not** store (Farm). Use `createCachedLoader`.
- [ ] Custom cache keys include the real pathname. Granado interpolated an object (`[object Object]`); a request for `/apple-touch-icon-precomposed.png` cached `page: null` and a PLP showed "not found" **with HTTP 200**. Check rendered content, not only status.
- [ ] Non-VTEX URL schemes registered: `detectCacheProfile` only knows `/p`; `/produto/*` fell back to `listing` (Zee.Dog) → `registerCachePattern({ test, profile: "product" })`.

## Cache key fragmentation

- [ ] Paid-media params stripped: `gclid`, `gad_source`, `gbraid`, `wbraid`, `_gl`, `_ga`, `fbclid`, `igshid`, `epik`, `awc`, `utm_*`, `idsku`… also in the `/_serverFn` payload path.
- [ ] Segment only on dimensions that matchers actually use (Zee.Dog split 27× by an unused `regionId`).

```bash
curl -sI "https://$HOST/<plp>?gad_source=1&_gl=x" >/dev/null
curl -sI "https://$HOST/<plp>?gad_source=2&_gl=y" | grep -i x-cache   # expect HIT
```

## Errors cached as "not found"

Upstream errors swallowed into `null` become a cached negative answer:

- Farm: `searchBySlug` `.catch(() => null)` → VTEX 5xx cached as a 404 PDP for 1h. Fix: retry uncached, throw (degraded, not cached) if the product exists.
- Farm: a cart catalog GET inherited the `listing` profile; `stockQuantity: 0` from an error was cached for everyone.
- Granado: incomplete `ResolveURL` treated as "doesn't exist" and cached 5 min. Fix: short TTL for null (10 s), longer for found.
- Monte Carlo: any `null` from a secondary resolve marked good PLPs `x-deco-degraded: true` + `no-store`.

```bash
grep -rnE "\.catch\(\(\) => (null|undefined|\[\])\)" src/loaders src/server src/sdk
```

## Cost and static assets

- KV writes only on miss or when the entry is older than N minutes (Farm: 6.3M writes in 16h, ~US$40/day).
- `public/` files ship with `max-age=0, must-revalidate` → hundreds of thousands of 304/day on sprites (Farm). Move them to hashed `/assets/` or add `public/_headers`.
- Custom `Cache-Control` on `/assets/*` is ignored by Workers Static Assets — don't rely on it.
