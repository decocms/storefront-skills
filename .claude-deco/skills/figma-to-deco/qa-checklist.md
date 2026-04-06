# Visual QA & Functional Testing Checklist

Detailed checklist for comparing Figma designs against implemented Deco sections, covering both desktop and mobile viewports.

## Visual QA Process

### 1. Capture Figma Baselines

For every section, capture two screenshots from Figma:

```
Desktop: get_screenshot(nodeId: "<desktop-frame>", fileKey: "<key>")
Mobile:  get_screenshot(nodeId: "<mobile-frame>", fileKey: "<key>")
```

Save to:
```
tests/visual-qa/baselines/desktop/<order>-<SectionName>.png
tests/visual-qa/baselines/mobile/<order>-<SectionName>.png
```

### 2. Capture Implementation Screenshots

Playwright script for both viewports:

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

### 3. Comparison Criteria

For each section, check these aspects:

#### Layout
- [ ] Flex direction matches (row vs column)
- [ ] Alignment matches (start, center, end, space-between)
- [ ] Grid columns match (2-col, 3-col, 4-col)
- [ ] Section max-width and centering
- [ ] Content ordering matches top-to-bottom, left-to-right

#### Spacing
- [ ] Padding inside the section
- [ ] Margin between elements
- [ ] Gap between grid/flex items
- [ ] Section vertical spacing (padding-y)

#### Typography
- [ ] Font family matches
- [ ] Font size matches per element
- [ ] Font weight (regular, medium, semibold, bold)
- [ ] Line height
- [ ] Letter spacing
- [ ] Text color
- [ ] Text alignment (left, center, right)
- [ ] Text transform (uppercase, capitalize)

#### Colors
- [ ] Background color
- [ ] Text colors (headings, body, muted)
- [ ] Border colors
- [ ] Button colors (background, text, hover)
- [ ] Link colors

#### Images
- [ ] Correct image displayed
- [ ] Aspect ratio matches
- [ ] Object-fit matches (cover, contain)
- [ ] Border radius on images
- [ ] Image size/dimensions

#### Responsive
- [ ] Desktop layout renders correctly at 1440px
- [ ] Mobile layout renders correctly at 375px
- [ ] Breakpoint transitions are smooth (no layout jumps at 768px, 1024px)
- [ ] Hidden elements are properly hidden per viewport
- [ ] Font sizes scale appropriately

---

## Functional Testing Checklist

### Header / Navigation

#### Desktop
- [ ] Logo renders and links to home
- [ ] Navigation items render with correct text
- [ ] Navigation links navigate to correct pages
- [ ] Mega menu opens on hover (if applicable)
- [ ] Mega menu shows categories/subcategories
- [ ] Search bar is visible and functional
- [ ] Cart icon shows item count
- [ ] User account icon/link works
- [ ] Sticky header works on scroll (if designed)

#### Mobile
- [ ] Logo renders (possibly smaller)
- [ ] Hamburger menu icon is visible
- [ ] Hamburger opens mobile menu drawer
- [ ] Menu items are tappable (44x44px minimum)
- [ ] Nested categories expand/collapse
- [ ] Menu closes on navigation
- [ ] Menu closes on backdrop tap
- [ ] Search icon opens search overlay
- [ ] Cart icon visible and functional

### Hero Banner

#### Desktop & Mobile
- [ ] Background image loads
- [ ] Title text renders correctly
- [ ] Subtitle renders correctly
- [ ] CTA button renders and links correctly
- [ ] If carousel: arrows/dots work, autoplay works
- [ ] Mobile: layout stacks or adjusts

### Product Shelf

#### Desktop
- [ ] Correct number of products shown (e.g., 4 per row)
- [ ] Product image loads
- [ ] Product name renders
- [ ] Price renders correctly (from/to if on sale)
- [ ] Navigation arrows work (if applicable)
- [ ] Click navigates to PDP

