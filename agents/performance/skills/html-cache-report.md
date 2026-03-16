---
name: html-cache-report
description: Query CDN cache metrics for HTML pages from ClickHouse Stats Lake and generate an HTML cache performance report for a Deco site.
---

# HTML Cache Report

Analyze **CDN cache performance specifically for HTML pages** using Azion/Cloudflare data from the ClickHouse Stats Lake.

## When to Use

- Investigating why HTML pages have low cache hit rate on CDN
- Understanding how much HTML traffic hits the origin vs is served from edge
- Comparing HTML cache performance across sites or time periods
- Debugging why specific pages aren't caching

## Prerequisites

```bash
export STATS_LAKE_URL="https://kpobssxane.us-east-1.aws.clickhouse.cloud:8443/"
export STATS_LAKE_USER="default"
export STATS_LAKE_PASSWORD="<password>"
```

## Background: How HTML Cache Works in Deco

### CDN cache flow

1. User requests a page (e.g., `GET /produto/camiseta`)
2. CDN (Azion or Cloudflare) checks edge cache
3. If **hit**: serve from edge, never reaches origin
4. If **miss**: forward to origin (Deco pod), render page, return response with Cache-Control headers

### What controls HTML cacheability

HTML cache depends on multiple gates (checked in order in `deco/runtime/middleware.ts`):

| Gate | Where | Effect |
|---|---|---|
| `DECO_PAGE_CACHE_ENABLED=true` | Environment variable | Master switch — must be true |
| Response is `text/html` | Middleware | Only HTML gets page cache |
| No `Set-Cookie` in response | Middleware | Any Set-Cookie forces `no-store` |
| All flags have `cacheable === true` | Middleware | Any non-cacheable flag blocks cache |
| No prior `Cache-Control` set | Middleware | Won't overwrite existing header |
| All loaders have `vary.shouldCache` | Loader block | Any `no-store` loader blocks page cache |
| `PAGE_CACHE_ALLOWED_KEY` set | App middleware (e.g., VTEX) | App-level opt-in |
| User not logged in | App middleware (e.g., VTEX) | Logged-in users get `no-store` |

When all gates pass, default header:
```
Cache-Control: public, max-age=90, s-maxage=90, stale-while-revalidate=30
```

### How to identify HTML pages in CDN data

HTML pages are URLs that are NOT assets, loaders, partials, APIs, or proxied requests. We filter them out with:

```sql
AND url NOT LIKE '/live/invoke%'    -- loaders/actions
AND url NOT LIKE '/deco/render%'    -- partials
AND url NOT LIKE '/_frsh/%'         -- Fresh JS/CSS bundles
AND url NOT LIKE '/%.css%' AND url NOT LIKE '/%.js%' AND url NOT LIKE '/%.svg%'
AND url NOT LIKE '/%.png%' AND url NOT LIKE '/%.jpg%' AND url NOT LIKE '/%.woff%'
AND url NOT LIKE '/api/%'           -- API calls
AND url NOT LIKE '/https:%'         -- proxied requests
```

### CDN cache status meanings

- `hit` — served from CDN edge cache
- `miss` — CDN had to fetch from origin
- `expired` — CDN had cached version but it expired
- `dynamic` — CDN treated as uncacheable (origin sent no Cache-Control or sent `no-store`)
- `bypass` — CDN rule explicitly bypasses cache
- `stale` — CDN served stale while revalidating
- `revalidated` — CDN revalidated with origin (304)

**Key insight:** If `dynamic` is high, the origin is NOT sending Cache-Control headers (page cache disabled or blocked by a gate). If `miss` is high but `dynamic` is low, pages are cacheable but TTL is too short or URL cardinality is too high.

## Query Building Guide

### Filtering: per-site vs platform-wide

**Per site** — use `site_name = '<SITE_NAME>'` on views, or `site_id = <SITE_ID>` on fact tables.

**Platform-wide** — omit the site filter. Optionally group by `site_name` or `site_id`.

### Date ranges

```sql
-- Last 7 days
WHERE date >= today() - 7

-- Last 30 days
WHERE date >= today() - 30

-- Specific day
WHERE date = '2026-03-15'

-- Date range
WHERE date BETWEEN '2026-03-10' AND '2026-03-15'

-- Yesterday only
WHERE date = today() - 1
```

