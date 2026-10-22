# Proxy, headers and checkout

The worker sits in front of everything: store pages, the proxied VTEX/Magento
checkout, `/api`, media, and — during the ramp — the legacy site. Headers the
framework adds by default and proxy behavior that differ from legacy show up as
conversion loss, not as errors. Always compare with legacy.

---

## Header diff against legacy

**Farm T-STORECOOP:** `@decocms/tanstack` `DEFAULT_SECURITY_HEADERS` sends
`Cross-Origin-Opener-Policy: same-origin-allow-popups` on all HTML; the
proxied checkout has none; Fresh never sent COOP. Every store → checkout
navigation switched browsing-context group: popups lost `window.opener`,
`window.name` was wiped, WebKit reset the timing clock.

```ts
// src/worker-entry.ts → securityHeaders
"Cross-Origin-Opener-Policy": "unsafe-none",
```

```bash
for host in "$LEGACY" "$CANDIDATE"; do
  for p in / /checkout/; do
    echo "== $host$p"
    curl -sI -A "Mozilla/5.0 Chrome/139" "$host$p" \
      | grep -iE "cross-origin|content-security|permissions-policy|x-frame|referrer-policy|strict-transport"
  done
done
```

Any header the new stack adds that legacy did not is a parity risk across
same-origin navigations to proxied pages.

## Checkout HTML 304 and bfcache

**Farm T-CHECKOUTBFCACHE → T-CKNOREVAL:**

1. `hardenProxyCacheHeaders` forces `private, no-store` on proxied HTML → checkout never restored from bfcache ("back" reloaded in 3–10 s, lost coupon/card, re-fired GTM steps).
2. Relaxing to `private, no-cache, max-age=0, must-revalidate` made the browser store the HTML **with VTEX's `Last-Modified`**; the next visit sent `If-Modified-Since`, the proxy passed it, VTEX answered 304 and the browser rendered a stale checkout with the previous `htmlTransform`. Anonymous conversion 23.8% vs 28.8%.

Fix: on GET `/checkout*` strip `If-Modified-Since` / `If-None-Match` before
proxying, and delete `Last-Modified` / `ETag` from the checkout HTML. Keep
`CDN-Cache-Control: no-store`.

```bash
curl -sD- -o /dev/null -A "Mozilla/5.0 Chrome/139" \
  -H "If-Modified-Since: Tue, 20 Oct 2026 00:00:00 GMT" "$CANDIDATE/checkout/" \
  | grep -iE "^HTTP|last-modified|etag|cache-control"
# expect 200, no Last-Modified, no ETag
```

🧪 bfcache: DevTools → Application → Back/forward cache on `/checkout` **on the
preview** — `vite dev` proxies bypass the worker. In the browser,
`performance.getEntriesByType('navigation')[0].transferSize` ≈ 300 bytes means a
304 was reused.

## Third-party checkout scripts

**Farm T-CKSHIM → T-CKSHIM2 → #354:** an inline shim fixed a JS error in the
client's custom checkout script (`FRMD_MINICART` undefined, stale `orderForm`).
Unblocking that chain made a broken `.finally` POST `marketingData` and **remove
the coupon**; the orderForm patch made a Pix guard swallow "place order".
Fresh never reached that code because the error stopped it first.

- Errors that also happen on legacy may be **load-bearing**. Parity beats correctness in checkout.
- Byte-compare the proxied checkout HTML legacy × new and list every injected inline script; each injection behind a reversible flag.
- Measure payment-method pick → transaction on both stacks before blaming the migration.
- Third parties that POST `attachments/marketingData` replace the whole object — GET + merge (UTMs and your tags must survive to the orderForm).
- Never `<link rel=prefetch>` third-party scripts that the target page loads with `crossorigin` — Chromium cache poisoning stopped checkout from mounting for ~2h (Farm T-CKPREWARM2).
- `/api/io/*` must go to the `secure` origin, not the admin cluster; store cart and checkout must share the same orderForm cookie.

