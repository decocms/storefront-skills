---
name: new-page
description: Create a new page on a deco.cx storefront — including route, metadata, sections, and dynamic route params (e.g. /category/:slug). Use when the user asks to add, create, or scaffold a new page or route in a deco site, or to pass a URL param into a section/loader.
---

# Creating a New Page on deco.cx

Pages on deco.cx are JSON-driven route definitions. Each page has a path, metadata, and an ordered list of sections. Pages are managed through the Admin UI or via the `updateJson` / `patchFile` tools.

---

## Step 1 — Understand the page structure

A deco page is a JSON object with this shape:

```json
{
  "__resolveType": "website/pages/Page.tsx", // NECESSARY
  "path": "/my-new-page",
  "name": "My New Page",
  "sections": [
    {
      "__resolveType": "site/sections/Hero.tsx",
      "title": "Welcome",
      "description": "This is the hero section"
    },
    {
      "__resolveType": "site/sections/ProductShelf.tsx"
    }
  ]
}
```

- `__resolveType`: definition of the Page
- `path`: the URL route, e.g. `/about`, `/landing/promo`. For dynamic pages use path params: `/:slug/p`, `/category/:slug`, `/:slug*` (wildcard for nested paths)
- `name`: human-readable label shown in the Admin
- `sections`: ordered list of section blocks; each must have `__resolveType` pointing to the section file path

---

## Step 2 — Start with Header and Footer

Every page should open with a Header and close with a Footer. These are almost always saved as **global sections** — a single shared JSON block reused across all pages so changes propagate site-wide.

**Before adding anything, inspect an important page (e.g. Home) to find the exact header and footer blocks being used there.** Copy them verbatim into the new page so branding, navigation, and layout stay consistent.

Look for the home page or another key page and read its `sections` array. The header is typically the first section and the footer the last. They usually look like:

```json
{
  "__resolveType": "Header - 01",
}
```

The exact shape varies by site — always copy from an existing page rather than writing from scratch.

**Page skeleton with header + footer:**

```json
{
  "sections": [
    { /* header — copied from home page */ },
    { /* SEO section */ },
    { /* page-specific sections */ },
    { /* footer — copied from home page */ }
  ]
}
```

---

## Step 3 — Create the page via the Admin or updateJson

Use `updateJson` to create or modify the page JSON. When adding sections to an existing page:

- **Add** a section at position N (0-indexed): key `["sections", N]` with `replaceOrAdd: "add"`
- **Replace** a section at position N: key `["sections", N]` with `replaceOrAdd: "replace"`
- **Remove** a section at position N: key `["sections", N]`, `newValue: undefined`

Example — add a new section at the top of the page (position 0):

```json
{
  "__resolveType": "site/sections/Hero.tsx",
  "title": "New Hero",
  "description": "Added via updateJson"
}
```

Call `updateJson` with:
- `key`: `["sections", 0]`
- `newValue`: the JSON above
- `replaceOrAdd`: `"add"`

---

## Step 4 — Create sections needed for the page

If the page requires a section that does not yet exist, create it first. Follow the **new-section** skill:

1. Scaffold the section at `sections/MySectionName.tsx`
2. Ensure props are typed with TypeScript
3. No client-side code in the section file (use Islands instead)
4. Add it to the page using `updateJson`

The `__resolveType` value must match the file path exactly:
- File at `sections/Hero.tsx` → `"__resolveType": "site/sections/Hero.tsx"`
- File at `sections/product/Shelf.tsx` → `"__resolveType": "site/sections/product/Shelf.tsx"`

---

## Step 5 — Configure page metadata (SEO)

If the page needs SEO metadata, add a `SEO` section or configure the page-level meta. Most deco sites have an `SEO` section available:

```json
{
  "__resolveType": "website/sections/Seo/SeoV2.tsx",
  "title": "Page Title | Brand",
  "description": "Meta description for this page",
  "image": "https://example.com/og-image.jpg",
  "canonical": "https://www.mysite.com/my-new-page"
}
```

Insert it as the **first** section on the page.

---

## Step 6 — Add dynamic data with Loaders

To populate a section with live data (products, content, etc.), wire a loader to the section's props.

### Option A — Inline loader inside the section

Add `export const loader` inside the section file. It runs server-side and enriches the section's props before render.

### Option B — External loader selected in Admin

Create a loader at `loaders/myData.ts` whose return type matches the section prop type. In the Admin, the loader becomes selectable as a content source for that prop.

### Option C — invoke from another loader

```ts
const data = await ctx.invoke["site/loaders/myLoader.ts"]({ count: 1 });
```

---

## Step 7 — Dynamic routes: pass a URL param into a section or loader

A dynamic page declares params in its `path` (`/category/:slug`, `/:slug/p`, `/:slug*`). But a section or loader does **not** read the URL itself — the value is injected into a prop by the built-in `website/functions/requestToParam.ts` resolver. This is the missing link between a `:param` in the path and the code that needs it.

Set the target prop to a `requestToParam` block naming the param:

```json
{
  "__resolveType": "site/sections/CategoryPage.tsx",
  "slug": {
    "__resolveType": "website/functions/requestToParam.ts",
    "param": "slug"
  }
}
```

At request time the framework matches the URL against the page `path`, then resolves that block to the actual segment — so on `/category/shoes` the section receives `slug: "shoes"` before its loader/render runs.

### Feed the param into a loader (the common case)

Usually the param drives a data fetch (a PDP by slug, a PLP by category). Point the **loader's** prop at `requestToParam`, so the loader receives the resolved value:

```json
{
  "__resolveType": "site/sections/ProductShelf.tsx",
  "products": {
    "__resolveType": "site/loaders/productList.ts",
    "slug": {
      "__resolveType": "website/functions/requestToParam.ts",
      "param": "slug"
    }
  }
}
```

The loader runs server-side as `(props, req, ctx)` and reads `props.slug` already resolved to the URL segment — no manual URL parsing. Route params are **not** exposed on `ctx`, so `requestToParam` is the intended way to reach them.

**Notes**
- `param` must match the name in the page `path` exactly (`:slug` → `"param": "slug"`).
- Pages are matched by path specificity, so a param route (`/category/:slug`) wins over a broader/wildcard one when both could match.
