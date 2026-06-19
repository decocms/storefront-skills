# Checkout edge cases

The journey ends when the engine asserts that `data-qa-checkout-page` is visible. The path between minicart and that assertion varies by store. Known patterns:

## Pattern 1 — Inline checkout (same-origin)

Most common. Clicking `data-qa-minicart-checkout` navigates to `/checkout` or `/finalizar` on the same domain. The checkout page is part of the deco app. `data-qa-checkout-page` lives in the route component for `/checkout`.

**No special handling needed.** The default journey works.

### Asserting by URL instead of a DOM marker (`features.checkoutUrlPattern`)

If you'd rather not mark a checkout DOM element — the checkout page is opaque/external, the route is awkward to mark, or you simply prefer a URL assertion — set a Playwright URL glob in `.qarc.json`:

```json
{ "features": { "checkoutUrlPattern": "**/checkout**" } }
```

The engine then passes the checkout step when the post-click URL matches the glob, and `data-qa-checkout-page` is **not** required. Unlike `checkoutCrossOrigin`, it does **not** require the origin to change — it just checks the URL, so it works for same-origin checkouts too. *(Learning: Montecarlo settled on `"**/checkout**"`; commit "validate checkout by URL".)*

**This is the recommended default whenever the checkout DOM isn't yours to mark** — including VTEX served same-origin at `/checkout` (see Pattern 2a). When the store doesn't own the checkout markup, asserting the URL is cleaner and more robust than reaching for a selector in someone else's DOM. *(Learning: aviator — VTEX same-origin checkout, 0 redirects; `checkoutUrlPattern: "**/checkout**"` was the clean fix, no DOM marker needed.)*

## Pattern 2 — VTEX checkout: figure out same-origin vs cross-origin FIRST

VTEX checkout lives outside the deco repo, so you can't add `data-qa-checkout-page` to its JSX. But there are **two very different cases**, and picking the wrong one makes step 8 fail. Decide by inspecting the live checkout before configuring:

```sh
# does /checkout redirect to a DIFFERENT origin, or stay same-origin?
curl -s -o /dev/null -w "final: %{url_effective}\nredirects: %{num_redirects}\n" -L "https://STORE.com/checkout"
```

### 2a — Same-origin checkout (VTEX *legacy* checkout — the common case)

`https://STORE.com/checkout` returns 200 with **0 redirects** — the checkout renders on the storefront's own origin (e.g. `www.osklen.com.br/checkout`). The checkout DOM belongs to VTEX, **not to your deco repo**, so there's nothing of yours to mark `data-qa-checkout-page` on. Two valid options:

**Recommended (default): assert the URL — don't mark a DOM that isn't yours.** Set a URL glob and skip the DOM marker entirely:

```json
{
  "features": { "checkoutUrlPattern": "**/checkout**" }
}
```

This is the clean path for VTEX same-origin: the engine passes the checkout step when the post-click URL matches, no marker required. (Detail in "Asserting by URL instead of a DOM marker" above.) *(Learning: aviator — VTEX same-origin, 0 redirects; `checkoutUrlPattern` was the fix.)*

**Alternative: map the slug to VTEX's stable DOM hook.** If you'd rather assert on the DOM, the engine's default checkout-step mode (wait for `[data-qa-checkout-page]`) works **because Playwright can read the same-origin DOM** — map the slug to a selector VTEX already renders, via the `selectors` override:

```json
{
  "selectors": { "data-qa-checkout-page": "#checkoutMainContainer" }
}
```

VTEX legacy checkout always renders `<body id="checkoutMainContainer" class="…-vtexcommercestable-com-br …">` (other stable hooks: `.checkout-container`, `#cart-title`, `#orderform-title`). `#checkoutMainContainer` is present in the very first HTML response, so it resolves immediately. **Do NOT set `checkoutCrossOrigin` here** — the checkout origin doesn't change, and `checkoutCrossOrigin: true` asserts the origin *did* change, so it would fail. Confirm the selector exists: `curl -s https://STORE.com/checkout | grep -o 'id="checkoutMainContainer"'`.

> A `GET /checkout?orderFormId=test` returning **403 when probed outside the journey is normal** (no session / orderForm yet) — it does not mean checkout is broken. Inside the journey, with a real cart built up, the navigation lands on `/checkout` and matches `checkoutUrlPattern`. Don't let a standalone 403 probe push you toward `checkoutCrossOrigin`; trust the redirect count from the `curl … -L` check.

### 2b — Cross-origin checkout (redirects to `secure.STORE.com` / `*.vtexcommercestable.com.br`)

`/checkout` 30x-redirects to a **different origin**. Playwright can't read cross-origin DOM, so use the engine feature flag:

```json
{
  "features": { "checkoutCrossOrigin": true }
}
```

