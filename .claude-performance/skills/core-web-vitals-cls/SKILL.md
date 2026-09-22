---
name: core-web-vitals-cls
description: Diagnose and fix Cumulative Layout Shift (CLS) on storefront pages. Use Lighthouse CLI to measure real culprits before acting — never trust third-party diagnoses without measuring first.
---

## Setup

### 1. Install Lighthouse CLI

```bash
npm install -g lighthouse
```

### 2. Check for a Chromium-based browser

Lighthouse requires a Chromium-based browser (macOS paths):

```bash
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null && echo "Chrome found"
ls "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" 2>/dev/null && echo "Edge found"
ls "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" 2>/dev/null && echo "Brave found"
```

If none found:

```bash
brew install --cask google-chrome
```

Lighthouse detects Chrome automatically. For Edge or Brave, set `CHROME_PATH`:

```bash
CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" lighthouse ...
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" lighthouse ...
```

---

## Workflow

### Step 1 — Start the local server

```bash
deno task start
# typically http://localhost:8000
```

Test against localhost so fixes can be validated before deploying.

### Step 2 — Sample URLs from the sitemap

Do not run Lighthouse on every URL. Pages of the same type share components — fixing one PLP fixes all. Test one representative URL per page type.

```bash
python3 - <<'EOF'
import urllib.request, xml.etree.ElementTree as ET, re

SITE = "https://your-site.com"  # replace with the actual site URL

ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

def fetch_locs(url):
    try:
        with urllib.request.urlopen(url) as r:
            content = r.read().decode("utf-8")
        tree = ET.fromstring(content)
        return [el.text for el in tree.findall(".//sm:loc", ns) if el.text]
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return []

# Handle sitemap index
locs = fetch_locs(f"{SITE}/sitemap.xml")
all_urls = []
for loc in locs:
    if "sitemap" in loc and loc.endswith(".xml"):
        all_urls.extend(fetch_locs(loc))
    else:
        all_urls.append(loc)

if not all_urls:
    all_urls = locs

home, plp, pdp, search = [], [], [], []
for u in all_urls:
    path = re.sub(r"https?://[^/]+", "", u)
    if path in ("/", ""):
        home.append(u)
    elif "/busca" in path or "/search" in path or "?q=" in path:
        search.append(u)
    elif path.count("/") == 1:
        plp.append(u)
    elif path.count("/") >= 2:
        pdp.append(u)

sample = []
if home:   sample.append(("home",   home[0]))
if plp:    sample.append(("plp",    plp[0]))
if pdp:    sample.append(("pdp",    pdp[0]))
if search: sample.append(("search", search[0]))

print("URLs to test:")
for t, u in sample:
    path = re.sub(r"https?://[^/]+", "", u)
    print(f"  [{t}] http://localhost:8000{path}")
EOF
```

### Step 3 — Run Lighthouse per page type

```bash
lighthouse http://localhost:8000/PATH \
  --only-categories=performance \
  --output=json \
  --output-path=report-PAGE_TYPE.json \
  --chrome-flags="--headless=new"
```

Replace `/PATH` and `PAGE_TYPE` for each URL from Step 2. Save a separate report per type.

### Step 4 — Parse culprits from each report

```bash
python3 - REPORT_FILE.json <<'EOF'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
audits = d["audits"]
score = d["categories"]["performance"]["score"]
print(f"Performance Score: {int(score * 100)}")
print("CLS:", audits["cumulative-layout-shift"]["displayValue"])
items = audits.get("layout-shift-elements", {}).get("details", {}).get("items", [])
if items:
    print("Culprits:")
    for item in items:
        node = item.get("node", {})
        print(f"  - {node.get('snippet','?')[:80]} | score: {item.get('score','?')}")
else:
    print("No layout shift elements detected.")
EOF
```

Run once per report: `python3 - report-home.json`, `python3 - report-plp.json`, etc.

Each entry: `node.snippet` = the HTML element, `score` = its contribution to CLS. Use these to grep the codebase. Group culprits across page types — the same component often appears in multiple pages; one fix covers all.

### Step 5 — Record baseline

Before touching any code, print and preserve the full baseline:

