---
name: figma-to-deco
description: Implement a complete Figma design into a Deco storefront — from reading pages and sections, downloading assets, configuring loaders, to QA with Playwright and performance auditing. Use when the user provides a Figma link and wants it built as a Deco site.
---

# Figma to Deco Implementation Skill

End-to-end workflow for turning a Figma design file into a fully functional Deco storefront. Covers section creation, asset management, loader configuration, visual QA (desktop + mobile), performance auditing, and functional E2E checks.

## When to Use This Skill

- User shares a Figma link and wants sections built in Deco
- Migrating a design system from Figma into a Deco storefront
- Rebuilding or redesigning an existing Deco site from new mockups
- Any "implement this Figma" request targeting a Deco project

## Prerequisites

- A Figma file URL (format: `https://figma.com/design/:fileKey/:fileName`)
- A Deco storefront repository cloned locally
- Figma MCP tools available (get_metadata, get_design_context, get_screenshot, use_figma)
- Playwright installed for QA phase

---

## Workflow Overview

```
Step 1 — Read & Map        Figma pages -> section inventory
Step 2 — Implement         Create .tsx sections with Tailwind + Preact
Step 3 — Assets            Download images, upload to Deco assets
Step 4 — Loaders           Configure data sources for dynamic sections
Step 5 — Visual QA         Playwright screenshots vs Figma baseline (desktop + mobile)
Step 6 — Adjustments       Fix every mismatch found in QA
Step 7 — Performance       Run performance skill on each section
Step 8 — Functional E2E    Menu, search, cart, checkout flows (desktop + mobile)
```

---

## Step 1: Read & Map Figma Pages

### 1.1 Extract file structure

Use `get_metadata` on the root node (`0:1`) to list all pages and top-level frames:

```
Tool: get_metadata
  fileKey: <extracted from URL>
  nodeId: "0:1"
```

This returns an XML tree with page names, frame names, node IDs, positions, and sizes.

### 1.2 Build section inventory

For each page in the Figma file:

1. List all top-level frames — each frame typically maps to one **section**
2. Record for each frame:
   - `nodeId` — needed for get_design_context
   - `name` — becomes the section file name (e.g., `Hero`, `ProductShelf`, `Footer`)
   - `page` — which Figma page it belongs to (Home, PLP, PDP, etc.)
   - `width` — detect if it's a desktop frame (>=1024) or mobile frame (<1024)
   - `position` — ordering on the page (top to bottom = render order)

3. Group frames by page and identify:
   - **Shared sections** that appear on multiple pages (Header, Footer, Newsletter)
   - **Page-specific sections** (HeroBanner on Home, ProductGrid on PLP)
   - **Desktop vs Mobile variants** of the same section

### 1.3 Output: Section Map

Produce a markdown table before proceeding:

```markdown
| # | Section Name       | Figma Page | Node ID   | Type     | Variants     |
|---|--------------------|------------|-----------|----------|--------------|
| 1 | Header             | Global     | 123:456   | Shared   | Desktop, Mobile |
| 2 | HeroBanner         | Home       | 123:789   | Specific | Desktop, Mobile |
| 3 | ProductShelf       | Home       | 124:100   | Specific | Desktop only |
| 4 | CategoryGrid       | PLP        | 125:200   | Specific | Desktop, Mobile |
| ...                                                                        |
```

**Present this table to the user for confirmation before implementing.**

---

## Step 2: Implement Sections

### 2.1 Get design context for each section

For each section in the inventory, call `get_design_context`:

```
Tool: get_design_context
  fileKey: <fileKey>
  nodeId: <section nodeId>
  clientLanguages: "typescript,html,css"
  clientFrameworks: "preact"
```

This returns:
- **Reference code** — HTML/CSS structure to adapt
- **Screenshot** — visual reference
- **Asset download URLs** — images used in the section

### 2.2 Also get the mobile variant

If a mobile variant exists (separate frame), call `get_design_context` on the mobile node too. If there is no separate mobile frame, get a screenshot of the section and use responsive Tailwind classes to implement mobile behavior based on the desktop design proportions.

### 2.3 Create section file

**Path:** `sections/<Category>/<SectionName>.tsx`

Follow the Deco section pattern:

