---
name: google-merchant-availability
description: "Diagnose and fix out-of-stock products appearing as available in Google Merchant Center on VTEX storefronts — covering HTTP 404 for unavailable PDPs, VTEX Content API delete-call failures, and a script to audit approved products in bulk."
---

# Google Merchant Center — Product Availability Sync

Products can appear as "in stock" in Google Merchant Center (GMC) even when they are actually out of stock on the storefront. This causes paid clicks that end in a dead-end page, wasting ad spend and hurting quality scores.

Google determines availability through two independent signals:

1. **Web crawl** — Google periodically fetches the product URL and reads the page content.
2. **Content API** — VTEX pushes product updates (including deletes) to GMC via Google's Content API.

Both signals must be consistent. If either one says "available", GMC will show the product as in stock.

---

## Root cause analysis

### Hypothesis 1 — PDP returns HTTP 200 for out-of-stock products (most common)

If the product detail page (PDP) returns `200 OK` even when the product has no stock and is not displayed (e.g., blank/redirect without 404), **Google's crawler treats the URL as valid and available**.

VTEX storefronts commonly return `200` for product URLs even when:
- The product is inactive or has zero stock.
- The store has disabled the "notify me" feature (so the page truly has no actionable content).
- The component renders null or an empty shell without changing the HTTP status code.

**Fix:** return `404` on the server-side render for PDPs where the product is unavailable **and** the store does not offer a "notify me / back-in-stock" flow.

### Hypothesis 2 — Content API `delete` calls failing silently

