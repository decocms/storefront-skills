---
name: variants
description: "Configure deco.cx Variants — the mechanism that swaps the value of a section, page, image, message, or ANY custom-typed prop based on a matcher rule (device, cookie, date, A/B test, geo, path, query string, etc.). Use when the user asks to A/B test a section, personalize a page per audience/segment, show different banners per device or location, schedule a promotion by date/cron, add a new variant-able type (promotion, VTEX segment, product list, menu items), write a custom matcher, or generally wire up `website/flags/multivariate*` in `.deco/blocks/*.json`. Covers the JSON shape (`variants: [{ value, rule }]`), the resolution order (first match wins, catch-all last), every built-in matcher (`always`, `never`, `device`, `date`, `cron`, `random`, `cookie`, `host`, `pathname`, `queryString`, `userAgent`, `location`, `site`, `environment`, `multi`, `negate`), how to compose them with `multi` (and/or) and `negate`, the 8-line boilerplate to create your own `flags/multivariate/<type>.ts`, the shape of a custom `matchers/<name>.ts`, and links to `[[cacheable-matchers]]` for the caching trade-offs."
---

# Variants on deco.cx

**Variants** let a single block position render **different content** for different visitors based on a **matcher rule**. Everywhere the storefront resolves a section, page, image, or message, you can wrap it in a `multivariate*` flag so the resolver picks a value at request time.

They power A/B tests, per-device UIs, geo-targeted banners, scheduled campaigns (dates/cron), pathname- or query-string-driven variants, and audience segmentation — all configured **in the block JSON**, no code change.

For the caching implications of matchers (edge cache, cold-visitor bias, `cacheable=true`), see [[cacheable-matchers]].

---

## The built-in flag types

All four have the exact same JSON shape (`{ variants: [...] }`). They differ only in the **type of value** they resolve to:

| Flag | `__resolveType` | Value type |
|---|---|---|
| **Section Variants** | `website/flags/multivariate/section.ts` | A single section block |
| **Page Variants** | `website/flags/multivariate.ts` (page-level) | The array of sections for a page |
| **Image Variants** | `website/flags/multivariate/image.ts` | An `ImageWidget` (image URL) |
| **Message Variants** | `website/flags/multivariate/message.ts` | A `string` |

The most common one on storefronts is **Section Variants** — swap a specific section (a banner, a shelf, a hero) per visitor.

---

## JSON shape

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { /* the section (or page/image/message) to render */ },
      "rule": { /* the matcher — one of the matchers documented below */ }
    },
    {
      "value": { /* fallback for everyone else */ },
      "rule": { "__resolveType": "website/matchers/always.ts" }
    }
  ]
}
```

**Resolution semantics**

- The resolver evaluates each variant's `rule` **in order**, top to bottom.
- The **first** variant whose rule returns `true` wins; the rest are skipped.
- If no rule matches, the flag resolves to `undefined` (nothing renders in that slot).
- The idiomatic pattern is to put the **catch-all `always` variant last**, so every visitor gets a value.

---

## Creating your own flag type

You are not limited to sections/pages/images/messages — any prop of any type can become variant-able. A site declares a new flag type by dropping a file in `flags/multivariate/<name>.ts` that just wires the site's type into `apps/website/utils/multivariate.ts`. The whole file is 8 lines of boilerplate:

```ts
// flags/multivariate/promotion.ts
export { onBeforeResolveProps } from "apps/website/utils/multivariate.ts";
import multivariate, {
  MultivariateProps,
} from "apps/website/utils/multivariate.ts";
import { type MultivariateFlag } from "@deco/deco/blocks";
import { type Promotion } from "site/components/Session.tsx";

/**
 * @title Promotion Variants
 */
export default function Promotion(
  props: MultivariateProps<Promotion>,
): MultivariateFlag<Promotion> {
  return multivariate(props);
}
```

Once compiled, admins (and JSON blocks) can reference it as:

```json
{
  "__resolveType": "site/flags/multivariate/promotion.ts",
  "variants": [
    { "value": { /* a Promotion */ }, "rule": { /* any matcher */ } }
  ]
}
```

The variant shape (`{ value, rule }`) and matcher catalog are identical — the flag just changes what type `value` is.

**When to add a new flag type**: whenever a section prop that you'd like to A/B test isn't itself a section — e.g., a config object, a typed enum, an array of products, a menu tree. If you had to variant it today with `section.ts`, you'd need two full sections that differ only in one prop; a typed flag lets you swap just that prop.

**Pattern**: the file always looks the same — one import, one boilerplate function. Just change the generic type parameter and the file name. Add a `@title` JSDoc so it shows up nicely in the admin.

---

## Creating your own matcher

Same idea for matchers: drop a file in `matchers/<name>.ts` in the site and it's referenceable as `"__resolveType": "site/matchers/<name>.ts"`. A matcher is just a function `(props, ctx) => boolean` (or `Promise<boolean>`).

```ts
// matchers/url.ts
import { type MatchContext } from "@deco/deco/blocks";

