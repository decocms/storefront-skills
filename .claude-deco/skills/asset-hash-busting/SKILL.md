---
name: asset-hash-busting
description: Use when auditing or fixing static asset cache busting in deco storefronts — especially when assets lack content hashes in the URL, when hash lookups always return null, or when `assets.gen.ts` was generated on Windows (keys contain backslashes or directory prefixes).
---

# Asset Hash Busting

Deco storefronts use content-hashed URLs for static assets (`/sprites.svg?__deco_c=c296a2c7`) to enable immutable CDN caching. Two common failure patterns break this system silently.

---

## Pattern 1 — `hash-assets.ts` generated on Windows

### Symptom
`assets.gen.ts` has keys with backslashes and directory prefixes:
```ts
"static-cv\\sprites.svg": "c296a2c7"  // ❌ Windows-generated
```
Instead of the expected Unix format:
```ts
"sprites.svg": "c296a2c7"             // ✅ correct
```

### Root cause
`scripts/hash-assets.ts` strips the directory with:
```ts
const relativePath = entry.path.replace(`${staticDir}/`, "");
```
On Windows, `entry.path` uses `\`, so the replace finds nothing and the full path becomes the key.

### Fix — normalize paths in `hash-assets.ts`
```ts
const relativePath = entry.path
  .replace(/\\/g, "/")                // normalize Windows separators first
  .replace(`${staticDir}/`, "");
```
Then regenerate: `deno task hash-assets` (must run on macOS/Linux or after the fix above).

---

## Pattern 2 — `asset()` called with query string in the path

### Symptom
```ts
const spritesUrl = asset("/sprites.svg?v=2");  // ❌
```
The `?v=2` becomes part of the lookup key (`"sprites.svg?v=2"`), which never matches any hash entry. The URL is returned as-is and content-based cache busting doesn't work.

### Fix
```ts
// ✅ no query string in the path — the hash function adds it
const spritesUrl = asset("/sprites.svg");
```

---

## Pattern 3 — `asset()` called inside a component render

### Symptom
```ts
function Icon({ id }: Props) {
  const spritesUrl = asset("/sprites.svg");  // ❌ recomputed on every render
  ...
}
```

### Fix — hoist to module level
```ts
const spritesUrl = asset("/sprites.svg");   // ✅ computed once

function Icon({ id }: Props) {
  ...
}
```

---

## Quick audit checklist

1. Open `sdk/assets.gen.ts` — do keys look like `"sprites.svg"` or `"static-cv\\sprites.svg"`?
   - If backslashes → fix `hash-assets.ts` and regenerate
2. Grep for `asset(` calls — do any paths include `?` query params?
   - If yes → remove the query string from the path
3. Are constant `asset()` calls inside component functions?
   - If yes → hoist to module level

## Verification

After fixing, confirm hashes are actually applied:
```ts
asset("/sprites.svg")
// should return: "/sprites.svg?__deco_c=c296a2c7"
// not: "/sprites.svg"
```
