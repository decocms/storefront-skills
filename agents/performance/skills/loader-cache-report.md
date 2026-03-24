---
name: loader-cache-report
description: Query loader internal cache metrics from HyperDX and audit loader cache config in site code. Generates a report with hit/miss/stale rates, latency impact, and recommendations.
---

# Loader Cache Report

Analyze the **internal loader cache** (origin-side, LRU + filesystem) for a Deco site using HyperDX traces and site code audit.

## When to Use

- Investigating slow page renders caused by loader cache misses
- Comparing cache effectiveness before/after a deploy
- Identifying which loaders block HTML page caching
- Monthly loader cache performance reviews

## Prerequisites

```bash
export HYPERDX_API_KEY="<key>"
```

## Background: How Loader Cache Works

### Source code reference

Cache logic lives in `deco/blocks/loader.ts` (the `wrapLoader` function).

### Cache modes

Each loader can export a `cache` constant:

| Mode | Behavior | Effect on HTML page cache |
|---|---|---|
| `"stale-while-revalidate"` | Returns stale data immediately, revalidates in background | Page CAN be cached |
| `"no-cache"` | Always executes loader, doesn't block page caching | Page CAN be cached |
| `"no-store"` (default when no `cache` export) | Skips cache AND sets `vary.shouldCache = false` | **BLOCKS page cache** |

### Cache key

`SHA1(resolver + resolveChain + K_REVISION + cacheKey())` — default TTL: 60s.

If `cacheKey()` returns `null`, cache is bypassed for that request.

### Stale window (STALE_TTL_PERIOD)

After the TTL expires, the item enters a **stale** window where it continues to be served while a background revalidation runs. Default is 30s, but sites can override via the `STALE_TTL_PERIOD` env var (in ms).

A high stale rate in HyperDX combined with a long `STALE_TTL_PERIOD` is expected behavior, not a problem.

### Critical: no-store contaminates entire page

If **any** loader in a page render has `cache: "no-store"` (or no cache export at all), the entire HTML response gets `Cache-Control: no-store`. This is the #1 reason pages don't cache.

### Where the data lives

The deco runtime emits OTEL traces for every cache lookup:
- **Span name:** `cache-match`
- **Attributes:** `cache_status` (hit / miss / stale), `service` (site name)
- **Destination:** HyperDX (via `OTEL_EXPORTER_OTLP_ENDPOINT=https://in-otel.hyperdx.io`)

There is also an OTEL counter `loader_cache` with `{status, loader}` dimensions, but the trace spans are more queryable in HyperDX.

## Query Building Guide

### Time range

HyperDX uses millisecond timestamps. Common patterns:

```bash
# Last 24 hours
START=$(($(date +%s)*1000 - 86400000))
END=$(($(date +%s)*1000))

# Last 7 days
START=$(($(date +%s)*1000 - 604800000))
END=$(($(date +%s)*1000))

# Specific day (e.g., 2026-03-15)
START=$(($(date -j -f "%Y-%m-%d" "2026-03-15" +%s 2>/dev/null || date -d "2026-03-15" +%s)*1000))
END=$((START + 86400000))
```

### Granularity

Choose based on time range:
- Last 24h → `"granularity": "1 hour"`
- Last 7 days → `"granularity": "6 hour"` or `"1 day"`
- Single day → `"granularity": "1 hour"` or `"30 minute"`

### Filtering: per-site vs platform-wide

**Per site** — add `service:\"<SITE_NAME>\"` to the `where` clause:
```
"where": "span_name:\"cache-match\" cache_status:* service:\"<SITE_NAME>\""
```

**Platform-wide** — omit `service:` and optionally group by it:
```
"where": "span_name:\"cache-match\" cache_status:*",
"groupBy": ["service", "cache_status"]
```

**Discover available services:**
```bash
curl -s -X POST https://api.hyperdx.io/api/v1/charts/series \
  -H "Authorization: Bearer $HYPERDX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "series": [{
      "dataSource": "events",
      "aggFn": "count",
      "where": "span_name:\"cache-match\" cache_status:*",
      "groupBy": ["service"]
    }],
    "startTime": '"$(($(date +%s)*1000 - 86400000))"',
    "endTime": '"$(($(date +%s)*1000))"',
    "granularity": "1 day"
  }'
```

## Data Collection

In all queries below, adjust the `where`, `startTime`, `endTime`, and `granularity` as described above.

### Step 1: Cache status breakdown

```bash
curl -s -X POST https://api.hyperdx.io/api/v1/charts/series \
  -H "Authorization: Bearer $HYPERDX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "series": [{
      "dataSource": "events",
      "aggFn": "count",
      "where": "span_name:\"cache-match\" cache_status:* service:\"<SITE_NAME>\"",
      "groupBy": ["cache_status"]
    }],
    "startTime": '"$(($(date +%s)*1000 - 86400000))"',
    "endTime": '"$(($(date +%s)*1000))"',
    "granularity": "1 hour"
  }'
```

Parse response: group by `cache_status`, sum `series_0.data` per group.

**Platform-wide variant** — replace `where` and `groupBy`:
```json
"where": "span_name:\"cache-match\" cache_status:*",
"groupBy": ["service", "cache_status"]
```

### Step 2: Hit rate over time

