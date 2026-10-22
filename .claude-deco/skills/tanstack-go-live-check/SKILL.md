---
name: tanstack-go-live-check
description: "Double-check a Fresh/Deno → TanStack Start (@decocms/*, Cloudflare Workers) migration before go-live, on cutover day, and during the first 72h, so the incidents already hit on Farm, Granado, Phebo, Monte Carlo, Zee.Dog and Zee.Now do not repeat. Use when asked to review a TanStack migration before launch, run a go-live checklist, prepare the cutover / A/B proxy at 0%, audit a worker for memory, KV, cache, Set-Cookie, redirects, checkout proxy, hydration or analytics problems, or investigate a regression right after a TanStack go-live. Covers process (code freeze, reconcile, content sync, CMS pass, traffic ladder, rollback), worker runtime (128 MB, content deploy, KV per site, deadlines), cache correctness, proxied checkout headers, React/SPA pitfalls from Preact ports, SEO and analytics parity, plus a read-only preflight script. Not a migration guide — it assumes the site already builds and renders."
---

# TanStack go-live check

Every item below cost a real incident on a store that already went live. The
skill is a **double check**: walk it on the candidate (and on the real host)
before the first byte of production traffic, again on cutover day, and once
more 24–72h later.

Severity:

- 🔴 **Blocks go-live** — data leak, site down, checkout or revenue loss.
- 🟡 **Fix before ramping above 0%** — cache, SEO, analytics, perf.
- 🟢 **Watch after go-live** — monitor, compare with legacy.

Each line links to the reference that has the symptom, root cause, fix and the
exact command to check it. Record PASS / FAIL / N/A for every line in the PR or
go-live ticket; "didn't check" is not N/A.

---

## Quick start

```bash
# read-only: greps the repo + curls the candidate (and legacy, if given)
bash .claude-deco/skills/tanstack-go-live-check/scripts/preflight.sh \
  <path-to-site-repo> https://<candidate-host> https://<legacy-or-prod-host>
```

The script only catches what is greppable or curl-able. Items marked 🧪 need a
browser (Playwright / DevTools) and a human looking at the result.

---

## 1. Process — weeks before (→ [process.md](references/process.md))

