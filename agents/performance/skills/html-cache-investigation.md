---
name: deco-html-cache-investigation
description: Investigate why specific Deco pages are not receiving HTML cache headers. Use when pages expected to be cached return no cache headers or no-store.
---

# HTML Cache Investigation

Use this skill when a storefront page should be cacheable but is returning no cache headers or `no-store`.

## Goal

Find the first concrete reason why a specific HTML page is not cacheable and propose the minimum safe fix.

## Inputs

- Failing URL (required)
- Working URL from same site (optional but recommended)
- Repository path
- Runtime environment (prod/staging)

## Current Deco HTML Cache Behavior (as of March 4, 2026)

Use this baseline before investigating regressions.

1. HTML cache is only considered when `DECO_PAGE_CACHE_ENABLED=true`.
2. Response must be HTML (`Content-Type` contains `text/html`).
3. If response has `Set-Cookie`, runtime forces `Cache-Control: no-store, no-cache, must-revalidate`.
4. All evaluated flags must have `cacheable === true`.
5. If a previous `Cache-Control` already exists, runtime does not overwrite it with public cache policy.
6. When all conditions pass and no prior header exists, default is:
   - `public, max-age=90, s-maxage=90, stale-while-revalidate=30`
   - or value from `DECO_PAGE_CACHE_CONTROL`.

### Important: runtime-owned gates

Some HTML cache gates are implemented in Deco runtime (outside site repository), such as app opt-in via `PAGE_CACHE_ALLOWED_KEY`.
When investigating only a site repo, treat these as external dependencies and report them as `RUNTIME_DEPENDENCY` when needed.
Do not block diagnosis on code you cannot inspect in the provided repository.

### Current `cacheable` matchers in `apps/website`

In the current codebase, these built-in website matchers export `cacheable = true`:

- `always`
- `never`
- `device`
- `environment`
- `host`
- `pathname`
- `queryString`
- `site`
- `date`

Practical implication: if page cache is blocked by flags, the blocker is usually a custom matcher without `cacheable`, a matcher explicitly marked non-cacheable, or runtime-level behavior.

### Variants and multivariate flags (important)

Variants use a multivariate flag model (`variants: [{ rule, value }]`). Runtime evaluates variant rules and picks the first matching variant.

- Variant matching controls selected content/experience.
- HTML cache gate still depends on matcher `cacheable` metadata.
- A variant not matching (`value` branch not selected) does not by itself make response cacheable/non-cacheable.
- Investigation should check matcher definitions used by variant rules, not only final variant output.

### Important: hostname must be in page cache rule (production/CDN only)

Even when app/runtime conditions pass, CDN page cache may still miss if the site's hostname is not included in the page cache rule.
This check applies only to environments behind CDN rules (typically production, sometimes staging).
For local/dev environments, skip this gate.

## Investigation Steps

### 1. Capture live headers first

```bash
curl -sSI "https://<host>/<path>" | rg -i "^(cache-control|set-cookie|content-type|vary|age|cf-cache-status|x-cache|date):"
```

If behavior depends on session/segmentation, run the same command with:

- anonymous request
- logged-in cookies
- relevant query params

### 2. Verify HTML cache gates in code

Search for cache gate logic:

```bash
rg -n "DECO_PAGE_CACHE_ENABLED|DECO_PAGE_CACHE_CONTROL|PAGE_CACHE_ALLOWED_KEY|Cache-Control|Set-Cookie|text/html|cacheable"
```

In site repos, prioritize:

- matchers and flags definitions (`cacheable`)
- handlers/middlewares that set `Set-Cookie`
- handlers/middlewares that set/override `Cache-Control`
- route-specific personalization/session logic

### 3. Evaluate gates in order

Mark each one as `PASS`, `FAIL`, or `UNKNOWN`.

1. `DECO_PAGE_CACHE_ENABLED=true` (if this is observable in your environment)
2. `Content-Type` includes `text/html`
3. no `Set-Cookie` in response
4. all evaluated flags are cacheable (`cacheable === true`)
5. no stricter pre-existing `Cache-Control`
6. CDN page cache rule includes the tested hostname (production/CDN only)
7. runtime-only gates unresolved are marked `RUNTIME_DEPENDENCY`

Expected header when all pass (default Deco behavior):

`public, max-age=90, s-maxage=90, stale-while-revalidate=30`

(or custom value from `DECO_PAGE_CACHE_CONTROL`)

Flag nuance (common source of confusion):

- `flag.value` is whether matcher condition matched (`true` or `false`).
- `flag.cacheable` is metadata from matcher module (usually `export const cacheable = true|false`).
- HTML cache gate checks `cacheable`, not `value`.
- Therefore, page cache can be blocked even if a flag is `value=false`, when `cacheable` is missing/false.
- Typical blockers: matcher without `cacheable`, legacy matcher defaulting to undefined, or an intentionally non-cacheable personalized flag.

### 4. Compare failing vs working page

Run the same checks for a working route and find the first diverging gate.

### 5. Report root cause and fix

Always return:

- one-line root cause
- why only some pages are affected
- minimal safe fix
- before/after validation commands
- risk note (avoid caching user-specific content)

## Common Root Causes

- `DECO_PAGE_CACHE_ENABLED` disabled in target environment
- runtime-only opt-in gate not satisfied (`RUNTIME_DEPENDENCY`, outside site repo scope)
- `Set-Cookie` injected by personalization/session code
- evaluated matcher flags missing `cacheable: true`
- response is not HTML
- handler already sets restrictive `Cache-Control`
- CDN page cache rule does not include the tested hostname (production/CDN only)

## Output Template

```md
Root cause: <one line>
First failed gate: <gate name>
Scope: <SITE_REPO | RUNTIME_DEPENDENCY | CDN_RULE>

Evidence:
- <headers + file/line references>

Fix:
- <minimal change>

Validation:
- <before command>
- <after command>

Risk:
- <what to watch>
```