export interface Props {
  includes?: string;
  match?: string;
}

/**
 * @title URL
 * @description Target users based on the full URL
 * @icon world-www
 */
const MatchUrl = ({ includes, match }: Props, { request }: MatchContext) => {
  const url = request.url;
  const regexMatch = match ? new RegExp(match).test(url) : true;
  const includesFound = includes ? url.includes(includes) : true;
  return regexMatch && includesFound;
};

export default MatchUrl;

// Uncomment ONLY if the matcher's result is fully determined by
// inputs the CDN cache key can capture — see [[cacheable-matchers]].
// export const cacheable = true;
```

**When to add a custom matcher**: whenever you want to gate variants on something the built-in matchers can't read — a product attribute of the current PDP, a commerce segment field, a custom cookie shape, an admin-baked URL list, etc.

**Caching**: always audit whether the matcher is safe to mark `cacheable = true` before shipping. See [[cacheable-matchers]] for the full decision table.

---

## Examples

### 1. Section shown only on desktop, fallback for everyone else

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { "__resolveType": "site/sections/DesktopOnlyHeader.tsx" },
      "rule": {
        "__resolveType": "website/matchers/device.ts",
        "desktop": true
      }
    },
    {
      "value": { "__resolveType": "site/sections/MobileHeader.tsx" },
      "rule": { "__resolveType": "website/matchers/always.ts" }
    }
  ]
}
```

### 2. Hide a section from all users (using `never`)

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { "__resolveType": "site/sections/AppOnlyBanner.tsx" },
      "rule": { "__resolveType": "website/matchers/never.ts" }
    }
  ]
}
```

`never` is the deco way of "temporarily disable" without deleting the block from the JSON.

### 3. A/B test — 30% of production traffic sees variant B

Save the composed matcher as its own block (say `MyABTest.json`) so multiple variants can reuse the same rule:

```json
// .deco/blocks/MyABTest.json
{
  "__resolveType": "website/matchers/multi.ts",
  "op": "and",
  "matchers": [
    { "__resolveType": "website/matchers/environment.ts", "environment": "production" },
    { "__resolveType": "website/matchers/random.ts", "traffic": 0.3 }
  ]
}
```

Then reference it from a section variant:

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { "__resolveType": "site/sections/HeroVariantB.tsx" },
      "rule": { "__resolveType": "MyABTest" }
    },
    {
      "value": { "__resolveType": "site/sections/HeroVariantA.tsx" },
      "rule": { "__resolveType": "website/matchers/always.ts" }
    }
  ]
}
```

Because `random.ts` exports `sticky = "session"`, once a visitor is bucketed they keep the same variant across page loads (persisted in a `deco_matcher_*` cookie).

---

## Matchers — the `rule` catalog

Every matcher lives at `website/matchers/<name>.ts` in `apps/` and is referenced in JSON via `"__resolveType": "website/matchers/<name>.ts"` plus its props.

### `always.ts` — match every request

```json
{ "__resolveType": "website/matchers/always.ts" }
```

Use as the last variant's `rule` to make a catch-all. `cacheable = true`.

### `never.ts` — match nothing

```json
{ "__resolveType": "website/matchers/never.ts" }
```

Use to temporarily hide a variant without removing it. `cacheable = true`.

### `device.ts` — mobile / tablet / desktop

```json
{
  "__resolveType": "website/matchers/device.ts",
  "mobile": true,
  "tablet": false,
  "desktop": true
}
```

Any of the three booleans can be set. The matcher fires if the visitor's device is in the enabled set. `cacheable = true`.

### `date.ts` — date/time window

```json
{
  "__resolveType": "website/matchers/date.ts",
  "start": "2026-07-01T00:00:00-03:00",
  "end":   "2026-07-31T23:59:59-03:00"
}
```

Both bounds are optional. Omit `start` for "until", omit `end` for "from". Values are ISO date-time strings. `cacheable = true`.

### `cron.ts` — recurring schedule

```json
{
  "__resolveType": "website/matchers/cron.ts",
  "cron": "* 0-23 * * WED"
}
```

