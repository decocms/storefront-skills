# Sprites Report Skill — Design Spec

**Date:** 2026-03-20
**Status:** Approved

## Overview

A single skill `sprites-report` that analyzes `/sprites.svg` CDN traffic using the ClickHouse Stats Lake. Covers both platform-wide (top sites by requests and bandwidth) and per-site (trend and cache status breakdown) views.

## File Location

```
agents/performance/skills/sprites-report.md
```

## Skill Frontmatter

```yaml
name: sprites-report
description: Query CDN metrics for /sprites.svg from ClickHouse Stats Lake. Reports which sites consume the most requests and bandwidth via sprites, and details cache performance per site.
```

## Sections

### 1. When to Use
- Investigating which sites consume the most bandwidth serving sprites
- Checking if `/sprites.svg` is being properly cached at the CDN
- Platform-wide sprites traffic audits
- Per-site sprites cache debugging

### 2. Prerequisites
Same env vars as other ClickHouse skills:
```
STATS_LAKE_URL, STATS_LAKE_USER, STATS_LAKE_PASSWORD
```

### 3. Background
Brief explanation of what `/sprites.svg` is in Deco storefronts (SVG sprite sheet for icons), why it matters for performance (size, cache behavior), and why it appears as a distinct route in CDN logs.

### 4. Query Building Guide
- How to filter by date (last 7 days, specific day, yesterday)
- How to find a site by name using `dim_sites`
- Note that `fact_top_urls_daily` columns (`requests`, `bandwidth_bytes`) are plain `UInt64` — no `-Merge` combinator needed

### 5. Data Collection — 4 queries

#### Step 1: Platform-wide — top sites by requests (last 7 days)
```sql
SELECT s.name AS site_name, sum(f.requests) AS total_requests, ...
FROM fact_top_urls_daily f JOIN dim_sites s ON f.site_id = s.id
WHERE f.url LIKE '%/sprites.svg%' AND f.date >= today() - 7
GROUP BY s.name ORDER BY total_requests DESC LIMIT 30
```

#### Step 2: Platform-wide — top sites by bandwidth (last 7 days)
Same structure, ordered by `sum(bandwidth_bytes)` DESC, formatted as MB.

#### Step 3: Per-site — daily trend (requests + cache status breakdown)
```sql
SELECT date, cache_status, sum(requests), round(sum(bandwidth_bytes)/1048576, 2) AS bandwidth_mb
FROM fact_top_urls_daily
WHERE site_id = <SITE_ID> AND url LIKE '%/sprites.svg%' AND date >= today() - 7
GROUP BY date, cache_status ORDER BY date DESC
```

#### Step 4: Per-site — overall cache status breakdown (yesterday)
Aggregated percentages per `cache_status` for a single day, to quickly see if sprites are hitting CDN cache or going to origin.

### 6. Report Template

Markdown template with two sections:

**Platform-wide:**
- Top 10 sites by requests table
- Top 10 sites by bandwidth table

**Per-site:**
- Daily trend table (date × cache_status)
- Cache status breakdown table with %
- Key insight: is `dynamic` high? (origin not sending Cache-Control) or `miss` high? (cacheable but cold/high cardinality)

## Design Decisions

- **Single file** — both scopes in one skill, sections clearly labeled. Matches `html-cache-report.md` pattern.
- **`fact_top_urls_daily`** — right table for URL-level queries; `bandwidth_bytes` and `requests` are plain UInt64, no merge needed.
- **`url LIKE '%/sprites.svg%'`** — catches both `/sprites.svg` and paths like `/sprites.svg?v=123` or `/assets/sprites.svg`.
- **No HyperDX dependency** — pure ClickHouse, no extra credentials needed beyond Stats Lake.

## Out of Scope

- Investigating SVG file size or compression (that's a site-level code concern, not CDN metrics)
- Comparing sprites across deployments (no version dimension in `fact_top_urls_daily`)
