# Canonical Tag Skill

Use this to manage URL authority and prevent duplicate content issues across the storefront. This ensures search engines focus on the "master" version of a page, consolidating ranking power and protecting crawl budget.

## Canonicalization Strategy

- Use a **self-referential** canonical tag on every unique product, category, and CMS page (the "clean" URL should point to itself).
- Use **absolute URLs** (including `https://` and the full domain) to avoid ambiguity between environments, protocols (HTTP vs HTTPS), or subdomains.
- Ensure the canonical target is **indexable**: it must return a `200 OK` status and must **not** have a `noindex` tag.

## E-commerce Specific Scenarios

- **Faceted Navigation & Filters:** - Point the canonical to the **main category** for URLs created by sorting (`?sort=price`), view toggles (`?view=grid`), or tracking parameters (e.g., `?utm_source=...`).
    - Only allow a unique canonical if the filter creates a distinct, high-value landing page (e.g., a specific "Brand + Category" combination with high search volume).
- **Product Variations:** - If a product has multiple URLs for different colors/sizes but the content is nearly identical, point the canonical to the **primary product version**.
    - If each variation is a distinct marketing asset with its own unique description and SKU, use a self-referential canonical for each.
- **Cross-Categorization:** When a product lives in multiple categories (e.g., `/sale/product` and `/electronics/product`), pick the **most relevant** or original path as the canonical to avoid splitting authority.

## Technical Rules

- **Single Tag Policy:** Ensure only **one** `<link rel="canonical">` exists in the `<head>`. Multiple tags cause search engines to ignore the instruction entirely.
- **Sitemap Alignment:** The URL defined as canonical **must** match the URL listed in the `sitemap.xml`. Discrepancies send conflicting signals to crawlers.
- **Pagination:** For paginated results (e.g., `?page=2`), use a **self-referential** canonical. Do **not** point page 2 to page 1, as this prevents search engines from discovering products deeper in the catalog.

## Checks TO-DO:

- Does the page have more than one canonical tag? **Wrong!**
- Does the canonical point to a 404, 301, or a page with a `noindex` tag? **Wrong!**
- Are tracking parameters (UTMs) or session IDs being indexed? **Wrong!** (They should canonicalize to the clean URL).
- Is the canonical URL relative (e.g., `/product`) instead of absolute? **Incorrect.**