Standard 5-field cron. Minute precision. Example above: "any minute of any hour on Wednesday". `cacheable = true`.

### `random.ts` — A/B testing by traffic percentage

```json
{
  "__resolveType": "website/matchers/random.ts",
  "traffic": 0.3
}
```

`traffic` is a number from `0` to `1` — the share of visitors who match. **Sticky per session** (persisted in `deco_matcher_*` cookie), so a visitor keeps the same variant across page loads. `cacheable = true`, with the cold-visitor bias described in [[cacheable-matchers]].

### `cookie.ts` — visitor has cookie `name = value`

```json
{
  "__resolveType": "website/matchers/cookie.ts",
  "name": "user_type",
  "value": "premium"
}
```

Exact-match on the cookie value. **Not** cacheable by default (would need `cacheable=true` in the matcher and the cookie in the CDN cache key — see [[cacheable-matchers]]).

### `host.ts` — request Host header contains / matches

```json
{
  "__resolveType": "website/matchers/host.ts",
  "includes": "www.example.com"
}
```

Or a regex:

```json
{
  "__resolveType": "website/matchers/host.ts",
  "match": "^(www|m)\\.example\\.com$"
}
```

Both fields optional; if both set, both must be true. `cacheable = true`.

### `pathname.ts` — URL path equals / includes / template

Equals:
```json
{
  "__resolveType": "website/matchers/pathname.ts",
  "case": { "type": "Equals", "pathname": "/promo" }
}
```

Includes:
```json
{
  "__resolveType": "website/matchers/pathname.ts",
  "case": { "type": "Includes", "pathname": "/promo" }
}
```

Template (URL-pattern style with `:params`):
```json
{
  "__resolveType": "website/matchers/pathname.ts",
  "case": { "type": "Template", "pathname": "/:slug/p" }
}
```

Set `"negate": true` on `case` to invert the result. `cacheable = true`.

### `queryString.ts` — URL search params

```json
{
  "__resolveType": "website/matchers/queryString.ts",
  "conditions": [
    { "param": "utm_source", "case": { "type": "Equals", "value": "instagram" } },
    { "param": "page",       "case": { "type": "GreaterOrEquals", "value": "2" } },
    { "param": "debug",      "case": { "type": "Exists" } }
  ]
}
```

Available `case.type`: `Equals`, `Greater`, `Lesser`, `GreaterOrEquals`, `LesserOrEquals`, `Includes`, `Exists`. All conditions must be true (AND). `cacheable = true` — **but only safe if the CDN cache key preserves those params**. UTM/gclid/fbclid are typically stripped; do **not** use them for cacheable variants (see [[cacheable-matchers]]).

### `userAgent.ts` — UA string contains / matches

```json
{
  "__resolveType": "website/matchers/userAgent.ts",
  "includes": "iPhone"
}
```

Or regex:
```json
{
  "__resolveType": "website/matchers/userAgent.ts",
  "match": "Instagram|FBAN|FBAV"
}
```

