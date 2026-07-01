---
name: seo-sections
description: Use when a site's SEO metadata (title, og:tags, LD+JSON) is missing, incomplete, or handled by a weak custom component. Covers configuring the apps SEO sections for general pages, PDPs, and PLPs via the deco admin.
---

deco's `apps` ships ready-made SEO sections for every major page type, configurable directly via the admin panel. When a site has no SEO section or a custom one that lacks structured data, replace it with the appropriate apps component.

## Three page types, three SEO sections

All three are configurable via the deco admin under **SEO Type**:

| Admin label | Page type | Data source to connect |
|---|---|---|
| **General pages** | Home, institutional, etc. | Manual title/description |
| **Product details** | PDP | Same loader as the product section |
| **Product listing** | PLP/category pages | Same loader as the listing section |

Select the correct type in the admin and connect the same data loader already used by the page — the section generates `<title>`, og:tags, and LD+JSON automatically from that data.

## Render mode: async (deferred)

SEO sections should be **async/deferred**, not SSR. For regular users, metadata is injected into `<head>` via HTMX `head-support` after load. For bots, `shouldForceRender` forces SSR automatically — no extra config needed. See [[deco-bot-rendering]].

## HTMX head-support is required

Without this extension, `<title>` and og:tags never reach `<head>` for regular users:

```json
{
  "htmx": {
    "version": "1.9.12",
    "extensions": ["head-support"]
  }
}
```

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Wrong loader connected | LD+JSON has missing/wrong data | Use the same loader as the product/listing section |
| HTMX missing `head-support` | Users don't get `<title>` or og:tags | Add `"head-support"` to HTMX extensions in site.json |
| Custom component without LD+JSON | `<title>` works but 0 rich snippets | Replace with the apps SEO section for that page type |
| PLP SEO not noindexing empty results | Empty category pages get indexed | This is handled automatically — ensure the data source is correctly connected |
| Auditing without `?__decoFBT=0` | Metadata appears absent in curl | Use `?__decoFBT=0` to see what bots actually receive |

## Quick audit

```bash
# PDP bot view — must have title, og:tags, LD+JSON
curl -s "https://www.store.com/product/p?__decoFBT=0" | grep -E "<title|og:|ld\+json"

# PLP bot view
curl -s "https://www.store.com/category?__decoFBT=0" | grep -E "<title|og:|ld\+json"

# Check HTMX head-support
grep "head-support" .deco/blocks/site.json
```
