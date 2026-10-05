---
name: robots
description: Manages robots.txt rules to control crawler access, preserve crawl budget, and ensure proper indexing of the storefront. Use whenever adding or changing a Disallow/Allow rule, blocking query parameters (SKU, sort, filters, utm) to fight duplicate URLs, or when Google Merchant Center starts disapproving products with "Couldn't verify product pages" / "Não foi possível verificar as páginas dos produtos" — that error is almost always robots.txt blocking the feed's landing URLs.
---

## Robots.txt

`robots.txt` is a text file placed at the root of a website (e.g. `https://example.com/robots.txt`) that instructs web crawlers (like Googlebot) which pages or sections of the site they are allowed or disallowed to crawl. It follows the Robots Exclusion Protocol and is the first file crawlers request before indexing a site.

## Good Practices

- Disallow low-value or duplicate pages (e.g. faceted search URLs, internal search results, staging paths) to preserve crawl budget — **but only after checking the URL isn't a landing page for something else** (see "Never block feed and ad landing URLs" below).
- Always include a `Sitemap:` directive pointing to your XML sitemap so crawlers can discover it easily.
- Be specific with `Disallow` rules — block only what you intend to block, avoiding overly broad patterns.
- Verify changes with Search Console's **robots.txt report** (Settings → Crawling) and **URL Inspection → Test live URL**. The old "robots.txt Tester" no longer exists.
- Keep the file small and readable; group rules by user-agent for clarity.
- Use `Allow` directives to explicitly permit important sub-paths that fall under a broader `Disallow` rule.

## Bad Practices

- Blocking CSS, JS, or image files — crawlers need them to render and understand pages correctly.
- Using `robots.txt` as a security measure — it is publicly visible and does not prevent access, only crawling.
- Disallowing pages you still want indexed; use `noindex` meta tags or HTTP headers for that instead.
- Leaving the file empty or missing entirely on large sites, wasting crawl budget on irrelevant URLs.
- Using `Disallow: /` on production without realizing it blocks all crawlers from the entire site.
- Inconsistent trailing slashes or typos in paths that silently fail to block the intended URLs.
- Combining `Disallow` with a canonical on the same URL — a blocked URL is never fetched, so Google never sees its canonical (or `noindex`). Pick one: canonical to consolidate, `Disallow` only for URLs nothing should ever land on.

## Never block feed and ad landing URLs

A URL that looks like "duplicate noise" in Search Console can be the exact landing page of a shopping feed or an ad. Google Merchant Center, Google Ads and Performance Max verify every product by crawling its `link` / final URL with **Googlebot** (pages) and **Googlebot-Image** (images) — both follow the `User-agent: *` group. If that URL is disallowed, the product is disapproved.

Typical case: VTEX feeds link to the SKU variant, `/<slug>/p?idsku=<id>` (sometimes `?skuId=`). A rule like `Disallow: /*?idsku=*`, added to stop "the same PDP indexed once per SKU", blocks the whole feed. Symptom, starting the day the rule ships:

- Merchant Center: **"Couldn't verify product pages"** / *"Não foi possível verificar as páginas dos produtos"*, with a link to fix robots.txt for Googlebot / Googlebot-image.
- Disapproved products climb from ~0 to most of the catalog over 2–4 days as Google re-crawls.

Dedupe variant URLs with the **canonical** (variant → clean PDP URL), not with `robots.txt`. The variant stays crawlable, so the feed works and Google still consolidates it.

### Before shipping any new `Disallow` on a query parameter

1. Check whether the parameter appears in landing URLs: the product feed (`link` / `mobile_link`), ads final URLs and tracking templates, email/CRM links. If you have no access, ask whoever owns Merchant Center/Ads for 2–3 example product links.
2. Check traffic: if the edge/CDN logs show the parameter on many PDP requests per day, something external is linking to it — almost always a feed or ads.
3. If it's a landing URL, don't block it — use the canonical instead.
4. Leave a comment next to rules that were deliberately *not* added (or were removed), so the next SEO pass doesn't re-introduce them.

## Verifying a robots.txt fix (Search Console)

1. **Settings → Crawling → robots.txt → Open report.** "Checked on" must be after your deploy and the size must match the new file. If it isn't, use ⋮ → **Request a recrawl** (needs full-user/owner permission). Google re-reads it on its own within ~24h anyway.
2. **URL Inspection** on a real feed URL (e.g. `/<slug>/p?idsku=<real-id>`) → **Test live URL** → expect *Crawl allowed? Yes* and *Page fetch: Successful*. "URL is not on Google" / "Alternate page with proper canonical tag" is expected for a variant URL — don't Request indexing on it.
3. Merchant Center re-approves gradually as products are re-crawled (hours to a few days); there's no bulk re-check. Watch the product status chart's disapproved area go down.