```bash
strip() { sed -E 's/[0-9a-f]{8,}//g; s/[0-9]{10,}//g'; }
diff <(curl -s "$LEGACY/checkout/" | strip) <(curl -s "$CANDIDATE/checkout/" | strip) | head -50
```

## Bugs that only exist on the real host

Previews on `workers.dev` / deco domains miss them all.

| Symptom | Root cause |
|---|---|
| **Every PLP blank on the real domain**, rollback (Zee.Dog, Zee.Now) | `productionOrigins` in `createSiteSetup` (from `deco-migrate`) turns on `normalizeUrlsInObject`, rewriting every prop string starting with the production origin into a relative path, including URLs later passed to `new URL()` |
| SSR subrequests to `https://www.<domain>` went to legacy (Monte Carlo) | a worker fetch to its own public hostname does not re-enter the worker; it goes to the zone origin |
| tags/analytics missing on preview, behave differently on prod | host-gated GTM / OneDollarStats |

```bash
grep -rn "productionOrigins" src/ vite.config.ts
grep -rn "https://www\.<domain>" src/server src/loaders src/sdk     # server-side self-fetch
npx vite preview --host --allowedHosts www.<domain> &
curl -s -H "Host: www.<domain>" http://localhost:4173/<plp> | grep -c "<product-card-marker>"
```

Ask for every `src/` hit of the domain: "what changes when the host **is** this?"

## Self-redirect loop on encoded paths

**Farm T-BRACELOOP:** `@tanstack/router-core` compares `publicHref` with
`buildLocation` server-side and redirects on mismatch; braces are not
re-encoded, so `/{x}` → 307 `/{x}` → browser re-encodes → loop
(`ERR_TOO_MANY_REDIRECTS`, ~17k 307/day from the VTEX ID login modal's
`<img src="{{qRCodeUrl}}">`). Fix: return a cached 404 for paths containing
`{`, `}`, `%7B`, `%7D` before the router.

It is not only braces: while writing this skill, `farmrio.com.br/%5Ex` (`^`)
still looped (30 × 307 to `/^x`). Fuzz every character the router may decode
and not re-encode.

```bash
for p in '/%7Bx%7D' '/x%7B' '/foo-%7Bx%7D-1/p' '/%5Bx%5D' '/%7Cx' '/%5Ex' '/a%20b'; do
  curl -s -o /dev/null -L --max-redirs 10 -A "Mozilla/5.0 Chrome/139" \
    -w "$p %{http_code} hops=%{num_redirects}\n" "$CANDIDATE$p"
done   # hops ≥ 5 (or curl error 47) = loop
```

## A/B proxy and legacy fallback

During the ramp the worker draws a bucket and proxies the rest to legacy.

- `shouldBypassAB` is **inverted** from what it reads like: `true` = serve from this worker, `false` = enter the draw. Return `true` for routes that only exist on TanStack (login/logout, headless account routes, sitemap, platform proxies).
- Users rebucketed while a legacy page is open send the **Fresh protocol** to the worker: `POST /live/invoke`, `?__pickRuntime=` → 500 (Monte Carlo 0.675% 5xx). Route those to `proxyToFallback` outside the draw.
- Legacy responses pass `cache-control: public` through; the zone CDN keys on URL only while legacy varies by UA → wrong device HTML. Add `CDN-Cache-Control: no-store` on fallback responses (`x-deco-bucket: fallback`).
- Existing proxies of the site (checkout, `/api`, `/_v`, media) must work in **both** buckets — A/B routing broke them on Casa e Vídeo.
- At ratio 0 the public host must still be indexable — see [seo-analytics.md](seo-analytics.md#indexability-and-status-codes).

Force each side with the bucket cookie your A/B wrapper uses (Farm:
`_deco_bucket=worker:0`; read `withABTesting` in `src/worker-entry.ts` for the
legacy value).

```bash
for b in "worker:0" "<legacy-bucket-value>"; do
  for p in / /checkout/ /api/catalog_system/pub/portal/sessions /robots.txt; do
    curl -s -o /dev/null -b "_deco_bucket=$b" -w "$b $p %{http_code}\n" "https://$HOST$p"
  done
done
```