```tsx
import type { ImageWidget } from "apps/admin/widgets.ts";

/** @titleBy title */
export interface Props {
  /** @title Hero Image */
  image?: ImageWidget;
  /** @title Title */
  title?: string;
  /** @title Subtitle */
  subtitle?: string;
  /** @title CTA Text */
  ctaText?: string;
  /** @title CTA Link */
  ctaHref?: string;
}

export default function HeroBanner({
  image = "/placeholder.png",
  title = "Default Title",
  subtitle = "Default subtitle text",
  ctaText = "Shop Now",
  ctaHref = "/",
}: Props) {
  return (
    <section class="relative w-full">
      {/* Desktop */}
      <div class="hidden md:block">
        {/* Desktop layout */}
      </div>
      {/* Mobile */}
      <div class="block md:hidden">
        {/* Mobile layout */}
      </div>
    </section>
  );
}

export function LoadingFallback() {
  return <div class="h-[400px] w-full animate-pulse bg-gray-100" />;
}
```

### Rules for section creation

1. **Use `class` not `className`** — Preact + Deco convention
2. **Tailwind CSS only** — no inline styles, no CSS modules
3. **No client-side behavior** — no hooks, no onClick, no useState. Use Islands for interactivity
4. **Typed props with JSDoc** — `@title` for admin labels, `@hide` for internal props
5. **Default values** — every prop must have a sensible default matching the Figma design
6. **Responsive** — use Tailwind breakpoints (`md:`, `lg:`) for desktop/mobile
7. **`LoadingFallback` export** — always include a skeleton loader
8. **Widget types** — use `ImageWidget` for images, `TextArea` for rich text, `Color` for colors
9. **100% design fidelity** — match Figma spacing, colors, typography, and layout exactly

### 2.4 Get Figma variables for theme matching

Use `get_variable_defs` to extract design tokens (colors, spacing, fonts):

```
Tool: get_variable_defs
  fileKey: <fileKey>
  nodeId: <any section nodeId>
```

Map Figma variables to Tailwind theme tokens. If the Deco site has a `tailwind.config.ts` or theme, match Figma colors to existing tokens. If new tokens are needed, extend the theme.

### 2.5 Islands for interactive elements

If a section requires client-side behavior (carousel, accordion, tabs, dropdown menu):

1. Create the interactive part as an Island in `islands/<ComponentName>.tsx`
2. Import and use the Island inside the section
3. Keep the Island minimal — only the interactive logic

```tsx
// islands/Carousel.tsx
import { useSignal } from "@preact/signals";

interface Props {
  children: preact.ComponentChildren;
}

export default function Carousel({ children }: Props) {
  const currentSlide = useSignal(0);
  // Client-side carousel logic
}
```

---

## Step 3: Download & Place Assets

### 3.1 Collect asset URLs

From each `get_design_context` response, collect the `downloadUrls` map. This contains all images, icons, and illustrations used in the section.

### 3.2 Download images

For each asset URL:

```bash
curl -L -o /tmp/<asset-name>.png "<download-url>"
```

### 3.3 Upload to Deco assets

Use the Deco **upload** tool to save assets to the site's asset library:

```
Tool: upload
  file: /tmp/<asset-name>.png
```

Record the returned asset URL (e.g., `https://deco-sites-assets.s3.sa-east-1.amazonaws.com/...`).

### 3.4 Place assets in sections

Update each section's `defaultProps` or the page JSON block to reference the uploaded asset URL. The image must appear in the exact position shown in the Figma design.

### 3.5 Alternative: Figma "Export Original Images" plugin

If the Figma file uses the "Export Original Images" plugin, assets may already be exported at original resolution. Prefer these over Figma's rendered exports when available — they preserve quality.

---

## Step 4: Configure Loaders

### 4.1 Identify dynamic sections

Review each section and classify its data source:

| Data Type | Loader Path | Example Section |
|-----------|-------------|-----------------|
| Product list | `vtex/loaders/intelligentSearch/productList.ts` | ProductShelf, ProductGrid |
| Product page | `vtex/loaders/intelligentSearch/productDetailsPage.ts` | ProductDetails |
| Category tree | `vtex/loaders/categories/tree.ts` | CategoryMenu, MegaMenu |
| Search results | `vtex/loaders/intelligentSearch/productListingPage.ts` | SearchResults, PLP |
| Blog posts | `spire/loaders/BlogpostList.ts` | BlogPosts |
| Static content | No loader needed | HeroBanner, Newsletter |

### 4.2 Add inline loaders for simple data

```tsx
import type { AppContext } from "apps/site.ts";

export const loader = async (props: Props, _req: Request, ctx: AppContext) => {
  const products = await ctx.invoke.vtex.loaders.intelligentSearch.productList({
    query: props.query,
    count: props.count ?? 12,
  });
  return { ...props, products };
};
```

