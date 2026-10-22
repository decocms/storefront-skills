# React and SPA pitfalls from Preact/Fresh ports

Fresh rendered islands on full page loads and tolerated Preact-isms. TanStack
is React with client-side navigation: components are reused across routes,
inline scripts don't re-run, and React is strict about controlled inputs and
hydration. Most of these pass a reload test and fail on a **SPA click**.

Always test by clicking links the app rendered. `click()` on an `<a>` you
appended to `body` does a full reload. Confirm SPA with
`performance.getEntriesByType("navigation").length === 1`.

---

## Preact and Fresh leftovers

Found by a Playwright prod × local sweep on Farm (T-UIBROKEN, #367):

| Symptom | Root cause | Fix |
|---|---|---|
| Typing in an input erases every letter | `value={…}` without `onChange` (Preact tolerated it; React makes it read-only) | `defaultValue` |
| Modal/zoom never opens on mobile | `<Modal open={false}>` controlled checkbox without `onChange` | uncontrolled / `defaultChecked` |
| "Add to cart" from a secondary component does nothing | `window.STOREFRONT.CART.addToCart` / `window.addToCart` — the Fresh global SDK doesn't exist | `useCart().addItems` |
| Form does nothing | `hx-post` replaced by `preventDefault` + `TODO` | wire to a server function |
| Popup library never loads | `<script src>` inside a deferred/client-rendered section never executes | load on demand |
| Label doesn't open modal | raw HTML strings with `htmlFor` / `className` | `for` / `class` in strings |
| Error on every keystroke | `onInput={useScript(...)}` passes a string as handler | function handler |
| 2nd CEP lookup never renders | code removed React-owned DOM children by hand | reset state; only `form.reset()` touches DOM |
| Search steals focus every 300 ms | `setInterval(focus)` never cleared | bounded attempts, cancel on close/navigation |
| Double click adds 2; coupon re-sent on blur | no in-flight guard | pending guards |
| State "stuck" after re-render | state kept in `classList` | React state |
| Click before hydration lost | — | read `el.checked` on mount |

```bash
grep -rnE "window\.STOREFRONT|window\.addToCart|hx-(post|get|on|trigger)|TODO\(T" src
grep -rnE "on[A-Z][a-zA-Z]+=\{useScript" src
grep -rnE "open=\{false\}" src
grep -rnE "<script[^>]+src=" src/sections src/components
grep -rnE "\.removeChild\(|\.innerHTML\s*=|replaceChildren\(" src/components src/sections
```

For `value=` without `onChange`, run dev with the console open on every form —
React warns "You provided a `value` prop without an `onChange` handler".

## Inline scripts do not run on SPA navigation

**Farm T-TIMERSPA, T-ETCFOLDSPA:** `<script>` elements from `useScript` /
`useScriptAsDataURI` that React inserts on the client **never execute** — only
SSR-parsed scripts run. Countdown frozen at 00:00:00, header under the timer,
sticky gallery that never shrinks — all fine after F5.

Pattern: keep the inline script for pre-hydration on F5, make it idempotent,
and also run it from `useLayoutEffect` with cleanup.

```tsx
const initFolds = (id: string) => {
  const el = document.getElementById(id) as (HTMLElement & { __started?: boolean; __stop?: () => void }) | null;
  if (!el || el.__started) return;           // idempotent
  el.__started = true;
  const stops: (() => void)[] = [];
  el.__stop = () => stops.forEach((s) => s()); // remove listeners/observers
  // ...
};
useLayoutEffect(() => { initFolds(id); return () => document.getElementById(id)?.__stop?.(); }, []);
```

Also: `useScript(fn)` / `useScriptAsDataURI(fn)` where `fn` is **imported**
from another module serializes differently on SSR and client (Farm #361) —
declare a wrapper next to the function.

```bash
grep -rlnE "useScript\(|useScriptAsDataURI\(|<script" src/sections src/components
```

🧪 For each hit: reach the page by SPA click and check it works; go
PLP → PDP → back 3× and check listener counts stay stable.

## Same-route navigation reuses components

**Farm T-PDPGALKEY:** PDP → PDP is the same route (`$`), so `ProductDetails` is
reused.

1. `<img>` nodes reused with a new `src` → previous product's photos for ~1.2 s. Fix: `key` per product group on gallery components.
2. `if (!items.length) return null` **before** `useId()` → an instance going from a product without that block to one with it calls more hooks → React #310, PDP renders only header + footer. 13 other components had the same pattern.

```tsx
const galleryKey = product.inProductGroupWithID ?? product.productID;
<Gallery key={galleryKey} … />
```

```bash
grep -rn "react-hooks/rules-of-hooks" eslint.config.* .eslintrc* 2>/dev/null || echo "rules-of-hooks NOT enabled"
```

Validate any home-made scan against a known bug — Farm's awk scan "passed"
with zero hits because macOS awk didn't support the regex.

🧪 SPA-click PDP → PDP between products **with and without** optional blocks
(look, video, size guide); assert the first gallery `<img>` node changes.

## Hydration #418

**Farm T-HYD418B** (~2,750 users/day, 90% mobile PLP): GTM-injected scripts
call `body.appendChild` during parse and land between `</main>` and React's
tail scripts; React claims those inline scripts as its own during sliced
hydration → #418, whole page re-rendered on the client. Fix: before
`hydrateRoot`, move the app's tail scripts right after `<main>` (mark them,
e.g. `data-deco-tail`) — and keep the invariant "every node rendered after
`<main>` is recognized".

Other #418 causes:

- CMS / VTEX HTML with unbalanced tags in `dangerouslySetInnerHTML` → wrap with a `balanceHtml()`; truncate HTML at word boundaries, not as plain text.
- Block HTML inside `<p>` breaks the parse → use `<div>`.
- `dangerouslySetInnerHTML` on `<textarea>` throws in SSR → `defaultValue`.
- `location.origin` used during SSR → use a fixed origin.

```bash
grep -rn "dangerouslySetInnerHTML" src | grep -v balanceHtml
```

🧪 Mobile emulation, 6× CPU, GTM on, scroll during load, ~20 PLP loads: zero
#418. After hydration, any third-party `<script>` in `document.body.children`
with a `__reactFiber$*` key is a bug.

## Server functions cancelled on navigation

**Farm T-ATCSHEET, T-BAGRACE:** a TanStack server function is cancelled when
the user navigates away mid-request; cancelled at 50–250 ms it never reaches
VTEX. "+" then "checkout" lost the item. Also, on Fresh `addToCart` returned an
un-awaited promise so the "added" sheet opened instantly; with `await` it was
0.7 s late.

- Open UI optimistically before the `await`, close on failure.
- Track pending cart mutations; full-page links (especially `/checkout`) wait for them.
- `fetch(..., { keepalive: true })` on `pagehide` for writes.

🧪 WebKit: change quantity and click "checkout" within 300 ms — checkout shows
the new quantity. Same for "continue shopping" right after add-to-cart.

## Stale chunks after deploy

Every deploy removes old hashed chunks. Open tabs then 404 on `/assets/*.js`
(Farm 103–254 per deploy; Zee.Dog error screen). The router only reloads on
route-chunk failures; **section** chunks fail silently into the error boundary
(PDP without photos, price or buy button).

- `vite:preloadError` → one reload per chunk, guarded in `sessionStorage` (cooldown ~30 s).
- An inline `<head>` guard for when the main entry itself 404s.

🧪 Open a tab, deploy, SPA-navigate in that tab to a page with lazy sections.

Preload: `defaultPreload: "intent"` cost Farm 197 GB in 2.5 days (each hover
fetched a 1.6 MB `/_serverFn` PDP). Measure before enabling; prefer hover
≥ 150 ms or off.

## Browser memory leaks

**Granado minicart:** 1–2 GB per open, browser died at 3–4 GB.

- `@preact/signals` shims (`useSignalEffect` / `useComputed` without deps) → render loop.
- `useStore` expecting `{ unsubscribe }` but the signal returns a function → subscriptions pile up. Use `useSyncExternalStore` with a stable subscribe.
- Re-rendering every cart item on open/close; make open/close CSS-only, `React.memo` the list.
- `removeEventListener` with a new arrow function does nothing — keep the reference.
- `dataLayer` pushes of raw platform objects; polling cookies every 500 ms.

🧪 DevTools Memory: open/close the minicart 10× with **GTM on**, heap snapshot
before/after → flat.

## Legacy service worker

A Workbox SW from the old site kept intercepting requests (Zee.Now). Removing
`register()` does not uninstall it for past visitors: ship a `sw.js` that
unregisters itself.

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async () => {
  await self.registration.unregister();
  (await self.clients.matchAll()).forEach((c) => c.navigate(c.url));
});
```
