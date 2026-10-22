#!/usr/bin/env bash
# Read-only preflight for a TanStack (@decocms/*) go-live.
# Usage: preflight.sh <site-repo-dir> [candidate-url] [legacy-url]
#   site-repo-dir  path to the TanStack site repo (static checks)
#   candidate-url  https://host serving the TanStack worker (HTTP checks)
#   legacy-url     https://host serving the legacy site (diff checks)
# Prints PASS / WARN / FAIL per check. Never writes anything.
# Checks needing a browser (SPA, hydration, heap, cart) are listed in SKILL.md (🧪).

set -u
REPO="${1:?usage: preflight.sh <site-repo-dir> [candidate-url] [legacy-url]}"
CAND="${2:-}"
LEGACY="${3:-}"
CAND="${CAND%/}"
LEGACY="${LEGACY%/}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36"

fails=0; warns=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$1"; warns=$((warns + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails + 1)); }
show() { sed 's/^/         /' | head -n "${1:-5}"; }
section() { printf '\n== %s\n' "$1"; }

# grep the repo source, excluding generated and vendored files
g() { grep -rnE "$@" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.deco --exclude-dir=.git \
  --exclude='*.gen.ts' --exclude='*.test.*' --exclude='*.spec.*' "$REPO/src" 2>/dev/null \
  | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*)'; }   # drop comment lines

[ -d "$REPO/src" ] || { echo "no src/ in $REPO"; exit 2; }
WRANGLER=""
for f in wrangler.jsonc wrangler.json wrangler.toml; do [ -f "$REPO/$f" ] && WRANGLER="$REPO/$f" && break; done

section "Worker runtime (references/worker-runtime.md)"

hits=$(g 'new QueryClient\(')
if [ -z "$hits" ]; then pass "no QueryClient found"
elif [ -f "$REPO/src/router.tsx" ] && awk '/getRouter/{f=1} f&&/new QueryClient\(/{found=1} END{exit !found}' "$REPO/src/router.tsx"; then
  pass "new QueryClient() appears inside getRouter (confirm it is not at module scope)"
else fail "new QueryClient() possibly at module scope — leaks data between users"; echo "$hits" | show; fi

hits=$(grep -nE 'loadBlocks\(\)|from .*blocks\.gen' "$REPO/src/setup.ts" "$REPO/src/worker-entry.ts" 2>/dev/null)
if [ -z "$hits" ]; then pass "no module-level decofile reads in setup.ts / worker-entry.ts"
else warn "decofile read in setup/worker-entry — with content deploy it must be re-run in onChange()"; echo "$hits" | show; fi

if [ -n "$WRANGLER" ]; then
  if grep -q 'DECO_KV' "$WRANGLER"; then
    id=$(grep -A3 '"DECO_KV"' "$WRANGLER" | grep -oE '"id"\s*:\s*"[^"]+"' | head -1)
    pass "DECO_KV bound ($id) — confirm this id is unique to this site"
  else warn "no DECO_KV binding in $(basename "$WRANGLER") — content deploy / KV redirects / KV cache impossible"; fi

  if grep -q 'no_handle_cross_request_promise_resolution' "$WRANGLER"; then
    warn "compat flag no_handle_cross_request_promise_resolution set — review against compatibility_date (Monte Carlo 100s stalls)"
  else pass "no opt-out of cross-request promise resolution"; fi

  if grep -qE '"observability"' "$WRANGLER" && grep -A2 '"observability"' "$WRANGLER" | grep -q 'true'; then
    pass "observability enabled"
  else warn "observability not enabled — exceededMemory / canceled invisible"; fi

  mem=$(grep -oE '"memory_mb"\s*:\s*[0-9]+' "$WRANGLER")
  [ -n "$mem" ] && warn "custom memory limit ($mem) — stopgap; find what fills memory"
else
  warn "no wrangler config found"
fi

if grep -q 'cacheStorage' "$REPO/src/worker-entry.ts" 2>/dev/null; then pass "cacheStorage passed to worker entry (check it has a deadline)"
else warn "no cacheStorage in src/worker-entry.ts — loader cache is per-isolate memory only"; fi

