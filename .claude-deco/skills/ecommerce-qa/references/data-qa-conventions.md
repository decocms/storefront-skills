# data-qa-* Canonical Attributes

Boolean attributes marking elements that the QA engine drives during the purchase journey. These are mirrored from the engine's source of truth (`DEFAULT_DATA_QA_SLUGS`). Whenever the engine updates the canonical list, update this file too.

## Conventions

- **Form:** `data-qa-<slug>` boolean attribute. No value. No instance ID suffix.
- **Naming:** kebab-case, semantic, journey-step-aligned.
- **Multiplicity:** when a slug appears multiple times on a page (e.g., `data-qa-product-card` on PLP), the engine resolves ambiguity via relative locators (e.g., "first buy button within first product card"). Do not number instances.
- **Optional slugs:** some slugs are optional (search, CEP). The engine skips the related journey step if not present.

## The slugs

### `data-qa-category-link`
Anchor that navigates from home to a PLP. Apply to the category links in the header, mega-menu, mobile drawer, or first hero carousel that lands on a category. The engine prefers the first **visible** match (it's safe to mark mobile + desktop versions both).

- **Placement:** `<a href="/c/...">` element or its equivalent in `<Link>`.
- **Cardinality:** multiple OK; engine resolves visibility-aware.
- **Drawer-only links:** if the only `data-qa-category-link` lives inside a closed hamburger drawer, also mark `data-qa-menu-trigger` (see below) so the engine can open the drawer before clicking.
- **⚠️ Generic nav component → mark ONLY links that open a PLP.** When the header renders institutional links, dropdown triggers and category links through one shared component (e.g. `NavItem.tsx`) with identical markup, marking the generic anchor puts `data-qa-category-link` on **all** of them. The engine's `findSelector` clicks the **first `[data-qa-category-link]` in DOM order** (usually the institutional link) → a product-less page → `enter-pdp` fails with `data-qa-product-card missing`. A `.qarc.json` `selectors` override does **not** fix this (the raw attribute already matches, so the override is never consulted). Fix at the JSX source by gating the attribute on a store-specific PLP discriminator (e.g. `href?.includes("sort=")`). Full write-up + verification in `references/category-link-disambiguation.md`. *(Learning: aviator.)*

### `data-qa-menu-trigger` (optional but recommended for mobile-first headers)
The hamburger / menu-opener button that reveals a navigation drawer containing the category links. Used by the engine at step 2 (`navigate-plp`) when no visible `data-qa-category-link` exists — engine clicks the trigger to open the drawer, then re-resolves the category link.

- **Placement:** the `<button>` (or button-shaped element) that toggles the menu drawer. Often has `aria-label="Menu"`, contains a hamburger icon, or wraps a CSS checkbox.
- **Cardinality:** one per layout context (mobile header). Mark both if mobile + tablet headers render separately — engine picks the first visible.
- **Skip if:** the store has no drawer — desktop-style always-visible nav with `data-qa-category-link` reachable without clicking anything.

Without this slug, drawer-gated category links cause step 2 to fail with "category link not visible" — the closed drawer's `opacity-0 pointer-events-none` blocks Playwright's actionability check.

**⚠️ Two-level mobile drawers (the engine only opens ONE level).** Step 2 does exactly: find visible category-link → else click `data-qa-menu-trigger` → poll for a visible category-link in the opened drawer. If the open drawer's top-level items are **submenu togglers** (a `<button>` with a `>` chevron that opens a *second* level, where the real PLP `<a href>` lives), there is **no visible `data-qa-category-link` at the top level** and step 2 fails — the engine won't drill into the submenu. Do **not** mark the submenu toggler as a category-link (clicking it doesn't change the URL → `waitForURL` times out). Options: (a) if the top level has any leaf category link, mark that; (b) otherwise **scope the suite to `"viewports": ["desktop"]`** in `.qarc.json` — the desktop nav usually exposes direct category links, and desktop covers the full purchase flow. *(Learning: Osklen's mobile drawer top level — New In/Men/Women/Shoes/Outlet — are all submenu buttons; desktop nav buttons navigate directly. Suite scoped to desktop.)*

### `data-qa-dismiss` (optional but recommended when a blocking popup exists)
The close control (the ✕) of a blocking overlay/popup — newsletter, cookie-consent, or age-gate — that appears before the shopper reaches a product. The engine clicks every visible `[data-qa-dismiss]` to clear the overlay before/while navigating, then clicks normally (it never clicks *through* an overlay).

- **Placement:** the `<button>` (or button-shaped element) that closes the popup. Mark the ✕ / "Fechar" / "Não, obrigado" control — NOT the backdrop and NOT a CTA inside the popup.
- **Cardinality:** one per popup; mark each distinct popup's close control if the store shows several.
- **Why mark it:** the engine masks automation (real UA, `AutomationControlled` disabled), so the store can't detect the run to suppress the popup — it sees the real shopper experience. A full-screen overlay (`position:fixed;inset:0`) intercepts the step-2/3 clicks and fails the journey. Marking the ✕ makes dismissal **deterministic and zero-config** — no `?qa=1`-style branching in the store. (There is also an opt-in `features.dismissOverlaysHeuristic` in `.qarc.json` that guesses generic ✕/`fechar`/`close` buttons, but `data-qa-dismiss` is preferred and reliable.)
- **Skip if:** the store shows no blocking popup before the product flow.

*Common case: a newsletter modal that opens on first scroll/mousemove with a ✕ that has only an `onClick` and no Escape handler — pressing Escape won't close it, so mark the ✕ with `data-qa-dismiss`.*

### `data-qa-product-card`
The wrapper of a single product card on PLP. The engine clicks the first match to navigate to PDP. Children of this element must include the PDP link.

- **Placement:** the outermost element of the card component (often `<a>` or `<article>`).
- **Cardinality:** many per page.

### `data-qa-pdp-title`
The product title `<h1>` on PDP. Used by the engine to extract the title and assert that the SAME product persists into checkout.

- **Placement:** the `<h1>` element only. Never a generic container.
- **Cardinality:** exactly one per PDP.

### `data-qa-buy-button`
The "Add to cart" / "Comprar" CTA on PDP. **PDP only.** Do NOT mark quick-add buttons inside PLP cards with this slug.

- **Placement:** the `<button>` (or button-shaped link) that triggers add-to-cart on PDP.
- **Cardinality:** one primary buy button per PDP. If variants render multiple buy buttons, mark the primary (first) one.

### `data-qa-variant-option` (required when add-to-cart is variant-gated)
The size/variant option(s) on the PDP. Many stores (e.g. fashion/apparel on VTEX) keep the buy button **disabled until a variant is selected** ("Selecione um tamanho").

> ⚠️ The slug is `data-qa-variant-option` (confirm with `qa list-slugs`). An earlier draft of this skill guessed `data-qa-pdp-variants` — that name is **wrong** and the engine ignores it.

**Know the engine's exact step-5 order — it changed between engine versions, and it's the source of the gotcha below:**

- **Engine ≥ 0.5 (current, the common case): variant is pre-selected BEFORE buy.** Order is: poll & click first in-stock `data-qa-variant-option` → click the now-enabled `data-qa-buy-button` → check cart count. Because buy is only clicked *after* the size is chosen, marking the variant options alone is enough — see the `data-qa-variant-confirm` note for when it's still needed.
- **Older click-buy-first order:** `click data-qa-buy-button` → poll & click first in-stock `data-qa-variant-option` → poll & click `data-qa-variant-confirm` → check cart count. Here the first buy click hits a still-disabled button (no-op), which is exactly what made the `data-qa-variant-confirm` BOTH-marking necessary.

Confirm the order for the version you pinned (the engine's docs / `list-slugs` output reflect the current behavior).

- **Placement:** the **visible, clickable** option element — usually the `<label for={…}>`, NOT the underlying `<input type="radio" class="hidden">`. Stores frequently hide the radio and style a `<label>` as the button; mark the label so Playwright can actually click it.
- **Mark every render branch.** Selectors often branch by product type (shoes / single-size / apparel) — mark the option in each branch so coverage holds regardless of product.
- **Cardinality:** many per PDP (one per size). The engine resolves the first in-stock / clickable one.
- **Skip if:** the store adds to cart without any variant choice (single SKU, or selection is optional).

### `data-qa-variant-confirm` — when it's needed (engine-version-dependent) 🔑
Whether you need this slug depends on the engine's add-to-cart order (see the step-5 order above). Two cases, both valid:

**Case A — Engine ≥ 0.5 (pre-selection order, the common case): usually NOT needed.** The engine selects the variant *before* clicking buy, so it clicks an already-enabled `data-qa-buy-button` and the item adds normally. Marking the in-stock `data-qa-variant-option`(s) in every render branch is sufficient — leave `data-qa-variant-confirm` off unless the store has a genuine separate confirm step (Case C).

**Case B — Older click-buy-first order: mark the buy button with this too.** When the engine clicks `data-qa-buy-button` **first** and *then* selects the variant, a variant-gated buy button is **disabled** at that first click → the click is a no-op → and the engine **never clicks buy again**. Result: nothing is added, the minicart opens empty, and step 8 (checkout) fails with "minicart-checkout not found". This looks like a VTEX/cart/session problem but is **not** — it's purely the click-order. **Fix:** put `data-qa-variant-confirm` on the **same buy button** (in addition to `data-qa-buy-button`). The flow becomes: click buy (disabled, no-op) → select size (buy enables) → click `data-qa-variant-confirm` (= the now-enabled buy button) → item added. The buy button legitimately serves double duty as the post-variant "confirm".

```tsx
<Button data-qa-buy-button data-qa-variant-confirm {...btnProps}>Adicionar à Sacola</Button>
```

**Case C — Genuine separate confirm element (any version):** if the store has a modal flow (click buy → a size selector opens → a distinct "confirm" button), mark *that* element with `data-qa-variant-confirm`. If add-to-cart needs no variant at all, omit this slug.

> **Learning (Osklen):** on the older click-buy-first engine, the whole journey passed locally **except** step 5/8 until the buy button was also marked `data-qa-variant-confirm`. Symptom was "empty minicart / no checkout button" — easy to misread as a VTEX-localhost limitation; the real cause was the disabled-buy click-order. **On engine ≥ 0.5 this same store would pass with just `data-qa-variant-option` marked**, because the engine now pre-selects the size before clicking buy — so reach for the BOTH-marking only when the version/flow actually needs it (Case B/C).

### `data-qa-cart-count` (optional, best-effort)
The cart item-count badge near `data-qa-cart-icon`. The engine reads it to assert the count incremented after add-to-cart. Mark the element whose text is the count (e.g. the badge `<span>`). If the badge only renders once `count > 0` and hydrates after the add, the engine may still log "cart count not verified" — that's non-fatal (the step passes without it).

> **Learning (Osklen, VTEX):** add-to-cart stayed disabled until a size `<label>` was clicked. Radios were `class="hidden"`; the clickable elements were the styled `<label for={size}>` across three branches (`isShoes`, unique-size, apparel). Marking those labels with `data-qa-variant-option` — not the hidden inputs — is what lets the engine satisfy the gate. The slug name was confirmed via `qa list-slugs`, not assumed.

### `data-qa-cart-icon`
The cart icon in the global header. Clicking it should open the minicart or navigate to `/cart`.

- **Placement:** the icon button in the header — typically `<button>` or `<a href="/cart">`.
- **Cardinality:** one per page (header may render twice on mobile + desktop, both can carry the attribute; engine picks first visible).

### `data-qa-minicart`
The container of the minicart drawer / popup. Engine asserts visibility after clicking `data-qa-cart-icon`. If the store goes to `/cart` page instead of a drawer, mark the cart page wrapper.

- **Placement:** the drawer's root element.
- **Cardinality:** one.

### `data-qa-minicart-items` (cart-state, engine ≥ 0.3.0)
The minicart line-list CONTAINER (the `<ul>` / list wrapper that holds the cart lines). The engine uses it for the empty-cart and line-count assertions.

- **Placement:** mark the list wrapper in the **filled** branch AND the body container in the **"cart is empty"** branch. **It must render in BOTH states** — the engine's empty-cart check is `wrapperPresent && 0 rows`, so if the wrapper is absent on the empty state that gate silently no-ops.
- **Cardinality:** one per minicart.

### `data-qa-minicart-checkout`
The "Finalize purchase" / "Go to checkout" CTA inside the minicart (or on `/cart` page if no drawer). Clicking it must navigate to `/checkout/*`.

- **Placement:** the CTA button inside the minicart drawer or cart page.
- **Cardinality:** one inside the minicart.

### `data-qa-checkout-page`
Wrapper of the `/checkout` page (or whichever URL the journey ends on). Engine asserts presence to confirm the journey reached checkout.

- **Placement:** the root container of the checkout page (Island, route component, or layout root).
- **Cardinality:** one.
- **Note:** if checkout is on a subdomain or an external page (VTEX `/checkout/#/cart`, custom `/finalizar`), this still applies — mark the wrapper at the destination.

### `data-qa-cep-input` (optional, BR stores)
The CEP input on PDP or cart (used by the engine to trigger shipping calculation).

- **Placement:** `<input type="text">` for CEP. Apply to all occurrences on PDP and cart pages.
- **Cardinality:** typically two (PDP + cart). Both should be marked.
- **⚠️ Auto-submit gotcha:** the engine's step 4/7 flow is *fill cep-input → click cep-submit*. It resolves `cep-submit` **before** filling. If the field **auto-calculates on input change** (e.g. `onChange → verifyCEP()` that flips a signal and **swaps the submit button for a "clear" button**), the `cep-submit` element unmounts after fill and the engine clicks a detached node → 30s timeout → step fails. The engine cleanly **skips** shipping (steps 4 & 7) only when *neither* cep slug is present. So for auto-submit CEP components, **leave `data-qa-cep-input`/`data-qa-cep-submit` unmarked** (shipping is optional) rather than half-marking. *(Learning: Osklen — the CEP arrow button was `hasSendCEP ? clear : submit`, so it vanished on fill; removing both markers made step 4/7 skip and turned a hard failure into a clean skip.)*

### `data-qa-cep-submit` (optional, BR stores)
The "Calculate shipping" button next to `data-qa-cep-input`. Engine clicks after typing the CEP.

- **Placement:** the `<button>` adjacent to the CEP input.
- **Cardinality:** matches `data-qa-cep-input` (one per location).

### `data-qa-search-input` (optional)
The header search input. Used by the engine for optional search-driven PDP entry (not part of v1 journey).

- **Placement:** `<input type="search">` or text input in the header search.
- **Cardinality:** one.

### `data-qa-quantity-value` / `-increment` / `-decrement` (cart-state, engine ≥ 0.3.0)
The minicart line's quantity stepper. The engine asserts the cart holds the right count after add-to-cart, and (via `-increment` / `-decrement`) that the controls work.

- **Placement:** mark whatever shows the quantity. The engine reads, in order: the **attribute value** (`data-qa-quantity-value={quantity}`), then an `<input value>`, then the element's text. For an `<input type="number">`, **carry the live value on the attribute itself** — `<input data-qa-quantity-value={quantity} value={quantity} />` — so the engine reads the real number instead of logging "quantity not verified". No mirror `<span>` is needed.
- **Scope:** generic stepper — when several lines render, the engine scopes by the `data-qa-minicart-item` ancestor.

> **Learning (Montecarlo):** the stepper was an `<input type="number">` whose value the engine couldn't read until `data-qa-quantity-value={quantity}` carried it on the attribute (commit "expose real quantity value").

## Visibility-aware resolution

For slugs with multiple matches on the page (`data-qa-product-card`, `data-qa-cart-icon`, `data-qa-cep-input`, `data-qa-category-link`), the engine prefers the **first visible** element. Safe to mark mobile + desktop variants both — engine picks correctly at runtime based on viewport.

If no visible element matches, the engine falls back to the first DOM match (so single-match cases are unchanged).

## Validation checklist

After Phase 3 of the skill, verify before opening the PR:

- [ ] At least one of: `data-qa-category-link`, `data-qa-search-input` exists.
- [ ] The **FIRST `data-qa-category-link` in DOM order** lands on a real PLP (verify via `qa doctor` on its target, or `curl <url>/ | grep -oE '<a[^>]*data-qa-category-link[^>]*>'`) — guards against the generic-nav over-marking pitfall. See `references/category-link-disambiguation.md`.
- [ ] If `data-qa-category-link` is drawer-gated (mobile-first header), `data-qa-menu-trigger` is marked.
- [ ] If a blocking popup (newsletter / cookie-consent / age-gate) appears before a product is reached, `data-qa-dismiss` marks its close (✕) control.
- [ ] `data-qa-product-card` exists (multiple OK).
- [ ] `data-qa-pdp-title` exists exactly once on PDP route.
- [ ] `data-qa-buy-button` is on PDP, NOT on PLP cards.
- [ ] If add-to-cart is variant-gated (button disabled until a size is picked): `data-qa-variant-option` marks the visible clickable option in every render branch.
- [ ] `data-qa-cart-icon` and (`data-qa-minicart` OR cart page wrapper) both exist.
- [ ] `data-qa-minicart-checkout` exists.
- [ ] `data-qa-checkout-page` exists on `/checkout` route OR `features.checkoutUrlPattern` is configured.
- [ ] If the store has shipping calculation: `data-qa-cep-input` + `data-qa-cep-submit` paired.
