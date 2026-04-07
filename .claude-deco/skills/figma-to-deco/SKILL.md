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
- Figma MCP tools available (get_metadata, get_design_context, get_screenshot, get_variable_defs, use_figma)
- Playwright installed for QA phase

---

## Workflow Overview

```
Step 1 — Discover & Map     Extract file key, list pages, map frames to sections
Step 2 — Implement          Create .tsx sections with Tailwind + Preact + Islands
Step 3 — Assets             Download images, upload to Deco assets
Step 4 — Loaders            Configure data sources for dynamic sections
Step 5 — Visual QA          Playwright screenshots vs Figma baseline (desktop + mobile)
Step 6 — Adjustments        Fix every mismatch found in QA
Step 7 — Performance        Run performance skills + accessibility checks
Step 8 — Functional E2E     Menu, search, cart, checkout flows (desktop + mobile)
```

---

## Step 1: Discover & Map Figma File

### 1.1 Extract the file key

From the Figma URL:

```
https://figma.com/design/ABC123xyz/My-Store-Design?node-id=0-1
                         ^^^^^^^^^^^
                         This is the fileKey
```

### 1.2 List all pages

Use `get_metadata` on the root node to list all pages and top-level frames:

```
Tool: get_metadata
  fileKey: "ABC123xyz"
  nodeId: "0:1"
```

The response is XML. Look for `<Page>` nodes at the top level. Map Figma pages to Deco routes:

| Figma Page | Deco Route | Notes |
|------------|------------|-------|
| Home / Homepage | `/` | Main landing page |
| PLP / Category / Collection | `/category/*` | Product listing |
| PDP / Product | `/product/*` or `/:slug/p` | Product detail |
| Search | `/s?q=*` | Search results |
| Cart | `/checkout/cart` | Cart page |
| Institutional | `/about`, `/contact` | Static pages |
| Blog | `/blog`, `/blog/:slug` | Blog listing + post |
| Components / Design System | N/A | Reusable elements, not a page |

### 1.3 Map frames to sections

For each page, get the frame list:

```
Tool: get_metadata
  fileKey: "ABC123xyz"
  nodeId: "<page-node-id>"
```

Each top-level frame is usually one section. Record for each frame:

- `nodeId` — needed for get_design_context
- `name` — becomes the section file name (e.g., `Hero`, `ProductShelf`, `Footer`)
- `page` — which Figma page it belongs to
- `width` — detect viewport: frames wider than 1024px are desktop, 375px is the standard mobile width
- `position` — ordering on the page (top to bottom = render order)

#### Frame naming patterns

Designers typically name frames like:

- `Header` or `Navbar` -> `sections/Header/Header.tsx`
- `Hero` or `Banner` -> `sections/Hero/HeroBanner.tsx`
- `Product Shelf` or `Shelf` -> `sections/Product/ProductShelf.tsx`
- `Categories` or `Category Grid` -> `sections/Category/CategoryGrid.tsx`
- `Newsletter` or `CTA` -> `sections/Newsletter/Newsletter.tsx`
- `Footer` -> `sections/Footer/Footer.tsx`
- `Testimonials` or `Reviews` -> `sections/Social/Testimonials.tsx`
- `FAQ` or `Accordion` -> `sections/Content/FAQ.tsx`
- `Features` or `Benefits` -> `sections/Content/Features.tsx`

#### Detecting desktop vs mobile variants

- Look for pairs: `Hero - Desktop` + `Hero - Mobile`
- If only desktop exists, implement responsive behavior with Tailwind breakpoints

#### Detecting shared vs page-specific

- **Shared**: Header and Footer appear on every page
- **Shared**: Newsletter/CTA may appear on multiple pages
- **Page-specific**: Hero only on Home, ProductGrid only on PLP

### 1.4 Extract design tokens

Use `get_variable_defs` to extract the Figma design tokens:

```
Tool: get_variable_defs
  fileKey: "ABC123xyz"
  nodeId: "<any-section-nodeId>"
```

Map tokens to Tailwind:

| Figma Variable | Tailwind Config | Example |
|---------------|-----------------|---------|
| `color/primary` | `colors.primary` | `#FF6B00` |
| `color/secondary` | `colors.secondary` | `#1A1A2E` |
| `color/background` | `colors.background` | `#FFFFFF` |
| `spacing/sm` | `spacing.sm` or default | `8px` |
| `spacing/md` | `spacing.md` or default | `16px` |
| `spacing/lg` | `spacing.lg` or default | `24px` |
| `font/heading` | `fontFamily.heading` | `Inter` |
| `font/body` | `fontFamily.body` | `Inter` |
| `radius/default` | `borderRadius.DEFAULT` | `8px` |

