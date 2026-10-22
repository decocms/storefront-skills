# Worker runtime — memory, content deploy, KV, deadlines

A Fresh site ran in a long-lived Deno process with plenty of memory. A Worker
isolate has **128 MB**, is shared by many requests, and can be killed or
recycled at any time. Anything that was "fine in memory" on Deno is a risk.

---

## Memory: 128 MB per isolate

| Symptom | Root cause | Fix |
|---|---|---|
| 524 / `exceededMemory` at go-live (Granado, ~147 MB resident) | `blocks.gen.json` (~9.6 MB JSON, far more parsed) bundled **and** a second copy loaded from KV | Content deploy with all three pieces (below); the bundle gets an empty stub |
| Redirect CSV in memory (Granado ~18k rows; up to 40 MB reported on multi-brand sites) | `redirectsFromCsv` blocks bundled in the decofile | [Redirects go to KV](#redirects-go-to-kv) |
| +27 MB after a framework bump (Monte Carlo) | indented `meta.gen.json` embedded twice | `decoVitePlugin({ metaAsset: true })` + `assets.binding: "ASSETS"` |
| OOM on one landing (Monte Carlo) | a CMS block asked VTEX for `count: 100` → 11 MB response, ~90 MB objects | cap `count` in code (≤ 48) and include the cap in the cache key |
| OOM on sitemap (Granado, Zee.Dog) | `await upstream.text()` + `replaceAll` on the whole XML | stream: `new Response(upstream.body)` or a `TransformStream` |

Rule: **everything big goes to KV or R2**, nothing big lives at module scope,
large proxied bodies are streamed. "It's only KB" is usually wrong — measure.

```bash
ls -la dist/server/assets/worker-entry-*.js           # decofile must not be inside (Zee.Now: 3.4 MB → 321 KB)
grep -rn "\.text()" src/routes src/server src/**/sitemap* 2>/dev/null
grep -rhoE '"count":\s*[0-9]+' .deco/blocks | sort | uniq -c | sort -rn | head
```

As a go-live gate: memory under ~80% of the limit during a load test on the
candidate. Raising `limits.memory_mb` to 256 is a stopgap, not a fix.

## Content deploy is three pieces

Content deploy (formerly fast deploy) serves the decofile from KV instead of
the bundle. It needs **all** of:

1. `DECO_FAST_DEPLOY=1` var,
2. `DECO_KV` binding in `wrangler.jsonc`,
3. `decoVitePlugin({ fastDeploy: true })` (`@decocms/*` ≥ 7.64.2 — in 7.20.x it is a silent no-op),

plus the production build **seeding** `decofile:<sha>` in KV.

| Combination | Result |
|---|---|
| 2 of 3 | decofile in bundle **and** in KV → memory doubles (Granado +28.5 MB) |
| stub without KV seed | site down (Monte Carlo #385; rollback `DECO_FAST_DEPLOY=0`) |
| nested `@decocms` copy (submodule) | two `requestContext` instances, content never arrives (Zee.Now) |

```bash
npx wrangler kv key list --remote --binding DECO_KV --prefix decofile: | head
bun pm ls 2>/dev/null | grep @decocms     # one copy of each package
```

Turn it on **days before** go-live and re-test everything that reads content.

## Module-scope reads of the decofile

With content deploy, the bundled `blocks.gen` is `{}` and the real decofile
arrives later from KV. Code that read it once at module top level keeps an
empty config for the isolate's whole life:

- Granado: Algolia setup → search dead (`[Algolia] No deco-algolia block found`); Magento proxies → `/media`, `/static`, social login and checkout 302s dead.
- Phebo: the KV snapshot had `site` but not `Site` → `og:image` and `titleTemplate` gone on cold start.
- Farm: VTEX config missing on `/deco/invoke` and server functions when they were the first request of an isolate.

Fix: initialize in `onChange` from `@decocms/blocks/cms`, use the listener's
`blocks`, and skip re-init when the relevant blocks did not change.

```ts
onChange((blocks) => initProxiesFromBlocks(blocks));   // fires on KV hydration and on each publish
initProxiesFromBlocks(loadBlocks());                    // boot path without content deploy
// inside: const sig = JSON.stringify(blocks["Proxies"] ?? null); if (sig === lastSig) return;
```

```bash
grep -rnE "loadBlocks\(\)|from ['\"].*blocks\.gen" src/setup.ts src/worker-entry.ts src/server 2>/dev/null
```

Check: cold start (first request after deploy) of search, every proxied path,
and `og:image` / `<title>`.

## `DECO_KV` is per site

Content-deploy keys (`decofile:<sha>`, `index:live`, `index:deployments`) are
**not prefixed by site**. Phebo was cloned from Granado with the same `DECO_KV`
id; publishing in Phebo's CMS **replaced Granado's live content**. Only
`SITES_KV` (A/B routing, keyed by hostname) is meant to be shared.

- [ ] `DECO_KV` id in `wrangler.jsonc` is unique across all sites.
- [ ] No leftover identifiers from the source repo after a clone: cache prefix (`<site>:cache:v1:`), Analytics Engine dataset, `DECO_SITE_NAME`, worker `name`.
- [ ] Never rename the wrangler `name` of a live worker — you get a new worker without the production route.

```bash
grep -rni "<source-site-name>" wrangler.jsonc vite.config.ts src/worker-entry.ts
```

## Redirects go to KV

Load redirects per request from KV (`redir:<normalized-path>`), keep only a
small CMS list in memory.

```ts
const entry = await env.DECO_KV
  .get(`redir:${normalize(url.pathname)}`, { cacheTtl: 86400 })
  .catch(() => null);                      // KV outage must not become a 500
// value "301:/dest" → validate status is 301|302 and dest is non-empty; append url.search
```

Pitfalls found on the first version (Granado):

- `wrangler kv bulk put` writes **local** by default in wrangler 4 → production KV empty. Always `--remote`.
- Upload in the deploy script, before deploy: `"deploy": "bun scripts/upload-redirects-to-kv.ts && wrangler deploy"`.
- Same `normalizePath` in the upload script and in the lookup (lowercase, trailing slash).
- Keep CSV order semantics (last one wins) — reordering changed 88 destinations.
- Log a warning if the binding is missing instead of silently serving no redirects.

Semantics and the 100% sweep are in [seo-analytics.md](seo-analytics.md#redirect-sweep).

## Module-scope state leaks between users

An isolate serves many users concurrently. Zee.Now leaked **personal data**
because `new QueryClient()` was at module scope in `src/router.tsx`.

```bash
grep -rn "new QueryClient" src/          # must be inside getRouter()
grep -rnE "^(const|let) [a-zA-Z]+ = new (Map|Set)\(" src/ | grep -v test
```

Every module-level `Map`/cache must hold only data that is identical for every
user. Test with two different session cookies against the same warm isolate.

## Deadlines on every await

Symptom: 524 after 100 s with ~1 ms CPU (`outcome=canceled, wallTime≈100000`).

| Cause | Fix |
|---|---|
| `DECO_KV.get()` in the response cache stalled (Granado) | race every KV / `caches.default` op against ~1.5 s; timeout = miss |
| module single-flight maps: owner request disconnected, waiters hang (Monte Carlo, Farm) | `@decocms/*` with decocms/blocks#714 and #716 (≥ 7.80.1); owner work in `ctx.waitUntil` |
| request B awaits a promise created in request A (Monte Carlo) | `compatibility_flags: ["handle_cross_request_promise_resolution"]` when `compatibility_date` predates the default |
| upstream fetch without signal | `AbortSignal.timeout(20s)` data / `60s` proxied checkout; per-request deadline → 503 + `Retry-After` |
| `waitUntil` revalidation loses env → 401 (Monte Carlo) | snapshot `env` on the first in-request call |

```bash
grep -n "compatibility_date\|compatibility_flags\|cross_request" wrangler.jsonc
grep -n "cacheStorage" src/worker-entry.ts
```

## Observability

Without it you cannot see `exceededMemory`, `canceled` or the 524 pattern.

- [ ] top-level `"observability": { "enabled": true }` in `wrangler.jsonc`,
- [ ] OTEL tail consumer + `DECO_OTEL_*` vars and `DECO_OTEL_AUTH_TOKEN` secret (with the `Bearer ` prefix) — otherwise telemetry is a silent no-op,
- [ ] `"cache": { "enabled": true }` in `wrangler.jsonc` — the dashboard toggle resets on every deploy.

## Framework bumps

- Compare memory P50/P99 per version after **every** `@decocms/*` bump (7.79.x added +27 MB).
- 7.81.x: loaders called through `/deco/invoke` now receive `(props, req, ctx)` — call every site loader that reads its 3rd argument before and after (Farm `has3D` 500 → 200, `user.ts` changed error).
- Bump in lockstep; check `bun pm ls` for a single copy.

## Portability and CI

- Keep KV/cache/storage behind the framework interfaces, not raw bindings in site code — the site should be able to run in a container elsewhere if a Cloudflare limit is hit.
- Do not give the client access to Cloudflare CI/dashboard for the worker: a commit can bind another store's KV. Builds run through deco's CI.
- Content-only commits may not trigger Workers Builds; know how content reaches production.