hits=$(g '\.text\(\)' | grep -iE 'sitemap|proxy|upstream')
if [ -z "$hits" ]; then pass "no .text() buffering in sitemap/proxy code"
else warn "large responses buffered with .text() — stream them"; echo "$hits" | show; fi

if [ -d "$REPO/dist/server" ]; then
  size=$(find "$REPO/dist/server" -name 'worker-entry-*.js' -exec du -k {} + 2>/dev/null | sort -rn | head -1 | cut -f1)
  [ -n "$size" ] && { [ "$size" -gt 3000 ] && warn "worker-entry bundle ${size}KB — decofile/redirects/meta probably bundled" || pass "worker-entry bundle ${size}KB"; }
fi

section "Cache (references/cache.md)"

hits=$(g 'export const cache\s*=' | grep '/sections/')
if [ -z "$hits" ]; then pass "no section-level caches"
else warn "section caches — make sure none of their loaders read cookies/user"; echo "$hits" | show 10; fi

hits=$(g '\.catch\(\(\)\s*=>\s*(null|undefined|\[\])\)' | grep -E '/(loaders|server|sdk)/')
if [ -z "$hits" ]; then pass "no swallowed errors to null in loaders"
else warn "errors swallowed to null — may be cached as not-found/out-of-stock"; echo "$hits" | show; fi

section "Real host / proxy (references/proxy-headers-checkout.md)"

hits=$(g 'productionOrigins\s*:')
if [ -z "$hits" ]; then pass "no productionOrigins"
else warn "productionOrigins set — prop URLs become relative ONLY on the real domain (Zee.Dog/Zee.Now blank PLPs); test with the production Host"; echo "$hits" | show; fi

section "React / Fresh leftovers (references/react-spa.md)"

hits=$(g 'window\.STOREFRONT|window\.addToCart|hx-(post|get|on|trigger)')
if [ -z "$hits" ]; then pass "no Fresh global SDK / htmx leftovers"
else fail "Fresh/htmx leftovers"; echo "$hits" | show 10; fi

hits=$(g 'on[A-Z][a-zA-Z]+=\{useScript')
if [ -z "$hits" ]; then pass "no on*={useScript(...)} handlers"
else fail "event handler receives a string from useScript"; echo "$hits" | show; fi

hits=$(g 'dangerouslySetInnerHTML' | grep -v balanceHtml | wc -l | tr -d ' ')
[ "$hits" = "0" ] && pass "every dangerouslySetInnerHTML balanced" || warn "$hits dangerouslySetInnerHTML without balanceHtml — check CMS/VTEX HTML sources (#418)"

hits=$(g 'useScript\(|useScriptAsDataURI\(' | cut -d: -f1 | sort -u | wc -l | tr -d ' ')
[ "$hits" = "0" ] || warn "$hits files with useScript/useScriptAsDataURI — test each by SPA click, not F5"

if ls "$REPO"/eslint.config.* "$REPO"/.eslintrc* >/dev/null 2>&1 && grep -q 'rules-of-hooks' "$REPO"/eslint.config.* "$REPO"/.eslintrc* 2>/dev/null; then
  pass "react-hooks/rules-of-hooks configured"
else warn "react-hooks/rules-of-hooks not configured — hooks after early return cause React #310"; fi

if ! g 'preloadError' >/dev/null; then warn "no vite:preloadError handler — stale chunks after deploy break sections"
else pass "stale-chunk handler present"; fi

section "Analytics (references/seo-analytics.md)"
if g 'googletagmanager|GoogleTagManager' >/dev/null; then pass "GTM referenced in src"
else fail "GTM not referenced in src — Analytics section is skipped by the resolver"; fi
hits=$(g 'requestIdleCallback|firstInteraction|onFirstGesture' | grep -iE 'gtm|tag|analytic')
[ -z "$hits" ] && pass "no gesture/idle gate around tags" || { fail "tag manager gated behind gesture/idle (~20% orders on Farm)"; echo "$hits" | show; }

