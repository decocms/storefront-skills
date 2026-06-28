# Locating JSX targets

Use this when running Phase 2 of the skill: find each canonical `data-qa-*` slug's target element(s) in the codebase.

## Core rule

**Never trust grep alone.** Grep produces candidates; Read confirms. A function named `addToCart` in `hooks/useCart.ts` is not the JSX button — the actual `<button onClick={addToCart}>` may live in a separate component file.

The flow:
1. Grep for semantic patterns (multiple aliases — list below).
2. Read each candidate file (use Read, target the line range from grep output).
3. Classify: native HTML / local component / external component / not the target.
4. Record `slug → file:line → strategy → confidence`.

## Search patterns per slug

Run these with Grep (case-insensitive, JSX/TSX globs). Combine results; dedupe by file.

| Slug | Patterns to grep |
|---|---|
| `data-qa-category-link` | `href=["']/c/`, `CategoryLink`, `categoryItem`, `mega-?menu`, `nav.*categor` |
| `data-qa-menu-trigger` | `MenuButton`, `Hamburger`, `MobileMenu.*Toggle`, `BurgerButton`, `aria-label=["']Menu`, `<button.*onClick=.*setMenuOpen`, `<label.*for=["']menu-?toggle` |
| `data-qa-dismiss` | `Newsletter`, `Popup`, `CookieConsent`, `AgeGate`, `CloseButton`, `aria-label=["'].*[Cc]lose`, `aria-label=["'].*[Ff]echar`, `onClick=.*[Cc]lose`, `onClick=.*dismiss`, `setOpen\(false\)` |
| `data-qa-product-card` | `ProductCard`, `product-card`, `productItem`, `<Card.*product`, `ProductSummary`, `ShelfCard` |
| `data-qa-pdp-title` | inside files matching `pages/products`, `routes/produto`, `pdp/`, `ProductDetails`: grep for `<h1`, `productName`, `name={.*name}` |
| `data-qa-buy-button` | `AddToCart`, `addToCart`, `BuyButton`, `buyButton`, `Comprar`, `Add to cart`, `Adicionar` |
| `data-qa-cart-icon` | `CartIcon`, `cart-icon`, `MinicartButton`, `<Icon.*cart`, `aria-label=["'].*cart`, `href=["']/cart` |
| `data-qa-minicart` | `Minicart`, `mini-cart`, `cartDrawer`, `CartDrawer`, `<Drawer.*cart`, `<Modal.*cart` |
| `data-qa-minicart-checkout` | inside minicart files: `Finalizar`, `Checkout`, `Concluir`, `href=["']/checkout`, `goToCheckout` |
| `data-qa-checkout-page` | files in `routes/checkout`, `pages/checkout`; root component of those routes |
| `data-qa-cep-input` | `cep`, `postalCode`, `ZipCode`, `shipping.*input`, `ShippingSimulator`, `<input.*type=["']text["'].*cep` |
| `data-qa-cep-submit` | adjacent to CEP input: `calcular`, `Simular`, `<button.*onClick=.*shipping` |
| `data-qa-search-input` | `<input.*type=["']search`, `SearchBar`, `searchTerm`, `<input.*placeholder=["'].*[Bb]uscar` |

## Gotcha-detection patterns (Phase 2.5)

Greps to *flag* the four Phase 2.5 gotchas. These are heuristics — confirm by Reading the file (see SKILL.md Phase 2.5). They have false negatives; the Phase 3.5 doctor/journey gate is the empirical backstop.

| Gotcha | Patterns to grep |
|---|---|
| CEP auto-submit (unmounts submit on fill) | in the CEP/shipping component: `hasSendCEP`, `onChange=.*[Cc]ep`, `verifyCEP`, `setCep`, a button swapped conditionally `? .*[Cc]lear.* : .*[Ss]ubmit` |
| Variant-gated buy (drives the variant-confirm decision) | on the PDP buy button: `disabled={!`, `disabled=.*selected`, `Selecione`, `Escolha.*tamanho`, `!sku`, `!selectedSku` |
| Two-level mobile drawer (submenu togglers) | in the drawer/menu: `setSubmenu`, `submenu`, `openSubmenu`, a top-level `<button>` with a chevron + `onClick` and **no `href`** |
| `minicart-items` empty-state absent | in the minicart: `items.length`, `cart.items.length ?`, `isEmpty`, `length > 0 ?` gating the list-wrapper render (wrapper must render in BOTH states) |

## Classifying the match

Once you have a candidate file + line, Read enough context (5-10 lines) to determine:

### Native HTML element

The JSX directly opens `<button>`, `<a>`, `<input>`, `<h1>`, `<div>`, etc. Apply the data attribute inline via Edit.

```tsx
// Before
<button onClick={addToCart} className="...">

// After
<button data-qa-buy-button onClick={addToCart} className="...">
```

### Local component (defined in this repo)

The JSX opens a component imported from a relative path within the repo — e.g., `import BuyButton from "../components/BuyButton.tsx"`.

Two options, in order of preference:
1. **Edit the component definition** (one change, applies everywhere it's used). Open the component file, add `data-qa-buy-button` to the root element. Verify the root spreads `...props` to forward arbitrary attributes.
2. **Edit the callsite** if the component is used in only one place AND modifying the definition feels invasive.

```tsx
// In components/BuyButton.tsx — preferred
export function BuyButton({ children, ...props }: Props) {
  return (
    <button data-qa-buy-button {...props}>
      {children}
    </button>
  );
}
```

### External component (from a package)

The JSX opens a component imported from a package — `import { Button } from "@deco/storefront"`, `import { AddToCart } from "deco-react"`, etc.

Cannot modify the component definition. Apply at callsite — see `wrapping-external-components.md`.

## Confidence scoring

When recording the Phase 2 mapping, assign each match a confidence:

- **HIGH** — single match, clearly the right element (e.g., a single `BuyButton` import on the PDP route).
- **MEDIUM** — multiple matches but most are clearly wrong (e.g., 3 hits for `addToCart`, two are in hooks/types, one is the JSX).
- **LOW** — ambiguous, multiple plausible JSX matches, or pattern not found.

**LOW confidence triggers human resolution.** Do not auto-edit. Leave a `{/* TODO(qa): mark with data-qa-<slug> */}` comment in the most likely candidate and list it in the Phase 2 table for the user to resolve.

## Storefront framework variations

deco.cx repos often build on patterns like deco-sites, deco-vtex-storefront, deco-shopify, etc. Common file conventions to expect:

- `sections/` — large composable blocks, often contain Header/Footer/ProductShelf.
- `islands/` — interactive client components in deco-cx. Buy buttons, CEP simulator, minicart often live here.
- `components/` — shared atoms/molecules.
- `routes/` — page routes (Fresh-style) with `.tsx` files matching URL paths.

For PDP-specific slugs (`data-qa-pdp-title`, `data-qa-buy-button`), filter your grep to PDP-related files first: routes matching `produto`, `product`, or sections rendering product details.