If the Deco site has a `tailwind.config.ts` or theme, match Figma colors to existing tokens. If new tokens are needed, extend the theme.

### 1.5 Identify interactive elements (Islands)

Scan each section for elements that need client-side behavior:

| Element | Needs Island? | Island Name |
|---------|--------------|-------------|
| Static text/image | No | - |
| Navigation links | No | - |
| Carousel/Slider | Yes | `islands/Carousel.tsx` |
| Accordion/FAQ | Yes | `islands/Accordion.tsx` |
| Tab switcher | Yes | `islands/Tabs.tsx` |
| Dropdown menu | Yes | `islands/Dropdown.tsx` |
| Mobile hamburger | Yes | `islands/MobileMenu.tsx` |
| Search bar | Yes | `islands/SearchBar.tsx` |
| Add to cart button | Yes | `islands/AddToCart.tsx` |
| Quantity selector | Yes | `islands/QuantitySelector.tsx` |
| Image zoom | Yes | `islands/ImageZoom.tsx` |
| Newsletter form | Yes | `islands/NewsletterForm.tsx` |

### 1.6 Identify data sources

For each section, determine if it needs dynamic data:

**Static sections (no loader needed):**
- Hero Banner with fixed content
- Newsletter signup
- Institutional text
- Footer with links

**Dynamic sections (needs loader):**

| Data Type | Loader Path | Example Section |
|-----------|-------------|-----------------|
| Product list | `vtex/loaders/intelligentSearch/productList.ts` | ProductShelf, ProductGrid |
| Product page | `vtex/loaders/intelligentSearch/productDetailsPage.ts` | ProductDetails |
| Category tree | `vtex/loaders/categories/tree.ts` | CategoryMenu, MegaMenu |
| Search results | `vtex/loaders/intelligentSearch/productListingPage.ts` | SearchResults, PLP |
| Blog posts | `spire/loaders/BlogpostList.ts` | BlogPosts |

> **Note:** The loader paths above are VTEX examples. Ask the user which platform they use (VTEX, Shopify, VNDA, Wake) and adjust loader paths accordingly.

### 1.7 Output: Section map

Produce a markdown table before proceeding:

```markdown
| # | Section Name       | Figma Page | Node ID   | Type     | Variants        | Data Source | Islands |
|---|--------------------|------------|-----------|----------|-----------------|-------------|---------|
| 1 | Header             | Global     | 123:456   | Shared   | Desktop, Mobile | None        | MobileMenu, SearchBar |
| 2 | HeroBanner         | Home       | 123:789   | Specific | Desktop, Mobile | Static      | Carousel |
| 3 | ProductShelf       | Home       | 124:100   | Specific | Desktop only    | productList | None |
| 4 | CategoryGrid       | PLP        | 125:200   | Specific | Desktop, Mobile | categories  | None |
| ...                                                                                                   |
```

**Present this table to the user for confirmation before implementing.**

### 1.8 Implementation order

Recommended order for building sections:

1. **Header** — needed on all pages, establishes navigation
2. **Footer** — needed on all pages, completes the page
3. **Home Hero** — most visible section
4. **Home sections** — remaining home page sections top to bottom
5. **PLP sections** — product listing page
6. **PDP sections** — product detail page
7. **Other pages** — search, cart, institutional

Build each section's Island at the same time as the section that needs it — this keeps the section functional immediately after creation.

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
3. **No client-side behavior in sections** — no hooks, no onClick, no useState. Use Islands for interactivity
4. **Typed props with JSDoc** — `@title` for admin labels, `@hide` for internal props
5. **Default values** — every prop must have a sensible default matching the Figma design
6. **Responsive** — use Tailwind breakpoints (`md:`, `lg:`) for desktop/mobile
7. **`LoadingFallback` export** — always include a skeleton loader matching section dimensions
8. **Widget types** — use `ImageWidget` for images, `TextArea` for rich text, `Color` for colors
9. **100% design fidelity** — match Figma spacing, colors, typography, and layout exactly

### 2.4 Islands for interactive elements

When a section requires client-side behavior (carousel, accordion, tabs, dropdown menu), build the Island alongside the section:

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

