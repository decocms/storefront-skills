<img width="2042" height="1136" alt="image" src="https://github.com/user-attachments/assets/b0ea8a00-8bfd-4c8a-9388-a44a25796ced" />

# Skills Library for Storefront Agents

The main point of this repo is to provide skills tailored specifically for **storefront**: e-commerce, product showcases, and shopping experiences.

These skills are not generic — they cover SEO, performance, images, sitemap, structured data, and related topics in the context of stores and product pages, so agents can work more precisely in this domain.

## 🤖 Agents

### 🔎 SEO
Improves discoverability and indexing of storefront pages for search engines.

- **heading-tags** — Proper use of H1–H6 for hierarchy and keywords on product and category pages.
- **robots** — `robots.txt` rules and directives for crawlers (allow/block, sitemap reference).
- **sitemap** — XML sitemaps for products, categories, and key storefront URLs.
- **structured-data** — Schema.org markup (Product, BreadcrumbList, etc.) for rich results.

### ⚡ Performance
Keeps storefronts fast and responsive for users and Core Web Vitals.

- **images** — Formats, sizing, lazy loading, and alt text for product and hero images.
- **image-resolution** — Diagnose blurry/pixelated banner images caused by a source smaller than the slot needs on retina (DPR2), plus how big to upload (desktop vs mobile).
- **video** — The `Video` component, autoplay, and audio. Why uploaded videos are silent by default and how to enable sound with `?muted=false` (URL or CMS panel).
- **cache** — Cache HIT rate, cache-control headers, stale-while-revalidate (SWR), and immutable assets.
- **html-size** — Reducing HTML payload and finding elements that unnecessarily inflate page size.

### 🔧 Troubleshooting
Quick fixes for isolated, one-off issues that don't fit a dedicated skill. A growing knowledge base — new entries are added as problems are discovered.

- **troubleshooting** — Catalog of specific symptoms, root causes, and exact fixes (e.g. wrong HTML `lang`, Fresh config quirks, etc.).