- [ ] 🔴 **Code freeze on the legacy repo** with a date and a recorded `FREEZE_SHA`; final reconcile of every legacy commit since the migration cut (`tools-reconcile-snapshot`). [freeze](references/process.md#code-freeze-and-reconcile)
- [ ] 🔴 **Content sync timing** known (it runs on a schedule, not on publish); last sync runs *after* the content team's last edit and before cutover; the sync bot token is valid. [sync](references/process.md#content-sync)
- [ ] 🔴 **Section schemas identical to production** — the content JSON stays the same, components keep the same props interface. Five-criteria parity: HTML isomorphism, schema, wiring, behavior, visual. [parity](references/process.md#structural-parity-five-criteria)
- [ ] 🟡 **CMS pass with the content team** (1h) before go-live: props editable, loaders they use still work. [cms](references/process.md#cms-pass)
- [ ] 🟡 **Inventory** of integrations disabled in the port and of the client's running A/B tests (VWO, search vendors) whose variant code was never ported. [inventory](references/process.md#inventory-of-what-was-not-ported)
- [ ] 🟡 **Content deploy turned on *and tested*** on the candidate days before, never on cutover day. [content deploy](references/worker-runtime.md#content-deploy-is-three-pieces)

## 2. Worker runtime (→ [worker-runtime.md](references/worker-runtime.md))

- [ ] 🔴 Content deploy is **all three pieces or none** + KV seeded for the deploy SHA. [3 pieces](references/worker-runtime.md#content-deploy-is-three-pieces)
- [ ] 🔴 **No decofile read at module scope** (setup of Algolia/Magento/VTEX, proxies, `Site` alias) — re-init in `onChange`. [onChange](references/worker-runtime.md#module-scope-reads-of-the-decofile)
- [ ] 🔴 **`DECO_KV` namespace unique per site** (cloned repos!). [kv per site](references/worker-runtime.md#deco_kv-is-per-site)
- [ ] 🔴 **No per-user state at module scope** (`new QueryClient()` outside `getRouter`, module `Map`s with user data). [module state](references/worker-runtime.md#module-scope-state-leaks-between-users)
- [ ] 🔴 **Memory < 128 MB** with margin: decofile, redirects CSV and `meta.gen.json` out of the bundle; large responses streamed. [memory](references/worker-runtime.md#memory-128-mb-per-isolate)
- [ ] 🔴 **Redirects in KV**, uploaded with `--remote` before deploy, lookup with `cacheTtl` and `.catch`. [redirects](references/worker-runtime.md#redirects-go-to-kv)
- [ ] 🟡 **Every await on KV / cache / upstream has a deadline**; compat flag `handle_cross_request_promise_resolution` reviewed. [deadlines](references/worker-runtime.md#deadlines-on-every-await)
- [ ] 🟡 Observability on (`observability.enabled`, OTEL tail) — you cannot see `exceededMemory` / `canceled` otherwise. [observability](references/worker-runtime.md#observability)
- [ ] 🟢 Memory P50/P99 compared **after every `@decocms/*` bump**; site loaders called via `/deco/invoke` re-tested. [bumps](references/worker-runtime.md#framework-bumps)
- [ ] 🟢 Portable runtime: KV/cache behind interfaces, no client access to Cloudflare CI. [portability](references/worker-runtime.md#portability-and-ci)

## 3. Cache (→ [cache.md](references/cache.md))

- [ ] 🔴 **Logged-in users never get anonymous cached HTML**; no section cache on loaders that read cookies. [segment](references/cache.md#segment-and-user-data)
- [ ] 🟡 **Anonymous `/`, PLP, PDP return no `Set-Cookie`** and `x-cache: HIT` on the 2nd request. [set-cookie](references/cache.md#set-cookie-kills-the-html-cache)
- [ ] 🟡 `cacheStorage` passed to `createDecoWorkerEntry`; `cdnCacheControl` explicit; caches versioned by build. [loader cache](references/cache.md#loader-cache-wiring)
- [ ] 🟡 Paid-media params stripped from the cache key; segment only on what matchers use. [cache key](references/cache.md#cache-key-fragmentation)
- [ ] 🟡 No swallowed upstream error cached as "not found" / "out of stock". [negative cache](references/cache.md#errors-cached-as-not-found)
- [ ] 🟢 KV writes only on miss; `public/` assets with cache headers. [cost](references/cache.md#cost-and-static-assets)

## 4. Proxy, headers, checkout (→ [proxy-headers-checkout.md](references/proxy-headers-checkout.md))

- [ ] 🔴 **Header diff legacy × new** on store pages and proxied checkout (COOP, COEP, CSP…). [headers](references/proxy-headers-checkout.md#header-diff-against-legacy)
- [ ] 🔴 **Proxied checkout never answers 304** from a stored copy; bfcache tested on the preview. [checkout 304](references/proxy-headers-checkout.md#checkout-html-304-and-bfcache)
- [ ] 🔴 Third-party checkout scripts **byte-compared** with legacy; no "fixes" to errors legacy also has. [checkout scripts](references/proxy-headers-checkout.md#third-party-checkout-scripts)
- [ ] 🔴 **Real-host-only bugs**: `productionOrigins`, self-fetch to own host, host-gated tags — test with the production `Host`. [real host](references/proxy-headers-checkout.md#bugs-that-only-exist-on-the-real-host)
- [ ] 🟡 No self-redirect loops on encoded paths (`{`, `}`, `|`…). [brace loop](references/proxy-headers-checkout.md#self-redirect-loop-on-encoded-paths)
- [ ] 🟡 A/B proxy: legacy-protocol requests and legacy-only routes bypass the draw; fallback responses `CDN-Cache-Control: no-store`. [A/B proxy](references/proxy-headers-checkout.md#ab-proxy-and-legacy-fallback)

## 5. React / SPA (→ [react-spa.md](references/react-spa.md))

- [ ] 🔴 🧪 **Cart mutation then immediate navigation** (to `/checkout`) keeps the change. [cart](references/react-spa.md#server-functions-cancelled-on-navigation)
- [ ] 🔴 Preact/Fresh leftovers grep is clean (`window.STOREFRONT`, `hx-*`, `value=` without `onChange`…). [leftovers](references/react-spa.md#preact-and-fresh-leftovers)
- [ ] 🟡 🧪 Every inline-script component works when reached by **SPA click**, not only F5. [inline scripts](references/react-spa.md#inline-scripts-do-not-run-on-spa-navigation)
- [ ] 🟡 🧪 PDP → PDP by SPA: gallery remounts (`key`), no React #310; `rules-of-hooks` on. [pdp→pdp](references/react-spa.md#same-route-navigation-reuses-components)
- [ ] 🟡 🧪 Zero React #418 on mobile with GTM on; CMS HTML balanced. [hydration](references/react-spa.md#hydration-418)
- [ ] 🟡 Stale-chunk reload guard after deploys; preload policy measured. [chunks](references/react-spa.md#stale-chunks-after-deploy)
- [ ] 🟡 🧪 Browser heap flat after opening the minicart 10×. [heap](references/react-spa.md#browser-memory-leaks)
- [ ] 🟢 Legacy service worker killed with a self-unregistering `sw.js`. [sw](references/react-spa.md#legacy-service-worker)

## 6. SEO, analytics, search (→ [seo-analytics.md](references/seo-analytics.md))

- [ ] 🔴 **GTM loads from `<head>` without a gesture gate**, same timing as legacy; cookies at checkout entry match legacy. [gtm](references/seo-analytics.md#tag-manager-timing)
- [ ] 🔴 At 0% / on the real host: **no `noindex`, no `Disallow: /`**; real 404 status codes. [indexing](references/seo-analytics.md#indexability-and-status-codes)
- [ ] 🟡 Every analytics vendor mounted (GTM, OneDollarStats…) and receiving events the day after. [vendors](references/seo-analytics.md#vendors-that-stop-silently)
- [ ] 🟡 Redirect CSV semantics checked + **100% sweep** against legacy. [redirect sweep](references/seo-analytics.md#redirect-sweep)
- [ ] 🟡 Sitemaps served by real routes, streamed. [sitemap](references/seo-analytics.md#sitemaps)
- [ ] 🟡 Search: facet change resets `page`, autocomplete uses the typed term, IS `count` ≤ 50. [search](references/seo-analytics.md#search-and-listing-behavior)

## 7. Cutover day and after (→ [process.md](references/process.md#cutover-day))

- [ ] 🔴 Deploy freeze during the window (each deploy changes the build hash and empties caches).
- [ ] 🔴 Proxy at **0%**: KV key first, then route; smoke with the bucket forced to each side.
- [ ] 🟡 Cache warmed by **fetching pages** with mobile and desktop UAs, not only loaders.
- [ ] 🟡 Traffic ladder with explicit gates; rollback path written and rehearsed.
- [ ] 🟢 Compare metrics with the **same hour yesterday**; keep removed telemetry endpoints alive ≥ HTML TTL; keep porting legacy drift.

---

## Where the lessons came from

| Store | Main incidents |
|---|---|
| farmrio-tanstack | checkout 304 (T-CKNOREVAL), COOP (T-STORECOOP), brace loop (T-BRACELOOP), PDP→PDP (T-PDPGALKEY), #418 tail (T-HYD418B), SPA inline scripts (T-ETCFOLDSPA), Preact leftovers (T-UIBROKEN), GTM gate (T-TAGPATH), cart cancelled (T-ATCSHEET), checkout shims (T-CKSHIM) |
| granadobr-tanstack | OOM from duplicated decofile, Algolia/proxies dead with content deploy, redirects → KV, KV stall 524, minicart 1–2 GB leak, PLP cache key `[object Object]` |
| phebo-tanstack | shared `DECO_KV` overwrote Granado's live content; leftover source-site identifiers |
| montecarlo-tanstack | cross-request promises, in-flight stalls, legacy protocol during ramp, `/_serverFn` CDN cache, `count:100` OOM, legacy sync overwrote blocks |
| zeedog-tanstack | `productionOrigins` blanked PLPs on the real domain (rollback), `cart` prop Set-Cookie, anonymous HTML to logged-in users, analytics not mounted |
| zeenow-tanstack | module-scope `QueryClient` leaked personal data, `safeCookies`, OneDollarStats `defer` blocking load, service worker |

## Related

- **cache**, **cacheable-matchers** — Fresh-side cache layers and `Set-Cookie` rules.
- **hardcoded-to-blocks**, **cms-friendly-props** — Studio wiring and editable props.
- **ecommerce-qa** — end-to-end flows and preview bot allowlist.
- parity: **tools-reconcile-snapshot** (source drift), `parity cache probe` (cache gaps), `/parity:sweep` (QA sweep), **known-issues** (framework issue tables).