### 4.3 Use external loaders for reusable data

When multiple sections need the same data, use an external loader and type-match the prop:

```tsx
// In the section
export interface Props {
  products?: Product[] | null;
}
```

This lets the Admin user pick any loader that returns `Product[]`.

### 4.4 Ask user for integration details

If the data source is unclear or requires API credentials, **ask the user**:

- Which e-commerce platform? (VTEX, Shopify, VNDA, Wake)
- API credentials or account name?
- Specific collection IDs, category paths, or search terms?

---

## Step 5: Visual QA with Playwright

### 5.1 Capture Figma baselines

For each section, capture Figma screenshots as baseline:

```
Tool: get_screenshot
  fileKey: <fileKey>
  nodeId: <section nodeId>
```

Save these to `tests/visual-qa/baselines/`:

```
tests/visual-qa/
  baselines/
    desktop/
      01-Header.png
      02-HeroBanner.png
      03-ProductShelf.png
      ...
    mobile/
      01-Header.png
      02-HeroBanner.png
      ...
```

### 5.2 Capture implementation screenshots

Use Playwright to screenshot each section as rendered in the Deco site:

```typescript
import { test } from "@playwright/test";

const SECTIONS = [
  { name: "Header", selector: "header", order: 1 },
  { name: "HeroBanner", selector: '[data-section="HeroBanner"]', order: 2 },
  // ... from section inventory
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} visual QA`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const section of SECTIONS) {
      test(`${section.name} matches Figma`, async ({ page }) => {
        await page.goto("http://localhost:8000");

        // Scroll to section
        const el = page.locator(section.selector).first();
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500); // wait for lazy load

        // Screenshot section
        await el.screenshot({
          path: `tests/visual-qa/actual/${viewport.name}/${section.order}-${section.name}.png`,
        });
      });
    }
  });
}
```

### 5.3 Compare and generate adjustment list

For each section, compare the Figma baseline screenshot with the Playwright screenshot. Identify mismatches:

- **Spacing** — margins, paddings, gaps
- **Typography** — font size, weight, line height, letter spacing
- **Colors** — backgrounds, text colors, borders
- **Layout** — flex direction, alignment, grid columns
- **Images** — sizing, aspect ratio, object-fit
- **Responsiveness** — mobile layout differences

Output an adjustment list:

```markdown
## Visual QA Adjustments

### Desktop
| Section | Issue | Figma | Actual | Fix |
|---------|-------|-------|--------|-----|
| HeroBanner | Title font size | 48px | 36px | Change text-4xl to text-5xl |
| ProductShelf | Card gap | 24px | 16px | Change gap-4 to gap-6 |
| Footer | BG color | #1a1a1a | #000000 | Change bg-black to bg-[#1a1a1a] |