#### Mobile
- [ ] Products show in scroll/swipe layout
- [ ] Swipe gesture works
- [ ] Product cards are properly sized
- [ ] Touch targets are adequate

### Product Listing Page (PLP)

#### Desktop & Mobile
- [ ] Products load and render in grid
- [ ] Filters sidebar/dropdown works
- [ ] Sort dropdown works
- [ ] Pagination or infinite scroll works
- [ ] Product count is displayed
- [ ] Breadcrumb navigation works
- [ ] Mobile: filters open as drawer/modal

### Product Detail Page (PDP)

#### Desktop & Mobile
- [ ] Product images load (main + thumbnails)
- [ ] Image gallery navigation works
- [ ] Product name and description render
- [ ] Price renders (with sale price if applicable)
- [ ] Size/variant selector works
- [ ] Add to cart button works
- [ ] Quantity selector works
- [ ] Mobile: images swipeable
- [ ] Mobile: sticky add-to-cart bar (if designed)

### Search

#### Desktop
- [ ] Search input accepts text
- [ ] Suggestions appear while typing
- [ ] Pressing Enter navigates to results page
- [ ] Results page shows products

#### Mobile
- [ ] Search icon opens search overlay
- [ ] Search overlay covers screen
- [ ] Keyboard opens automatically
- [ ] Suggestions appear
- [ ] Close button works

### Cart / Minicart

#### Desktop & Mobile
- [ ] Minicart opens on add-to-cart
- [ ] Product appears in minicart
- [ ] Quantity update works
- [ ] Remove item works
- [ ] Subtotal calculates correctly
- [ ] Checkout button links correctly
- [ ] Mobile: minicart is drawer/modal

### Footer

#### Desktop & Mobile
- [ ] All link sections render
- [ ] Links navigate correctly
- [ ] Social media icons render and link
- [ ] Newsletter signup (if present) works
- [ ] Payment method icons render
- [ ] Mobile: sections stack vertically

---

## Performance Checks per Section

After visual and functional QA, run these performance checks:

### Images
- [ ] Above-fold images are preloaded (`loading="eager"`)
- [ ] Below-fold images are lazy loaded (`loading="lazy"`)
- [ ] Images have explicit `width` and `height` (CLS prevention)
- [ ] Images use optimized formats (prefer AVIF/WebP)
- [ ] No oversized images (max 2x display size)

### HTML
- [ ] Section HTML is minimal (no unnecessary wrappers)
- [ ] No inline base64 images
- [ ] No unused Tailwind classes

### Loading
- [ ] `LoadingFallback` is exported and matches section dimensions
- [ ] Below-fold sections use Deco's lazy rendering
- [ ] Loaders are cached appropriately

### Accessibility
- [ ] Heading hierarchy is correct (h1 > h2 > h3)
- [ ] Images have alt text
- [ ] Buttons have accessible labels
- [ ] Color contrast meets WCAG AA (4.5:1 text, 3:1 large text)
- [ ] Interactive elements are keyboard focusable
- [ ] Skip navigation link (if applicable)

---

## Adjustment Tracking Template

Use this template to track adjustments:

```markdown
## Adjustments — [Page Name]

### Desktop (1440px)

| # | Section | Issue | Expected | Actual | Status |
|---|---------|-------|----------|--------|--------|
| 1 | HeroBanner | Title too small | 48px/bold | 36px/semibold | Fixed |
| 2 | ProductShelf | Card gap wrong | 24px | 16px | Fixed |
| 3 | Footer | Wrong bg color | #1a1a1a | #000000 | Fixed |

### Mobile (375px)

| # | Section | Issue | Expected | Actual | Status |
|---|---------|-------|----------|--------|--------|
| 1 | Header | No hamburger | Has menu icon | Missing | Fixed |
| 2 | Hero | Image too tall | 300px | 400px | Fixed |
| 3 | ProductShelf | Cards overflow | 1 per view | 2 squeezed | Fixed |
```

Mark each adjustment as `Pending`, `In Progress`, or `Fixed`.