if [ -n "$CAND" ]; then
  section "HTTP — candidate $CAND"
  cc() { curl -s -m 20 -A "$UA" "$@"; }

  # status of the final response (skips 103 Early Hints)
  code() { cc -o /dev/null -w '%{http_code}' "$@"; }
  # Cloudflare's own bot cookies don't count
  h=$(cc -o /dev/null -D - "$CAND/" | grep -viE '^set-cookie: *(__cf_bm|_cfuvid|cf_clearance)=')
  c=$(code "$CAND/")
  [ "$c" = "200" ] && pass "/ → 200" || fail "/ → $c"
  sc=$(echo "$h" | grep -ci '^set-cookie')
  [ "$sc" = "0" ] && pass "anonymous / sends no Set-Cookie" || { warn "anonymous / sends $sc Set-Cookie — HTML not edge-cacheable"; echo "$h" | grep -i '^set-cookie' | cut -c1-80 | show; }
  xc=$(cc -o /dev/null -D - "$CAND/" | grep -iE '^(x-cache|cf-cache-status):' | tr -d '\r' | tr '\n' ' ')
  echo "$xc" | grep -qi 'hit' && pass "2nd request: $xc" || warn "2nd request not a HIT: ${xc:-no cache header}"

  h=$(cc -o /dev/null -D - -H 'If-Modified-Since: Tue, 20 Oct 2026 00:00:00 GMT' -H 'If-None-Match: "x"' "$CAND/checkout/")
  c=$(echo "$h" | grep -E '^HTTP/' | grep -v ' 103' | tail -1 | awk '{print $2}')
  if [ "$c" = "304" ]; then fail "/checkout/ answers 304 to validators — stale checkout from browser cache"
  elif echo "$h" | grep -qiE '^(last-modified|etag):'; then warn "/checkout/ sends Last-Modified/ETag — browser will revalidate"
  else pass "/checkout/ → $c without validators"; fi

  loops=""
  for p in '/%7Bx%7D' '/x%7B' '/%5Bx%5D' '/%7Cx' '/%5Ex' '/%60x'; do
    n=$(cc -o /dev/null -L --max-redirs 10 -w '%{num_redirects}' "$CAND$p")
    [ "${n:-0}" -ge 5 ] && loops="$loops ${p};"
  done
  [ -z "$loops" ] && pass "no redirect loops on encoded paths" || fail "redirect loop (≥5 hops) on:$loops — router self-redirect (Farm T-BRACELOOP)"

  robots=$(cc "$CAND/robots.txt")
  echo "$robots" | grep -qE '^Disallow:\s*/\s*$' && fail "robots.txt has Disallow: /" || pass "robots.txt does not block everything"
  cc "$CAND/" | grep -qiE '<meta[^>]+robots[^>]+noindex' && fail "home has meta noindex" || pass "home indexable"
  cc "$CAND/" | grep -q 'googletagmanager.com' && pass "GTM in home HTML" || warn "GTM not in home HTML (host-gated? injected late?)"

  c=$(code "$CAND/this-page-should-not-exist-$RANDOM")
  [ "$c" = "404" ] && pass "missing page → 404" || fail "missing page → $c (soft 404 — compare with legacy)"

  if [ -n "$LEGACY" ]; then
    section "Header diff — legacy $LEGACY × candidate"
    for p in / /checkout/; do
      for hdr in cross-origin-opener-policy cross-origin-embedder-policy content-security-policy permissions-policy x-frame-options; do
        a=$(curl -s -m 20 -A "$UA" -o /dev/null -D - "$LEGACY$p" | grep -i "^$hdr:" | tr -d '\r' | cut -d: -f2- | xargs)
        b=$(cc -o /dev/null -D - "$CAND$p" | grep -i "^$hdr:" | tr -d '\r' | cut -d: -f2- | xargs)
        [ "$a" = "$b" ] || warn "$p $hdr: legacy='${a:-<none>}' candidate='${b:-<none>}'"
      done
    done
    pass "header diff done (differences listed above, if any)"
  fi
fi

printf '\n%s FAIL, %s WARN. Browser-only checks (🧪) are in SKILL.md.\n' "$fails" "$warns"
[ "$fails" = "0" ]