```
## Baseline (before any fix)
| Page type | URL | Performance Score | CLS |
|-----------|-----|:-----------------:|-----|
| home      | http://localhost:8000/ | 42 | 0.38 |
| plp       | http://localhost:8000/moveis | 39 | 0.51 |
| pdp       | http://localhost:8000/produto/cadeira | 55 | 0.12 |

Top culprits (grouped by component):
  - <img class="banner"> — appears in: home, plp | max score: 0.30
  - <section id="3881709968-0"> — appears in: plp | score: 0.18
```

After all fixes, re-run Lighthouse on each URL and print the delta table:

```
## Results (after fixes)
| Page type | Perf Before | Perf After | Δ Perf | CLS Before | CLS After | Δ CLS |
|-----------|:-----------:|:----------:|:------:|:----------:|:---------:|:-----:|
| home      | 42          | 61         | +19    | 0.38       | 0.04      | -0.34 |
| plp       | 39          | 58         | +19    | 0.51       | 0.06      | -0.45 |
| pdp       | 55          | 67         | +12    | 0.12       | 0.02      | -0.10 |
```

A fix is only valid if CLS and Performance Score improved across the affected page types.

---

## Common Culprits and Fixes

### Unsized images

**Watch for:** `<img>` inside `<Picture>` without `width`/`height` on the `<img>` fallback. `<Image>` with `w-auto h-auto`. Container without `aspect-ratio`.

**Fix:** Use `aspect-ratio` on the container — more robust than `width`/`height` on `<img>` alone:

```tsx
const device = useDevice();
const isMobile = device !== "desktop";
const imgWidth = isMobile ? (widthMobile ?? 390) : (widthDesktop ?? 1900);
const imgHeight = isMobile ? (heightMobile ?? 85) : (heightDesktop ?? 190);

<div
  class="w-full relative overflow-hidden"
  style={{ aspectRatio: `${imgWidth} / ${imgHeight}` }}
>
  <Picture preload>
    <Source ... />
    <img class="w-full" loading="eager" width={imgWidth} height={imgHeight} />
  </Picture>
</div>
```

### Lazy section swap (above-the-fold)

Deco `Lazy.tsx` renders `LoadingFallback` first, then swaps via streaming. Height mismatch causes shift.

**Where to check:** `.deco/blocks/pages-*.json` — sections inside `website/sections/Rendering/Lazy.tsx`.

**Fix:** Remove the `Lazy.tsx` wrap for above-the-fold sections (banner, header, first carousel). If keeping Lazy, match `LoadingFallback` dimensions exactly.

### `w-auto h-auto` overriding HTML dimensions

`w-auto` and `h-auto` mean "size by content" — before the image loads, size is 0.

**Fix:** Use `w-full h-full` when the parent has fixed dimensions:

```tsx
// Before (causes CLS)
class="relative max-w-[80px] max-h-[60px] w-auto h-auto object-contain"

// After (parent reserves space)
class="relative w-full h-full object-contain"
```

### Duplicate elements until JS hydrates

Two states (login/account, cart empty/full) both rendered in SSR without `hidden`. JS hides one after hydration.

**Fix:** Default state visible, alternative starts `hidden`:

```tsx
<div class="h-10" id="login-container">...</div>
<div class="h-10 hidden" id="account-container">...</div>
```

### Web fonts (FOUT)

Google Fonts with `display: swap` show a system font first, then swap. Different metrics cause text reflow.

**Fix options:**
- `font-display: optional` (no fallback flash, but may not show custom font).
- Preload critical fonts: `<link rel="preload" href="..." as="font" crossorigin>`.
- Adjust `size-adjust` on the fallback `@font-face` to match the web font metrics.

### Non-composited animations

Appears as "Avoid non-composited animations" (Unscored). Affects visual jankiness, **not** CLS. Common with `transition: color` on buttons (e.g. DaisyUI `btn`). Ignore or fix last.

---

## Gotchas

- Measure first. The real culprit is often an unsized image in the footer, not the shelf island the agency flagged.
- Lighthouse applies mobile throttling by default — don't disable it.
- `width`/`height` on `<img>` is ignored if CSS has `w-auto h-auto` — the attributes are overridden.
- CLS varies between runs. Run multiple times, take the worst.
- Fixing `LoadingFallback` may not eliminate shift — the Lazy swap itself can cause shift even with matching heights.

---

## References

- [web.dev — Cumulative Layout Shift](https://web.dev/articles/cls)
- [web.dev — Optimize CLS](https://web.dev/articles/optimize-cls)
- [Chrome DevTools — Layout Shifts](https://developer.chrome.com/docs/devtools/performance/reference#layout-shifts)
