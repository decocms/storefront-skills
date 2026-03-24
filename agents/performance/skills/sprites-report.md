---
name: sprites-report
description: Query CDN metrics for /sprites.svg from ClickHouse Stats Lake. Reports which sites consume the most requests and bandwidth via sprites, and details cache performance per site.
---

# Sprites Report

Analyze **CDN traffic for `/sprites.svg`** using Azion/Cloudflare data from the ClickHouse Stats Lake.

## When to Use

- Investigating which sites consume the most bandwidth serving sprites
- Checking if `/sprites.svg` is being properly cached at the CDN
- Platform-wide sprites traffic audits
- Per-site sprites cache debugging

## Prerequisites

```bash
export STATS_LAKE_URL="https://kpobssxane.us-east-1.aws.clickhouse.cloud:8443/"
export STATS_LAKE_USER="default"
export STATS_LAKE_PASSWORD="<password>"
```

## Background: What is `/sprites.svg`

In Deco storefronts, `/sprites.svg` is an SVG sprite sheet that consolidates all site icons into a single file. Every page load typically requests it once. Because it rarely changes, it is an ideal candidate for aggressive CDN caching (`Cache-Control: public, max-age=...`).

When `/sprites.svg` has a low CDN hit rate:
- Origin receives a disproportionate number of requests for a static file
- Bandwidth costs increase unnecessarily
- The fix is usually a missing or incorrect `Cache-Control` header on the route

### CDN cache status meanings

- `hit` — served from CDN edge cache (ideal)
- `miss` — CDN had to fetch from origin (cacheable but cache not yet warm)
- `dynamic` — CDN treated as uncacheable (origin sent no Cache-Control or sent `no-store`)
- `expired` — CDN had cached version but TTL expired
- `bypass` — CDN rule explicitly bypasses cache
- `stale` — CDN served stale while revalidating

**Key insight:** If `dynamic` is high, the origin is not sending `Cache-Control` headers for `/sprites.svg`. If `miss` is high but `dynamic` is low, the file is cacheable but the cache is cold or the TTL is too short.

## Query Building Guide

### Date ranges

```sql
-- Last 7 days
WHERE date >= today() - 7

-- Yesterday only
WHERE date = today() - 1

-- Specific day
WHERE date = '2026-03-15'
```

### Finding a site

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary "SELECT id, name FROM dim_sites WHERE name ILIKE '%<SITE_NAME>%' FORMAT PrettyCompact"
```

Note the `id` for per-site queries on `fact_top_urls_daily`.

### Note on column types

`fact_top_urls_daily` columns `requests` and `bandwidth_bytes` are plain `UInt64` — no `-Merge` combinator needed.

## Data Collection

### Step 1: Platform-wide — top sites by requests (last 7 days)

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    s.name AS site_name,
    sum(f.requests) AS total_requests,
    round(sum(f.bandwidth_bytes) / 1048576, 2) AS bandwidth_mb,
    round(sumIf(f.requests, f.cache_status = 'hit') * 100.0 / sum(f.requests), 2) AS hit_rate_pct
FROM fact_top_urls_daily f
JOIN dim_sites s ON f.site_id = s.id
WHERE f.url LIKE '%/sprites.svg%'
  AND f.date >= today() - 7
GROUP BY s.name
HAVING total_requests > 10
ORDER BY total_requests DESC
LIMIT 30
FORMAT PrettyCompact
SQL
```

### Step 2: Platform-wide — top sites by bandwidth (last 7 days)

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    s.name AS site_name,
    sum(f.requests) AS total_requests,
    round(sum(f.bandwidth_bytes) / 1048576, 2) AS bandwidth_mb,
    round(sumIf(f.requests, f.cache_status = 'hit') * 100.0 / sum(f.requests), 2) AS hit_rate_pct
FROM fact_top_urls_daily f
JOIN dim_sites s ON f.site_id = s.id
WHERE f.url LIKE '%/sprites.svg%'
  AND f.date >= today() - 7
