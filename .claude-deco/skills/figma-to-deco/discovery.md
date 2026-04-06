# Figma Discovery Guide

How to analyze a Figma file and extract everything needed to implement sections in Deco.

## Step 1: Get the File Key

Extract from the Figma URL:

```
https://figma.com/design/ABC123xyz/My-Store-Design?node-id=0-1
                         ^^^^^^^^^^^
                         This is the fileKey
```

## Step 2: List All Pages

```
Tool: get_metadata
  fileKey: "ABC123xyz"
  nodeId: "0:1"
```

The response is XML. Look for `<Page>` nodes at the top level. Common page names:

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

## Step 3: Map Frames to Sections

For each page, get the frame list:

```
Tool: get_metadata
  fileKey: "ABC123xyz"
  nodeId: "<page-node-id>"
```

Each top-level frame is usually one section. Look at:

### Frame naming patterns

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

### Detecting desktop vs mobile

- Frames wider than 1024px are desktop
- Frames between 320–428px are mobile
- Look for pairs: `Hero - Desktop` + `Hero - Mobile`
- If only desktop exists, implement responsive with Tailwind breakpoints

### Detecting shared vs page-specific

- **Shared**: Header and Footer appear in every page
- **Shared**: Newsletter/CTA might appear on multiple pages
- **Page-specific**: Hero only on Home, ProductGrid only on PLP

## Step 4: Extract Design Tokens

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
| `spacing/sm` | `spacing.sm` or use default | `8px` |
| `spacing/md` | `spacing.md` or use default | `16px` |
| `spacing/lg` | `spacing.lg` or use default | `24px` |
| `font/heading` | `fontFamily.heading` | `Inter` |
| `font/body` | `fontFamily.body` | `Inter` |
| `radius/default` | `borderRadius.DEFAULT` | `8px` |

## Step 5: Identify Interactive Elements

Scan each section for elements that need client-side behavior (Islands):

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

## Step 6: Identify Data Sources

For each section, determine if it needs dynamic data:

### Static sections (no loader)
- Hero Banner with fixed content
- Newsletter signup
- Institutional text
- Footer with links

### Dynamic sections (needs loader)
- Product shelves -> `productList` loader
- Category navigation -> `categories/tree` loader
- Product detail -> `productDetailsPage` loader
- Search results -> `productListingPage` loader
- Blog posts -> `BlogpostList` loader
- User-specific content -> custom loader

## Step 7: Prioritize Implementation Order

Recommended order for implementing sections:

1. **Header** — needed on all pages, establishes navigation
2. **Footer** — needed on all pages, completes the page
3. **Home Hero** — most visible section
4. **Home sections** — remaining home page sections top to bottom
5. **PLP sections** — product listing page
6. **PDP sections** — product detail page
7. **Other pages** — search, cart, institutional
8. **Islands** — interactive behavior after all static layouts are done

This order ensures the site is visually complete page-by-page.