VTEX sends `delete` requests to the GMC Content API when products are removed or go out of stock. If these calls return errors (e.g., `404 Not Found` from Google's side — meaning the product was never inserted or was already deleted), VTEX continues retrying, generating a high error rate that masks the real state.

**Diagnosis signals:**
- High delete-call volume with ~99% failure rate in the VTEX Google Shopping logs.
- GMC shows outdated availability because successful deletes never land.

### Hypothesis 3 — GMC Automatic Availability Update interfering

GMC has a setting called **Automatic Item Updates** that can override the availability field based on its own crawl. If this is enabled and the crawl sees a `200` page, it reverts any API-based "out of stock" signal.

---

## Step 1 — Fix the PDP HTTP status for unavailable products

### Detection

Check whether the route handler / loader for the PDP page changes the response status when the product is null:

```ts
// In the page loader (e.g. pages/p.tsx or loaders/product.ts)
if (!product) {
  // Check if ctx.response.status is being set
}
```

If there is no status override, the framework default is `200`.

### Fix on deco.cx / Fresh

In the page or layout file that renders the PDP, access the request context and set the status:

```ts
// pages/p.tsx (or equivalent)
export const loader = async (props, req, ctx) => {
  const product = await loadProduct(props, req, ctx);

  if (!product) {
    ctx.response.status = 404;
    return { product: null };
  }

  return { product };
};
```

> **Important:** only return `404` when the store does NOT offer a "notify me when available" flow. If back-in-stock signups are shown for out-of-stock products, the page is meaningful and should remain `200`.

### Verify

After deploying, confirm with `curl`:

```bash
curl -o /dev/null -s -w "%{http_code}\n" "https://yourstore.com/product-slug/p"
```

Expect `404` for a known out-of-stock / unlisted product URL and `200` for an active one.

---

## Step 2 — Diagnose VTEX Content API delete failures

### Where to look

In the VTEX Admin, navigate to:

```
Apps → Google Shopping → Logs (or Diagnostics)
```

Look for the following metrics in the last 30 days:

| Metric | Healthy range | Concern threshold |
|---|---|---|
| Total API calls | — | — |
| Failed calls | < 5% | > 20% |
| Failure method breakdown | Mixed | > 90% on `delete` |

### Common error: `delete` returns "Not Found"

VTEX attempts to delete a product from GMC that Google has no record of (either it was never successfully inserted, or Google already removed it). VTEX retries indefinitely, inflating the error count without any real impact — but masking genuine failures.

**Action:** open a support ticket with Google Merchant Center (via the GMC Admin "Help" button or the [Google Support portal](https://support.google.com/merchants/)) attaching:

- Account ID and store domain.
- The date range with high delete-error volume.
- A sample of the failing product IDs (from VTEX logs).

Ask Google to confirm whether the products exist in their Content API index and why `delete` returns `404`.

### Access VTEX logs for Google Shopping

To retrieve detailed logs you need VTEX Admin access. Ask the VTEX account owner to share credentials or app-key/token with the following permission:

```
OMS - Full access  (or)
Google Shopping app - View
```

---

## Step 3 — Audit approved products in bulk

Use this script to cross-reference the products Google has approved in GMC against their actual availability on the storefront.

### Prerequisites

- A CSV or JSON export of approved products from GMC (download from **GMC Admin → Products → All products → Download**).
- Node.js installed locally (or run in a Deno script).

### Script — check HTTP status for each product URL

```ts
// audit-merchant-availability.ts
// Usage: deno run --allow-net audit-merchant-availability.ts products.json

import products from "./products.json" assert { type: "json" };

type Product = { id: string; link: string };

async function checkUrl(url: string): Promise<{ url: string; status: number }> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return { url, status: res.status };
  } catch {
    return { url, status: 0 }; // network error
  }
}

const CONCURRENCY = 10;
const results: Array<{ id: string; url: string; status: number }> = [];

for (let i = 0; i < (products as Product[]).length; i += CONCURRENCY) {
  const batch = (products as Product[]).slice(i, i + CONCURRENCY);
  const checked = await Promise.all(
    batch.map(async (p) => ({
      id: p.id,
      ...(await checkUrl(p.link)),
    }))
  );
  results.push(...checked);
  console.log(`Progress: ${Math.min(i + CONCURRENCY, (products as Product[]).length)} / ${(products as Product[]).length}`);
}

const unavailable = results.filter((r) => r.status === 404 || r.status === 0);
console.log(`\nTotal products checked: ${results.length}`);
console.log(`Out-of-stock / unavailable (404 or error): ${unavailable.length}`);

// Write CSV report
const csv = ["id,url,status", ...results.map((r) => `${r.id},${r.url},${r.status}`)].join("\n");
await Deno.writeTextFile("availability-report.csv", csv);
console.log("Report saved to availability-report.csv");
```

> Run the script **after** the 404 fix is deployed so the results reflect the current real state.

### Interpret results

| HTTP status | Meaning |
|---|---|
| `200` | Product page is live and available — GMC entry is correct |
| `404` | Product is out of stock or removed — GMC entry should be removed |
| `301 / 302` | Redirect — follow to final URL and recheck |
| `0` | Network error — check the URL format or firewall rules |

---

## Step 4 — Verify GMC picks up the fix

After deploying the `404` fix:

1. In GMC Admin, go to **Products → Diagnostics → Item issues**.
2. Look for issues tagged `Crawl not performed recently` or `Availability mismatch`.
3. Trigger a manual recrawl: select the affected products and use **Request review**.
4. Check the `Last crawl` date; Google typically re-crawls within 2–7 days after a status change.
5. Confirm the `Availability` field flips from `in stock` to `out of stock` (or the item is removed from the feed).

---

## Quick diagnostics table

| Symptom | Likely cause | Fix |
|---|---|---|
| GMC shows "in stock", site shows 404 page | PDP returns `200` for null product | Return `404` in the loader when product is null |
| 99% delete errors in VTEX Google Shopping logs | Product never existed in GMC index | Open Google support ticket; investigate initial insertion pipeline |
| GMC availability reverts after API update | Automatic Item Updates overriding API | Disable Automatic Item Updates in GMC settings, or ensure crawl also returns correct signal |
| High approved-product count but low conversions | Mix of stocked and out-of-stock products in the feed | Run the audit script after 404 fix; submit inventory update to GMC |

---

## Agent workflow

1. **Confirm the symptom** — ask for a GMC product URL that is showing as "in stock" but is unavailable on the site.
2. **Check the PDP status code** — `curl -I <product-url>` and confirm whether it returns `200` or `404`.
3. **Check VTEX Google Shopping logs** — identify volume and error method breakdown.
4. **Apply the 404 fix** if the loader does not already set the status.
5. **Run the audit script** on the GMC export to quantify affected products.
6. **Open a Google support ticket** if delete errors persist after the PDP fix.
7. **Monitor GMC Diagnostics** over the following 2–7 days for the availability field to update.