### 4.1 Add inline loaders for simple data

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

### 4.2 Use external loaders for reusable data

When multiple sections need the same data, use an external loader and type-match the prop:

```tsx
// In the section
export interface Props {
  products?: Product[] | null;
}
```

This lets the Admin user pick any loader that returns `Product[]`.

### 4.3 Ask user for integration details

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

Save to:

```
tests/visual-qa/baselines/desktop/<order>-<SectionName>.png
tests/visual-qa/baselines/mobile/<order>-<SectionName>.png
```

### 5.2 Capture implementation screenshots

Use Playwright to screenshot each section at both viewports:

```typescript
import { chromium } from "playwright";

const BASE_URL = "http://localhost:8000";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
};

const PAGES = [
  { name: "home", path: "/" },
  { name: "plp", path: "/category" },
  { name: "pdp", path: "/product/p" },
];

async function captureAll() {
  const browser = await chromium.launch();

  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    for (const p of PAGES) {
      await page.goto(`${BASE_URL}${p.path}`);
      await page.waitForLoadState("networkidle");

      // Full page screenshot
      await page.screenshot({
        path: `tests/visual-qa/actual/${device}/${p.name}-full.png`,
        fullPage: true,
      });

      // Individual section screenshots
      const sections = await page.locator("[data-section]").all();
      for (let i = 0; i < sections.length; i++) {
        const name = await sections[i].getAttribute("data-section") || `section-${i}`;
        await sections[i].scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await sections[i].screenshot({
          path: `tests/visual-qa/actual/${device}/${p.name}-${i}-${name}.png`,
        });
      }
    }

    await context.close();
  }

  await browser.close();
}

captureAll();
```

### 5.3 Comparison criteria

For each section, check these aspects against the Figma baseline:

**Layout:**
- Flex direction matches (row vs column)
- Alignment matches (start, center, end, space-between)
- Grid columns match (2-col, 3-col, 4-col)
- Section max-width and centering
- Content ordering matches top-to-bottom, left-to-right

**Spacing:**
- Padding inside the section
- Margin between elements
- Gap between grid/flex items
- Section vertical spacing (padding-y)

**Typography:**
- Font family, size, weight, line height, letter spacing
- Text color and alignment
- Text transform (uppercase, capitalize)

**Colors:**
- Background, text, border, button, and link colors

**Images:**
- Correct image displayed, aspect ratio, object-fit, border radius, dimensions

**Responsive:**
- Desktop layout correct at 1440px
- Mobile layout correct at 375px
- Breakpoint transitions smooth (no layout jumps at 768px, 1024px)
- Hidden elements properly hidden per viewport

### 5.4 Generate adjustment list

Output a structured adjustment table:

```markdown
## Visual QA Adjustments

### Desktop (1440px)

| # | Section | Issue | Expected | Actual | Fix |
|---|---------|-------|----------|--------|-----|
| 1 | HeroBanner | Title font size | 48px | 36px | Change text-4xl to text-5xl |
| 2 | ProductShelf | Card gap | 24px | 16px | Change gap-4 to gap-6 |
| 3 | Footer | BG color | #1a1a1a | #000000 | Change bg-black to bg-[#1a1a1a] |

### Mobile (375px)

| # | Section | Issue | Expected | Actual | Fix |
|---|---------|-------|----------|--------|-----|
| 1 | Header | Menu icon missing | Present | Missing | Add MobileMenu Island |
| 2 | HeroBanner | Image height | 300px | 400px | Add h-[300px] md:h-[400px] |
```

---

## Step 6: Implement Adjustments

For each item in the adjustment list:

1. Apply the fix to the section `.tsx` file
2. Re-screenshot with Playwright
3. Confirm the mismatch is resolved
4. Mark the adjustment as `Fixed`

Repeat until all sections pass visual QA on both **desktop (1440px)** and **mobile (375px)** viewports.

---

## Step 7: Performance & Accessibility Audit

Run the performance skills on every section created.

### 7.1 Image optimization

Use skill: `.claude-performance/skills/image-optimizer/SKILL.md`

- [ ] Above-fold images are preloaded (`loading="eager"`)
- [ ] Below-fold images are lazy loaded (`loading="lazy"`)
- [ ] Images have explicit `width` and `height` (CLS prevention)
- [ ] Images use optimized formats (prefer AVIF > WebP > JPEG)
- [ ] No oversized images (max 2x display size)