GROUP BY s.name
HAVING total_requests > 10
ORDER BY bandwidth_mb DESC
LIMIT 30
FORMAT PrettyCompact
SQL
```

### Step 3: Per-site — daily trend (last 7 days)

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    date,
    sum(requests) AS total_requests,
    round(sum(bandwidth_bytes) / 1048576, 2) AS bandwidth_mb,
    sumIf(requests, cache_status = 'hit') AS hits,
    round(sumIf(requests, cache_status = 'hit') * 100.0 / sum(requests), 2) AS hit_rate_pct,
    sumIf(requests, cache_status = 'dynamic') AS dynamic_count,
    sumIf(requests, cache_status = 'miss') AS miss_count
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID>
  AND url LIKE '%/sprites.svg%'
  AND date >= today() - 7
GROUP BY date
ORDER BY date DESC
FORMAT PrettyCompact
SQL
```

### Step 4: Per-site — cache status breakdown (yesterday)

```bash
curl -s "$STATS_LAKE_URL/" \
  --user "$STATS_LAKE_USER:$STATS_LAKE_PASSWORD" \
  --data-binary @- <<'SQL'
SELECT
    cache_status,
    sum(requests) AS total_requests,
    round(sum(requests) * 100.0 / sum(sum(requests)) OVER (), 2) AS pct,
    round(sum(bandwidth_bytes) / 1048576, 2) AS bandwidth_mb
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID>
  AND url LIKE '%/sprites.svg%'
  AND date = today() - 1
GROUP BY cache_status
ORDER BY total_requests DESC
FORMAT PrettyCompact
SQL
```

### Step 5: Verify cache headers on live `/sprites.svg`

```bash
curl -sI "https://<domain>/sprites.svg" | grep -iE "^(cache-control|cdn-cache-control|cf-cache-status|x-cache|age|vary|content-encoding|content-length):"
```

A well-configured sprites response should show:
- `Cache-Control: public, max-age=<N>` (or `immutable`)
- `Content-Encoding: gzip` or `br` (compressed)
- CDN status: `hit` after first request

## Report Template

```md
# Sprites Report — <SITE_NAME or "Platform-wide">

**Date:** <date>
**Period:** Last 7 days

## Platform-wide Summary

### Top sites by requests

| Site | Requests | Bandwidth (MB) | CDN Hit Rate |
|---|---|---|---|
| <site> | X | X | XX% |
| ... | ... | ... | ... |

### Top sites by bandwidth

| Site | Requests | Bandwidth (MB) | CDN Hit Rate |
|---|---|---|---|
| <site> | X | X | XX% |
| ... | ... | ... | ... |

---

## Per-site: <SITE_NAME>

### Daily Trend

| Date | Requests | Bandwidth (MB) | Hit Rate | Dynamic | Miss |
|---|---|---|---|---|---|
| <date> | X | X | XX% | X | X |
| ... | ... | ... | ... | ... | ... |

### Cache Status Breakdown (yesterday)

| Status | Requests | % | Bandwidth (MB) |
|---|---|---|---|
| hit | X | XX% | X |
| dynamic | X | XX% | X |
| miss | X | XX% | X |
| ... | ... | ... | ... |

### Live Header Check

<paste curl -sI output>

## Root Cause Analysis

<Based on the data, explain the cache situation. Common causes:>

1. **`dynamic` high** — origin not sending Cache-Control for `/sprites.svg` → check route handler or CDN rule
2. **`miss` high, `dynamic` low** — file is cacheable but TTL is short or cache cold → increase max-age
3. **Hit rate near 0%** — CDN bypassing cache for this route → check CDN bypass rules

## Recommendations

1. **[HIGH]** <recommendation>
2. **[MED]** <recommendation>
3. **[LOW]** <recommendation>

## Validation

After changes:
\`\`\`bash
curl -sI "https://<domain>/sprites.svg" | grep -i cache-control
# Expected: Cache-Control: public, max-age=<N>
\`\`\`

Monitor ClickHouse for improvement over 24-48h.
```
