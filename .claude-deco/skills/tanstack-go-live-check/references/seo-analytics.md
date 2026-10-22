# SEO, analytics and search parity

Analytics and SEO break **silently** at cutover — no error, no 5xx, just a
lower number in a dashboard days later. Compare with legacy, not with
expectations.

---

## Tag manager timing

**Farm T-TAGPATH → T-TAGPATH-EAGER:** a perf optimization loaded the store GTM
only on the first user gesture. Customers reached checkout without the cookies
GTM-loaded tags set (A/B tool, consent, affiliates, ~15 DSPs). Orders per
visitor 0.41% vs 0.51% on Fresh — **~20% of orders**. Even ungated, the
`<body>` snippet sat at 68% of the HTML and started at 2.2–2.7 s.

- GTM loads from `<head>`, like legacy, with no gesture/idle gate. Accept the Lighthouse TBT cost unless a conversion A/B test says otherwise.
- Don't load the same `src` twice (eager + component).
- SPA: `page_view` and `data-*` event scanners must re-run on client navigation (MutationObserver + router `onRendered`).
- Tracker payloads in the legacy format (Farm: `add_to_cart` silently dropped, 1/587 vs 635/679 buyers).

```bash
grep -rnE "requestIdleCallback|first.?interaction|pointerdown|onFirstGesture" src | grep -i -E "gtm|tag|analytics"
curl -s "$CANDIDATE/" | grep -o "googletagmanager.com/gtm.js[^\"']*" | head -1
```

🧪 Playwright, no gesture: `gtm.js` requested within ~500 ms of TTFB, same as
legacy. After the same journey on both stacks, compare `document.cookie` names
at checkout entry.

## Vendors that stop silently

| Vendor | What happened | Fix |
|---|---|---|
| GTM | `website/sections/Analytics/Analytics.tsx` is in `SKIP_RESOLVE_TYPES`; never rendered (Zee.Dog) / bootstrap commented out by the migration (Zee.Now, Granado) | render in `__root.tsx`; `<noscript>` after `<body>` |
| OneDollarStats | Fresh mounted it automatically; TanStack needs `<OneDollarStats/>` — zero events and A/B results lost (Zee.Dog) | mount in `__root.tsx` |
| OneDollarStats down | `defer` script blocked DOMContentLoaded ~211 s (Zee.Now) | `@decocms/apps-website` ≥ 7.65.2 (`async`) |
| UTMs | not carried into `orderForm.marketingData` | GET + merge before POST |

```bash
curl -s "$CANDIDATE/" | grep -cE "googletagmanager|lilstts"
```

The day after go-live, check each vendor's own reporting against the same day
last week.

## Indexability and status codes

- **At ratio 0 the public host served `noindex` and `Disallow: /`** because legacy decides indexability from its own host (Miess edge split). Requires `deco-cx/apps` ≥ 0.165.0 + `x-forwarded-host`. Check **before** creating the route.
- Soft 404s: catch-all routes returning 200; `setResponseStatus` not reaching the final Response (Zee.Dog). Force status through the worker.
- A section rendering "not found" with HTTP 200 from a poisoned cache (see [cache.md](cache.md#loader-cache-wiring)).
- PLP pagination `rel=next/prev` / canonical lost in the port — see **canonical**, **seo-sections**.

```bash
curl -s -A Googlebot "https://$HOST/robots.txt" | head
curl -s -A Googlebot "https://$HOST/" | grep -io '<meta[^>]*robots[^>]*>'
for p in /categoria-que-nao-existe /produto-inexistente/p /blog; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "$CANDIDATE$p"; done   # compare with legacy
```

## Redirect sweep

The CSV semantics changed between Fresh (URLPattern) and TanStack
(`normalizePath`):

- Rows with an **absolute** `from` (`https://…`) were dead on Fresh and **come alive** → live PLPs redirected to home (Monte Carlo). Drop them.
- `from === to` → self loops (Zee.Dog had 3).
- `from` with a query string → unreachable rows.
- Visitor query string dropped (`gclid` lost) — append `url.search`.
- Case sensitivity of keys.

```bash
awk -F, 'NR>1 && $1 ~ /^https?:\/\//' redirects.csv | head      # absolute from
awk -F, 'NR>1 && $1 == $2' redirects.csv | head                  # loops
awk -F, 'NR>1 && $1 ~ /\?/' redirects.csv | head                 # query in from
```

Then sweep **100%** of entries against legacy production (status + final
Location), not a sample.

```bash
tail -n +2 redirects.csv | cut -d, -f1 | while read -r from; do
  a=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$LEGACY$from")
  b=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$CANDIDATE$from")
  [ "${a/$LEGACY/}" = "${b/$CANDIDATE/}" ] || echo "DIFF $from | $a | $b"
done
```

## Sitemaps

- Legacy `site.json` `routes[].handler` (e.g. `website/handlers/sitemap.ts`) have **no resolver** in `@decocms`; a static `public/sitemap*.xml` masked it (Zee.Now). Add a real splat route.
- Stream sitemap responses — `.text()` on the XML OOMed the worker (Granado, Zee.Dog).

```bash
grep -n '"handler"' .deco/blocks/site.json 2>/dev/null
curl -s "$CANDIDATE/sitemap.xml" | grep -o "<loc>[^<]*" | sed 's/<loc>//' | while read -r u; do
  curl -s -o /dev/null -w "%{http_code} $u\n" "$u"; done
```

## Search and listing behavior

From Farm (#371, #356, T-SHELFIDS, T-PLPCOUNT):

- Facet change must **delete `page`** and keep `q`, `sort` and other params (filtering from page 2 returned 0 results).
- Auto-correct / "did you mean" only on a confirmed zero total of an unfiltered, first-page text search — never rewrite filtered URLs.
- Autocomplete must query the **typed term**, falling back to the top suggestion only if empty.
- Intelligent Search returns 400 above `count=50` — batch SKU lists in groups of 50; `.filter(Boolean)` after `sortProducts` (one missing SKU broke the whole wishlist).
- `pageInfo.records` counts out-of-stock items while the grid filters in-stock.
- Empty CMS rules render empty boxes — guard empty text in code.

```bash
grep -rnE "count:\s*ids\.length|count = .*\.length" src/loaders src/setup* 2>/dev/null
```