Not cacheable by default (most CDNs don't include full UA in the cache key).

### `location.ts` — geo (Cloudflare headers)

```json
{
  "__resolveType": "website/matchers/location.ts",
  "includeLocations": [
    { "country": "BR", "regionCode": "SP" },
    { "country": "BR", "city": "Rio de Janeiro" },
    { "coordinates": "-22.9068,-43.1729,5000" }
  ],
  "excludeLocations": [
    { "country": "BR", "regionCode": "AC" }
  ]
}
```

- Reads Cloudflare's `cf-ipcity`, `cf-ipcountry`, `cf-region-code`, `cf-iplatitude`, `cf-iplongitude`.
- `coordinates` is `"lat,lng,radiusInMeters"` — visitors within `radius` of the point match.
- Rule: fires if the visitor is in ANY `includeLocations` and NOT in any `excludeLocations`.
- If `includeLocations` is empty/omitted, only `excludeLocations` is checked (so an empty include = "everywhere except excludes"; a missing include = "everywhere").

Not cacheable by default.

### `site.ts` — deco site ID equals

```json
{
  "__resolveType": "website/matchers/site.ts",
  "siteId": 12345
}
```

Useful in multi-site apps. `cacheable = true`.

### `environment.ts` — production vs development

```json
{
  "__resolveType": "website/matchers/environment.ts",
  "environment": "production"
}
```

`production` fires when `DENO_DEPLOYMENT_ID` is set (i.e., deployed); `development` fires locally. `cacheable = true`.

### `multi.ts` — combine matchers with AND / OR

```json
{
  "__resolveType": "website/matchers/multi.ts",
  "op": "and",
  "matchers": [
    { "__resolveType": "website/matchers/host.ts", "includes": "example.com" },
    { "__resolveType": "website/matchers/device.ts", "mobile": true },
    { "__resolveType": "website/matchers/random.ts", "traffic": 0.5 }
  ]
}
```

`op` is `"and"` or `"or"`. Composes arbitrarily — nest `multi` inside `multi` for complex logic. `cacheable = true` **only if every nested matcher is cacheable**.

### `negate.ts` — invert a matcher

```json
{
  "__resolveType": "website/matchers/negate.ts",
  "matcher": {
    "__resolveType": "website/matchers/device.ts",
    "mobile": true
  }
}
```

Above matches "not mobile" (i.e., tablet or desktop). `cacheable = true` if the wrapped matcher is cacheable.

---

## Reusing matchers as named blocks

Any matcher can be saved as its own block file in `.deco/blocks/`. Once saved, other variants reference it by name — the CMS resolves the reference at request time:

```json
// .deco/blocks/MyABTest.json
{
  "__resolveType": "website/matchers/multi.ts",
  "op": "and",
  "matchers": [ /* ... */ ]
}
```

```json
// used elsewhere
"rule": { "__resolveType": "MyABTest" }
```

Do this whenever the same rule powers multiple variants — it keeps them in sync when you change traffic %, dates, or geo.

---

## Common patterns

### Show a section only on desktop

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { "__resolveType": "site/sections/DesktopBanner.tsx" },
      "rule": { "__resolveType": "website/matchers/device.ts", "desktop": true }
    }
  ]
}
```

No fallback → renders nothing on mobile/tablet.

### Scheduled promotion (auto on/off by date)

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { "__resolveType": "site/sections/BlackFridayBanner.tsx" },
      "rule": {
        "__resolveType": "website/matchers/date.ts",
        "start": "2026-11-25T00:00:00-03:00",
        "end":   "2026-11-30T23:59:59-03:00"
      }
    },
    {
      "value": { "__resolveType": "site/sections/DefaultBanner.tsx" },
      "rule": { "__resolveType": "website/matchers/always.ts" }
    }
  ]
}
```

### 50/50 A/B test on a single page

```json
{
  "__resolveType": "website/flags/multivariate/section.ts",
  "variants": [
    {
      "value": { "__resolveType": "site/sections/HeroB.tsx" },
      "rule": { "__resolveType": "website/matchers/random.ts", "traffic": 0.5 }
    },
    {
      "value": { "__resolveType": "site/sections/HeroA.tsx" },
      "rule": { "__resolveType": "website/matchers/always.ts" }
    }
  ]
}
```

### Different banner per country

```json
{
  "__resolveType": "website/flags/multivariate/image.ts",
  "variants": [
    {
      "value": "https://cdn.example.com/br-hero.webp",
      "rule": {
        "__resolveType": "website/matchers/location.ts",
        "includeLocations": [ { "country": "BR" } ]
      }
    },
    {
      "value": "https://cdn.example.com/us-hero.webp",
      "rule": {
        "__resolveType": "website/matchers/location.ts",
        "includeLocations": [ { "country": "US" } ]
      }
    },
    {
      "value": "https://cdn.example.com/global-hero.webp",
      "rule": { "__resolveType": "website/matchers/always.ts" }
    }
  ]
}
```

---

## Gotchas

- **Order matters** — first matching rule wins. Put narrow rules first, `always` last.
- **Missing catch-all** — if no `always` variant, visitors outside every rule see nothing in that slot. Sometimes desired (e.g., "desktop-only banner"), often a bug.
- **`random.ts` is sticky per session** — a visitor stays in one bucket across page loads (cookie `deco_matcher_<hash>`). Great for consistent UX, but see the cold-visitor bias in [[cacheable-matchers]] before running content A/B tests behind edge caching.
- **Not every matcher is cacheable** — `cookie`, `userAgent`, `location`, `cron` do NOT export `cacheable = true` in `apps@0.154.0` as of writing. Pages using them go `Cache-Control: no-store`. See [[cacheable-matchers]] for the full table and how to add `cacheable=true` safely.
- **`queryString` + tracking params** — matching on `utm_*`/`gclid`/`fbclid` breaks caching silently, because CDNs strip those from the cache key. Different variants can end up in the same cache box.
- **Nested variants** — you can put a `website/flags/multivariate/section.ts` **inside** a `website/sections/Rendering/Lazy.tsx` (defer resolution + rendering to client), or one multivariate inside another. Just remember: each nested matcher must also be cacheable for the page to cache.