### 7.2 HTML size optimization

Use skill: `.claude-performance/skills/html-size-optimizer/SKILL.md`

- [ ] Section HTML is minimal (no unnecessary wrappers)
- [ ] No inline base64 images
- [ ] No unused Tailwind classes

### 7.3 Section-level performance

- [ ] `LoadingFallback` is exported and matches section dimensions
- [ ] No blocking resources in the section
- [ ] Below-fold sections use deferred loading via Deco's render
- [ ] Server-side data fetching is cached appropriately
- [ ] No N+1 loader calls (use `deduplicate-loaders` skill if needed)

### 7.4 Accessibility

- [ ] Heading hierarchy is correct (h1 > h2 > h3)
- [ ] Images have alt text
- [ ] Buttons have accessible labels
- [ ] Color contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large text and UI components)
- [ ] Interactive elements are keyboard focusable
- [ ] Skip navigation link (if applicable)

---

## Step 8: Functional E2E Testing

Use skill: `.claude-deco/skills/e2e-testing/SKILL.md`

### 8.1 Header / Navigation

**Desktop:**
- [ ] Logo renders and links to home
- [ ] Navigation items render with correct text and links
- [ ] Mega menu opens on hover (if applicable) with categories/subcategories
- [ ] Search bar is visible and functional
- [ ] Cart icon shows item count
- [ ] User account icon/link works
- [ ] Sticky header works on scroll (if designed)

**Mobile:**
- [ ] Logo renders
- [ ] Hamburger menu icon is visible and opens drawer
- [ ] Menu items are tappable (44x44px minimum)
- [ ] Nested categories expand/collapse
- [ ] Menu closes on navigation and backdrop tap
- [ ] Search icon opens search overlay
- [ ] Cart icon visible and functional

### 8.2 Hero Banner

- [ ] Background image loads
- [ ] Title and subtitle render correctly
- [ ] CTA button renders and links correctly
- [ ] If carousel: arrows/dots work, autoplay works
- [ ] Mobile: layout stacks or adjusts

### 8.3 Product Shelf

**Desktop:**
- [ ] Correct number of products shown (e.g., 4 per row)
- [ ] Product image, name, and price render
- [ ] Navigation arrows work (if applicable)
- [ ] Click navigates to PDP

**Mobile:**
- [ ] Products show in scroll/swipe layout with swipe gesture
- [ ] Product cards properly sized with adequate touch targets

### 8.4 Product Listing Page (PLP)

- [ ] Products load and render in grid
- [ ] Filters sidebar/dropdown works (mobile: opens as drawer/modal)
- [ ] Sort dropdown works
- [ ] Pagination or infinite scroll works
- [ ] Product count and breadcrumb navigation displayed

### 8.5 Product Detail Page (PDP)

- [ ] Product images load (main + thumbnails) with gallery navigation
- [ ] Product name, description, price render
- [ ] Size/variant selector works
- [ ] Add to cart and quantity selector work
- [ ] Mobile: images swipeable, sticky add-to-cart bar (if designed)

### 8.6 Search

**Desktop:** Search input accepts text, suggestions appear, Enter navigates to results

**Mobile:** Search icon opens overlay, keyboard opens automatically, suggestions appear, close button works

### 8.7 Cart / Minicart

- [ ] Minicart opens on add-to-cart
- [ ] Product appears with quantity update and remove
- [ ] Subtotal calculates correctly
- [ ] Checkout button links correctly
- [ ] Mobile: minicart is drawer/modal

### 8.8 Footer

- [ ] All link sections render with working links
- [ ] Social media icons render and link
- [ ] Newsletter signup works (if present)
- [ ] Payment method icons render
- [ ] Mobile: sections stack vertically

### 8.9 E-commerce flow

Run the full e-commerce E2E flow on **both desktop and mobile**:

```
Home -> PLP -> PDP -> Add to Cart -> Minicart
```

### 8.10 Mobile-specific checks

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

## Related Skills

| Skill | When to Use |
|-------|-------------|
| `e2e-testing` | Full e-commerce flow testing with performance metrics |
| `image-optimizer` | Optimize images after asset placement |
| `html-size-optimizer` | Reduce HTML payload per section |
| `review` | Pre-publish code review |
| `deduplicate-loaders` | Consolidate repeated loader calls |
| `fix-bug` | Patch individual section issues |