```bash
curl -s -X POST https://api.hyperdx.io/api/v1/charts/series \
  -H "Authorization: Bearer $HYPERDX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "series": [
      {
        "dataSource": "events",
        "aggFn": "count",
        "where": "span_name:\"cache-match\" cache_status:\"hit\" service:\"<SITE_NAME>\" OR span_name:\"cache-match\" cache_status:\"stale\" service:\"<SITE_NAME>\"",
        "groupBy": []
      },
      {
        "dataSource": "events",
        "aggFn": "count",
        "where": "span_name:\"cache-match\" cache_status:* service:\"<SITE_NAME>\"",
        "groupBy": []
      }
    ],
    "startTime": '"$(($(date +%s)*1000 - 86400000))"',
    "endTime": '"$(($(date +%s)*1000))"',
    "granularity": "1 hour"
  }'
```

Hit rate per bucket = `series_0.data / series_1.data * 100`.

### Step 3: Cache latency by status

```bash
curl -s -X POST https://api.hyperdx.io/api/v1/charts/series \
  -H "Authorization: Bearer $HYPERDX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "series": [{
      "dataSource": "events",
      "aggFn": "p95",
      "field": "duration",
      "where": "span_name:\"cache-match\" cache_status:* service:\"<SITE_NAME>\"",
      "groupBy": ["cache_status"]
    }],
    "startTime": '"$(($(date +%s)*1000 - 86400000))"',
    "endTime": '"$(($(date +%s)*1000))"',
    "granularity": "1 hour"
  }'
```

A large gap between hit and miss latency = high impact of improving cache.

### Step 4: Compare across deployments

```bash
curl -s -X POST https://api.hyperdx.io/api/v1/charts/series \
  -H "Authorization: Bearer $HYPERDX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "series": [{
      "dataSource": "events",
      "aggFn": "count",
      "where": "span_name:\"cache-match\" cache_status:* service:\"<SITE_NAME>\"",
      "groupBy": ["process.tag.service.version", "cache_status"]
    }],
    "startTime": '"$(($(date +%s)*1000 - 86400000))"',
    "endTime": '"$(($(date +%s)*1000))"',
    "granularity": "1 hour"
  }'
```

### Step 5: Audit loader cache config in site code

```bash
# Loaders with explicit cache export (good — they opted in)
rg -n 'export const cache' --type ts

# Loaders with cacheKey (custom cache key logic)
rg -n 'export const cacheKey' --type ts

# Loaders using the STALE shorthand from apps/utils/fetch.ts
rg -n 'STALE|stale-while-revalidate' --type ts

# Loaders with explicit no-store (cache blockers)
rg -n 'no-store' --type ts
```

Any loader file in `loaders/` that does NOT export `cache` defaults to `"no-store"` and will block page caching.

### Common loaders and their default cache modes (from apps/)

| Loader | Cache Mode | Notes |
|---|---|---|
| `vtex/loaders/intelligentSearch/productListingPage.ts` | `stale-while-revalidate` | Has custom cacheKey |
| `vtex/loaders/cart.ts` | `no-store` | Intentional — cart is user-specific |
| `vtex/loaders/navbar.ts` | `no-cache` | Doesn't block page cache |
| `wake/loaders/user.ts` | `no-store` | Intentional — user is session-specific |
| `wake/loaders/cart.ts` | `no-store` | Intentional |
| `website/loaders/fonts/googleFonts.ts` | `stale-while-revalidate` | Has custom cacheKey |
| `website/loaders/secret.ts` | `no-cache` | |

## Report Template

```md
# Loader Cache Report — <SITE_NAME>

**Date:** <date>
**Period:** Last 24h

## Summary

| Metric | Value |
|---|---|
| Total cache lookups | X |
| Hit rate (hit + stale) | XX% |
| Miss rate | XX% |
| P95 latency — hit | Xms |
| P95 latency — miss | Xms |
| Latency savings from cache | Xms (miss - hit) |

## Cache Status Breakdown

| Status | Count | % |
|---|---|---|
| hit | X | XX% |
| stale | X | XX% |
| miss | X | XX% |

## Hit Rate Over Time

<describe trend — stable? degrading? spikes?>

## Latency Impact

| Status | P95 | AVG |
|---|---|---|
| hit | Xms | Xms |
| stale | Xms | Xms |
| miss | Xms | Xms |

**Estimated time saved by cache:** X cache hits * (miss_latency - hit_latency) = Xs saved

## Deploy Comparison (if applicable)

| Version | Hit Rate | Miss Rate |
|---|---|---|
| <v1> | XX% | XX% |
| <v2> | XX% | XX% |

## Loader Configuration Audit

### Cached loaders (stale-while-revalidate)
<list with file paths>

### Cache blockers (no-store or no cache export)
<list with file paths — these block HTML page caching>

### Custom cacheKey loaders
<list with file paths>

## Recommendations

1. **[HIGH]** <loaders blocking page cache that could be switched to SWR>
2. **[MED]** <loaders without cache export in site/loaders/>
3. **[LOW]** <cacheKey optimizations or TTL tuning>

## Validation

After changes, check HyperDX dashboard "Cache de loaders" filtered by service:"<SITE_NAME>".
Compare hit rate before vs after deploy using the deployment version breakdown.
```

## Existing HyperDX Dashboard

Dashboard **"Cache de loaders"** (id: `68f6a2d4bcb2b48e2abdee18`) already exists with:
- Cache by status
- Hit rate %
- P99/P95/P90/AVG hit duration
- Cache by deployment version

Filter by `service:"<site-name>"` in the dashboard query bar.