### Finding a site

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary "SELECT id, name FROM dim_sites WHERE name ILIKE '%<SITE_NAME>%' FORMAT PrettyCompact"
```

Note the `id` for `fact_top_urls_daily` queries.

## Data Collection

Adjust `WHERE` clauses for site scope and date range as needed.

### Step 1: HTML cache hit rate over time

**Per site (last 7 days):**

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    date,
    sum(requests) AS html_requests,
    sumIf(requests, cache_status = 'hit') AS html_cache_hits,
    round(sumIf(requests, cache_status = 'hit') * 100.0 / sum(requests), 2) AS html_hit_rate_pct,
    sumIf(requests, cache_status = 'dynamic') AS dynamic_count,
    sumIf(requests, cache_status = 'miss') AS miss_count
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID>
  AND date >= today() - 7
  AND url NOT LIKE '/live/invoke%'
  AND url NOT LIKE '/deco/render%'
  AND url NOT LIKE '/_frsh/%'
  AND url NOT LIKE '/%.css%' AND url NOT LIKE '/%.js%' AND url NOT LIKE '/%.svg%'
  AND url NOT LIKE '/%.png%' AND url NOT LIKE '/%.jpg%' AND url NOT LIKE '/%.woff%'
  AND url NOT LIKE '/api/%'
  AND url NOT LIKE '/https:%'
GROUP BY date
ORDER BY date DESC
FORMAT PrettyCompact
SQL
```

**Platform-wide (all sites, yesterday):**

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    s.name AS site_name,
    sum(f.requests) AS html_requests,
    sumIf(f.requests, f.cache_status = 'hit') AS html_cache_hits,
    round(sumIf(f.requests, f.cache_status = 'hit') * 100.0 / sum(f.requests), 2) AS html_hit_rate_pct
FROM fact_top_urls_daily f
JOIN dim_sites s ON f.site_id = s.id
WHERE f.date = today() - 1
  AND f.url NOT LIKE '/live/invoke%'
  AND f.url NOT LIKE '/deco/render%'
  AND f.url NOT LIKE '/_frsh/%'
  AND f.url NOT LIKE '/%.css%' AND f.url NOT LIKE '/%.js%' AND f.url NOT LIKE '/%.svg%'
  AND f.url NOT LIKE '/%.png%' AND f.url NOT LIKE '/%.jpg%' AND f.url NOT LIKE '/%.woff%'
  AND f.url NOT LIKE '/api/%'
  AND f.url NOT LIKE '/https:%'
GROUP BY s.name
HAVING html_requests > 100
ORDER BY html_requests DESC
LIMIT 30
FORMAT PrettyCompact
SQL
```

**Platform-wide (aggregated trend, last 7 days):**

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    date,
    sum(requests) AS html_requests,
    sumIf(requests, cache_status = 'hit') AS html_cache_hits,
    round(sumIf(requests, cache_status = 'hit') * 100.0 / sum(requests), 2) AS html_hit_rate_pct
FROM fact_top_urls_daily
WHERE date >= today() - 7
  AND url NOT LIKE '/live/invoke%'
  AND url NOT LIKE '/deco/render%'
  AND url NOT LIKE '/_frsh/%'
  AND url NOT LIKE '/%.css%' AND url NOT LIKE '/%.js%' AND url NOT LIKE '/%.svg%'
  AND url NOT LIKE '/%.png%' AND url NOT LIKE '/%.jpg%' AND url NOT LIKE '/%.woff%'
  AND url NOT LIKE '/api/%'
  AND url NOT LIKE '/https:%'
GROUP BY date
ORDER BY date DESC
FORMAT PrettyCompact
SQL
```

### Step 2: HTML cache status breakdown

What's causing misses — `dynamic` (origin not sending cache headers) vs `miss` (cacheable but cold)?

**Per site:**

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    date,
    cache_status,
    sum(requests) AS total_requests,
    round(sum(requests) * 100.0 / sum(sum(requests)) OVER (PARTITION BY date), 2) AS pct
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID>
  AND date >= today() - 7
  AND url NOT LIKE '/live/invoke%'
  AND url NOT LIKE '/deco/render%'
  AND url NOT LIKE '/_frsh/%'
  AND url NOT LIKE '/%.css%' AND url NOT LIKE '/%.js%' AND url NOT LIKE '/%.svg%'
  AND url NOT LIKE '/%.png%' AND url NOT LIKE '/%.jpg%' AND url NOT LIKE '/%.woff%'
  AND url NOT LIKE '/api/%'
  AND url NOT LIKE '/https:%'
GROUP BY date, cache_status
ORDER BY date DESC, total_requests DESC
FORMAT PrettyCompact
SQL
```

### Step 3: Top HTML pages NOT caching

Which specific pages have the most cache misses?

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    url,
    cache_status,
    sum(requests) AS total_requests,
    round(sum(bandwidth_bytes) / 1048576, 1) AS bandwidth_mb
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID>
  AND date = today() - 1
  AND cache_status IN ('miss', 'dynamic', 'bypass')
  AND url NOT LIKE '/live/invoke%'
  AND url NOT LIKE '/deco/render%'
  AND url NOT LIKE '/_frsh/%'
  AND url NOT LIKE '/%.css%' AND url NOT LIKE '/%.js%' AND url NOT LIKE '/%.svg%'
  AND url NOT LIKE '/%.png%' AND url NOT LIKE '/%.jpg%' AND url NOT LIKE '/%.woff%'
  AND url NOT LIKE '/api/%'
  AND url NOT LIKE '/https:%'
GROUP BY url, cache_status
ORDER BY total_requests DESC
LIMIT 20
FORMAT PrettyCompact
SQL
```