With `checkoutCrossOrigin: true`, the checkout step asserts the origin changed AND the URL contains `/checkout` (no DOM marker). On `localhost` base URLs the engine **skips** the checkout assertion (cross-origin isn't validable locally — "rode contra o preview/prod"); it only asserts on preview/prod. The product-title persistence check is skipped in this mode.

> **Learning (Osklen, VTEX):** `/checkout` returned 200 with 0 redirects → **same-origin** (case 2a). `checkoutCrossOrigin: true` was wrong (it failed because the origin never changes). The fix was `selectors["data-qa-checkout-page"] = "#checkoutMainContainer"`. Always run the `curl … -L` redirect check before choosing 2a vs 2b.

## Pattern 3 — Lost session on subdomain

Some stores set cart cookies on `STORE.com` but the checkout lives on `checkout.STORE.com`. The cookie doesn't transfer, so the cart appears empty on checkout. This is a **real bug** the engine should catch.

The engine validates by extracting `data-qa-pdp-title` text on PDP and re-finding it on the checkout page. If the title doesn't appear in checkout DOM, the journey fails with "product persistence" error.

**This is the desired behavior — do not work around it.** If a store has this bug, the QA failure is correct. File issues in the store repo, don't override.

## Pattern 4 — Login wall before checkout

Some B2B stores require login before reaching `/checkout`. Default journey fails because the engine doesn't authenticate.

**Handling:**
- Phase 1 should detect login-gated checkout (look for `Login` or `Sign in` components in checkout route).
- If detected, do NOT drop the `.qarc.json` opt-in until the auth flow is solved — otherwise the control-plane will run a journey that can't complete and post a red Check Run. Surface to user: "This store requires login before checkout. The journey can't complete without authentication. Add a test user to `.qarc.json` and consult engine docs on auth setup."

## Pattern 5 — CEP required to even add to cart

Brazilian stores often refuse to add a product to cart until a CEP is entered. The journey order matters:
1. Open PDP.
2. Enter CEP (`data-qa-cep-input` + `data-qa-cep-submit`).
3. THEN click buy button.

The engine handles this automatically if `data-qa-cep-input` and `data-qa-cep-submit` are marked. If they're NOT marked but the buy button refuses to add, the journey fails at step 5 (add-to-cart) with no clear reason. Phase 1 should warn:

> Detected potential CEP gating (state's `requireCep: true` config). Make sure to mark `data-qa-cep-input` and `data-qa-cep-submit` — otherwise add-to-cart may fail.

## Pattern 6 — Multiple buy buttons on PDP (variant + sticky bar)

A PDP often has the main buy button AND a sticky mobile bar with another buy button (both can have the same `data-qa-buy-button`). The engine clicks the first one matched by the locator.

**Handling:**
- If both work, the engine just clicks the first. No problem.
- If one is hidden behind a `display:none` or off-screen, the engine handles via Playwright's auto-wait + visibility check.
- Edge case: variant selector (color/size) keeps the buy button **disabled** until a variant is picked. On **engine ≥ 0.5** the engine clicks the first available `data-qa-variant-option` after PDP load **and then** clicks the (now-enabled) `data-qa-buy-button` — so marking the options alone works. On the **older click-buy-first order** the disabled first click was a no-op and the buy button also needed `data-qa-variant-confirm` (see `data-qa-conventions.md` → `data-qa-variant-confirm`, Cases A/B).

**`data-qa-variant-option` is canonical** — mark the variant options whenever a store gates add-to-cart behind selection. Key detail: mark the **visible, clickable** element (usually a styled `<label for={…}>`), NOT a `hidden` `<input type="radio">`, and cover **every render branch** (product type often branches the JSX).

> **Learning (Osklen, VTEX):** the PDP showed "Selecione um tamanho" and `data-qa-buy-button` stayed `disabled` until a size was clicked. Radios were `class="hidden"`; the clickable targets were `<label for={size}>` in three branches (`isShoes`, unique-size, apparel). Marking those labels with `data-qa-variant-option` is what unblocks the journey. If a future store also requires a *color/group* choice before sizes appear, mark that selector too and note it in the PR body.

## When to add a slug-override in .qarc.json

The `selectors` block of `.qarc.json` lets a specific slug fall back to a CSS selector instead of `[data-qa-<slug>]`. Use sparingly — overrides defeat the purpose of standardization.

> **⚠️ An override only applies when the `[data-qa-<slug>]` attribute exists NOWHERE in the DOM.** The engine's `findSelector` tries the raw `[data-qa-<slug>]` selector **first** and only falls back to `selectors[slug]` when that match comes up empty. So an override **cannot redirect** a slug that's already present — e.g. if you over-marked `data-qa-category-link` on several links, the raw selector matches the (wrong) first one and your override is silently ignored. The error message's "…or set overrides.selectors[…]" hint is misleading in that case: the real fix is at the JSX source (mark only the right element). See `references/category-link-disambiguation.md`. *(Learning: aviator.)*

Valid reasons to use an override:
- **External component impossible to wrap** (rare). E.g., a Web Component shadow-rooted by the design system.
- **Temporary while waiting on a design system PR.**
- **Multi-buy-button page where the first match is wrong** and a more specific selector is needed.

Invalid reasons (do not use overrides for these):
- "It's easier than marking the JSX." Mark the JSX.
- "Selector works locally." Selectors break across viewports and platforms. Mark the JSX.
