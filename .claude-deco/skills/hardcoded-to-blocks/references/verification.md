# Verifying a conversion

Run the branch and `main` side by side. A separate worktree keeps `main`
untouched:

```sh
git worktree add /tmp/site-main origin/main
(cd /tmp/site-main && bun install --frozen-lockfile && npx vite dev --port 5192) &
npx vite dev --port 5191 &
```

## 1. HTML parity

```python
# body.py — normalise a page for diffing
import re, sys
s = sys.stdin.read()
t = re.search(r"<title>(.*?)</title>", s)
print("TITLE", t.group(1) if t else None)
b = s[s.find("<body"):]
b = re.sub(r"<script.*?</script>", "", b, flags=re.S)
b = re.sub(r"<!--.*?-->", "", b, flags=re.S)
print(b.replace("><", ">\n<"))
```

```sh
for p in / /pt /storefront /pt/storefront /some/article; do
  f=$(echo $p | tr / _)
  curl -s localhost:5192$p | python3 body.py > /tmp/m$f
  curl -s localhost:5191$p | python3 body.py > /tmp/n$f
  echo "$p: $(diff /tmp/m$f /tmp/n$f | grep '^[<>]' | grep -v 'data-manifest-key\|^> </section>' | wc -l) unexpected lines"
done
```

Include a few pages you did **not** convert but whose components you moved:
they must be identical too.

## 2. Pixel parity

Headless Chrome with `--screenshot` hangs on a Vite dev server (the HMR socket
never settles). Use `playwright-core` with a cached Chromium instead:

```js
// shot.mjs — npm i playwright-core in a scratch dir
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
for (const [w, h] of [[1440, 900], [390, 844]])
  for (const [name, port] of [["main", 5192], ["new", 5191]])
    for (const path of ["/", "/pt", "/storefront"]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => console.error(name, path, String(e)));
      await page.goto(`http://localhost:${port}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      // Run reveal-on-scroll animations before the full-page shot.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `shots/${name}${path.replaceAll("/", "_") || "_"}-${w}.png`, fullPage: true });
      await page.close();
    }
await browser.close();
```

```python
# diff.py
from PIL import Image, ImageChops
import glob
for m in sorted(glob.glob("shots/main*.png")):
    n = m.replace("main", "new", 1)
    a, b = Image.open(m).convert("L"), Image.open(n).convert("L")
    if a.size != b.size: print(m, "SIZE", a.size, b.size); continue
    d = ImageChops.difference(a, b); px = [p for p in d.getdata() if p]
    print(m, "identical" if not px else f"{len(px)} px, max {max(px)}/255 in {d.getbbox()}")
```

Different page heights or visible differences are regressions. A few dozen
pixels at ≤ 7/255 around a transition (a select chevron, an animated demo) are
rendering noise; crop and look at both before dismissing.

## 3. Live edit

With the branch dev server running, edit the block JSON and re-fetch:

- change a text in each language and confirm it changes on that locale only;
- empty a `fooPt` and confirm the secondary locale falls back;
- remove and reorder sections of a page and confirm the order of
  `data-manifest-key` attributes changes on both locales;
- break a required field and a link and confirm `check:cms` names both.

Wait for `[deco] applied N-block delta` in the dev log before fetching. Restore
the files and rerun `generate` afterwards.

Then in Studio: open the page in the Site Editor, edit, publish, review the PR
(the build runs `check:cms`), merge, and check the deployed site.