### Step 4: Top HTML pages that ARE caching (validate what works)

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    url,
    sum(requests) AS total_requests,
    sumIf(requests, cache_status = 'hit') AS hits,
    round(sumIf(requests, cache_status = 'hit') * 100.0 / sum(requests), 2) AS hit_rate_pct
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID>
  AND date = today() - 1
  AND url NOT LIKE '/live/invoke%'
  AND url NOT LIKE '/deco/render%'
  AND url NOT LIKE '/_frsh/%'
  AND url NOT LIKE '/%.css%' AND url NOT LIKE '/%.js%' AND url NOT LIKE '/%.svg%'
  AND url NOT LIKE '/%.png%' AND url NOT LIKE '/%.jpg%' AND url NOT LIKE '/%.woff%'
  AND url NOT LIKE '/api/%'
  AND url NOT LIKE '/https:%'
GROUP BY url
HAVING total_requests > 100
ORDER BY hit_rate_pct DESC
LIMIT 20
FORMAT PrettyCompact
SQL
```

### Step 5: Verify cache headers on live pages

```bash
# Check cache headers on a specific HTML page
curl -sI "https://<domain>/<path>" | grep -iE "^(cache-control|set-cookie|vary|age|cf-cache-status|x-cache|cdn-cache-control):"

# Compare: a page that should cache vs one that shouldn't
curl -sI "https://<domain>/" | grep -i cache-control
curl -sI "https://<domain>/account" | grep -i cache-control
```

## Report Template

```md
# HTML Cache Report — <SITE_NAME>

**Date:** <date>
**Period:** Last 7 days
**CDN Provider:** Azion / Cloudflare

## Summary

| Metric | Value |
|---|---|
| HTML cache hit rate | XX% |
| Daily HTML requests (avg) | X |
| Daily HTML cache hits (avg) | X |
| Dominant miss reason | dynamic / miss / bypass |

## HTML Cache Hit Rate Trend

| Date | HTML Requests | Cache Hits | Hit Rate | Dynamic | Miss |
|---|---|---|---|---|---|
| <date> | X | X | XX% | X | X |
| ... | ... | ... | ... | ... | ... |

## HTML Cache Status Breakdown

| Status | Count | % | Meaning |
|---|---|---|---|
| hit | X | XX% | Served from edge |
| dynamic | X | XX% | Origin not sending cache headers |
| miss | X | XX% | Cacheable but cold cache |
| bypass | X | XX% | CDN rule skips cache |
| expired | X | XX% | TTL expired |

## Top Uncached HTML Pages

| URL | Status | Requests | Bandwidth |
|---|---|---|---|
| <url> | dynamic | X | X MB |
| ... | ... | ... | ... |

## Top Cached HTML Pages

| URL | Requests | Hit Rate |
|---|---|---|
| <url> | X | XX% |
| ... | ... | ... |

## Live Header Check

<paste curl -sI output for a failing page vs a working page>

## Root Cause Analysis

<Based on the data, explain why HTML cache is low. Common causes:>

1. **Page cache not enabled** — `DECO_PAGE_CACHE_ENABLED` not set → all pages return `dynamic`
2. **Loaders blocking cache** — a loader with `no-store` sets `vary.shouldCache = false` → middleware emits `no-store` → CDN sees `dynamic`
3. **Set-Cookie in response** — session/auth cookies force `no-store` → `dynamic`
4. **Logged-in users** — VTEX middleware marks page as dirty → `dynamic`
5. **Non-cacheable flags** — a matcher without `cacheable` export blocks cache
6. **High URL cardinality** — too many unique URLs, each gets few requests, cache never warms → high `miss`

## Recommendations

1. **[HIGH]** <recommendation>
2. **[MED]** <recommendation>
3. **[LOW]** <recommendation>

## Validation

After changes:
\`\`\`bash
curl -sI "https://<domain>/<path>" | grep -i cache-control
# Expected: Cache-Control: public, max-age=90, s-maxage=90, stale-while-revalidate=30
\`\`\`

Monitor ClickHouse for improvement over 24-48h.
```

## Reference: Platform HTML Cache Benchmarks (March 2026)

| Metric | Value |
|---|---|
| Platform-wide HTML cache hit rate | 20-23% |
| Best-in-class sites | 60-80% |
| Sites with page cache disabled | 0-5% (only CDN default behavior) |
