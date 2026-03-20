---
name: robots
description: Use this to manage URL authority and prevent duplicate content issues across the storefront
---

## Robots.txt

`robots.txt` is a text file placed at the root of a website (e.g. `https://example.com/robots.txt`) that instructs web crawlers (like Googlebot) which pages or sections of the site they are allowed or disallowed to crawl. It follows the Robots Exclusion Protocol and is the first file crawlers request before indexing a site.

## Good Practices

- Disallow low-value or duplicate pages (e.g. faceted search URLs, internal search results, staging paths) to preserve crawl budget.
- Always include a `Sitemap:` directive pointing to your XML sitemap so crawlers can discover it easily.
- Be specific with `Disallow` rules — block only what you intend to block, avoiding overly broad patterns.
- Test your `robots.txt` with Google Search Console's robots.txt tester before publishing changes.
- Keep the file small and readable; group rules by user-agent for clarity.
- Use `Allow` directives to explicitly permit important sub-paths that fall under a broader `Disallow` rule.

## Bad Practices

- Blocking CSS, JS, or image files — crawlers need them to render and understand pages correctly.
- Using `robots.txt` as a security measure — it is publicly visible and does not prevent access, only crawling.
- Disallowing pages you still want indexed; use `noindex` meta tags or HTTP headers for that instead.
- Leaving the file empty or missing entirely on large sites, wasting crawl budget on irrelevant URLs.
- Using `Disallow: /` on production without realizing it blocks all crawlers from the entire site.
- Inconsistent trailing slashes or typos in paths that silently fail to block the intended URLs.