### Mobile
| Section | Issue | Figma | Actual | Fix |
|---------|-------|-------|--------|-----|
| Header | Menu icon missing | Present | Missing | Add hamburger Island |
| HeroBanner | Image height | 300px | 400px | Add h-[300px] md:h-[400px] |
```

---

## Step 6: Implement Adjustments

For each item in the adjustment list:

1. Apply the fix to the section `.tsx` file
2. Re-screenshot with Playwright
3. Confirm the mismatch is resolved
4. Mark the adjustment as done

Repeat until all sections pass visual QA on both **desktop** and **mobile** viewports.

---

## Step 7: Performance Audit

Run the performance skills on every section created. Reference the existing skills:

### 7.1 Image optimization

Use skill: `.claude-performance/skills/image-optimizer/SKILL.md`

For each section:
- Verify images use proper formats (AVIF > WebP > JPEG)
- Check lazy loading on below-fold images
- Verify `width`/`height` attributes are set (CLS prevention)
- Ensure hero/above-fold images are preloaded

### 7.2 HTML size optimization

Use skill: `.claude-performance/skills/html-size-optimizer/SKILL.md`

For each section:
- Check for unnecessarily large HTML output
- Verify no inline base64 images
- Ensure Tailwind classes are not bloated

### 7.3 Section-level performance

For each created section, verify:

- [ ] `LoadingFallback` is exported and has correct dimensions
- [ ] No blocking resources in the section
- [ ] Lazy sections (below fold) use deferred loading via Deco's render
- [ ] Server-side data fetching is cached appropriately
- [ ] No N+1 loader calls (use `deduplicate-loaders` skill if needed)

---

## Step 8: Functional E2E Testing

Use skill: `.claude-deco/skills/e2e-testing/SKILL.md`

### 8.1 Structural checks

For each page, verify the sections render in the correct order and are functional:

| Check | Desktop | Mobile |
|-------|---------|--------|
| Header renders with logo, nav, search, cart icon | Yes | Yes (hamburger menu) |
| Navigation menu opens and links work | Click nav items | Tap hamburger > menu items |
| Search opens, accepts input, shows results | Search bar | Search icon > overlay |
| Footer renders with all links | Yes | Yes (stacked layout) |
| Hero banner displays correct image and CTA | Yes | Yes (responsive image) |
| Product shelf scrolls/pages | Arrows or scroll | Swipe or scroll |

### 8.2 E-commerce flow (if applicable)

Run the full e-commerce E2E flow from the e2e-testing skill:

```
Home -> PLP -> PDP -> Add to Cart -> Minicart
```

On **both desktop and mobile** viewports.

### 8.3 Specific component checks

- **Menu/MegaMenu**: Opens on hover (desktop) / tap (mobile), all categories render, links navigate correctly
- **Search**: Opens, shows suggestions, results page loads with products
- **Minicart**: Opens, shows added products, quantity updates, remove works
- **Newsletter**: Form submits, validation works
- **Carousel/Slider**: Navigation works, autoplay if designed, touch swipe on mobile

### 8.4 Mobile-specific checks

- [ ] Touch targets are at least 44x44px
- [ ] No horizontal scroll overflow
- [ ] Text is readable without zooming (min 16px body)
- [ ] Fixed/sticky elements don't overlap content
- [ ] Hamburger menu closes when navigating
- [ ] Bottom navigation (if present) doesn't overlap content

---

## Section Naming Convention

Map Figma frame names to Deco section paths:

| Figma Frame Name | Section Path |
|------------------|-------------|
| Header | `sections/Header/Header.tsx` |
| Hero Banner | `sections/Hero/HeroBanner.tsx` |
| Product Shelf | `sections/Product/ProductShelf.tsx` |
| Category Grid | `sections/Category/CategoryGrid.tsx` |
| Newsletter | `sections/Newsletter/Newsletter.tsx` |
| Footer | `sections/Footer/Footer.tsx` |
| Blog Posts | `sections/Blog/BlogPosts.tsx` |

Use PascalCase for file names. Group related sections in subdirectories.

---

## Page Assembly

After all sections are created, assemble pages by creating/updating page JSON blocks in `.deco/blocks/`:

```json
{
  "name": "Home",
  "path": "/",
  "sections": [
    { "__resolveType": "site/sections/Header/Header.tsx" },
    { "__resolveType": "site/sections/Hero/HeroBanner.tsx", "image": "https://..." },
    { "__resolveType": "site/sections/Product/ProductShelf.tsx", "title": "Best Sellers" },
    { "__resolveType": "site/sections/Newsletter/Newsletter.tsx" },
    { "__resolveType": "site/sections/Footer/Footer.tsx" }
  ]
}
```

Repeat for each page (Home, PLP, PDP, Institutional, etc.).

---

## Review Checklist

Before marking the implementation as complete, run through the review skill (`.claude-deco/skills/review/SKILL.md`):

- [ ] No hardcoded text — all strings are configurable via props
- [ ] No hardcoded CSS — using Tailwind tokens
- [ ] No unused components or files
- [ ] No exposed tokens or API keys
- [ ] Loaders have caching and error handling
- [ ] All sections export `LoadingFallback`
- [ ] No breaking changes to existing sections
- [ ] Desktop and mobile layouts match Figma
- [ ] All images uploaded and placed correctly
- [ ] Performance audit passed
- [ ] E2E tests pass on desktop and mobile

---

## Files in This Skill

| File | Purpose |
|------|---------|
| `SKILL.md` | This complete workflow guide |
| `discovery.md` | How to analyze a Figma file and map sections |
| `qa-checklist.md` | Detailed visual QA and functional testing checklist |

## Related Skills

| Skill | When to Use |
|-------|-------------|
| `e2e-testing` | Full e-commerce flow testing with performance metrics |
| `image-optimizer` | Optimize images after asset placement |
| `html-size-optimizer` | Reduce HTML payload per section |
| `review` | Pre-publish code review |
| `deduplicate-loaders` | Consolidate repeated loader calls |
| `fix-bug` | Patch individual section issues |
