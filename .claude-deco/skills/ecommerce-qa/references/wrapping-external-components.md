# Applying data-qa-* to components from external packages

When the JSX target is imported from a package (e.g., `@deco/storefront`, `deco-react`), you cannot modify the component definition. Three strategies, in order of preference.

## Decision flow

```
Component is from a package?
├── No  → Edit the JSX directly (native or local component). Stop reading.
└── Yes → Does the component forward `data-*` props to its root DOM element?
         ├── Yes (confirmed)   → Strategy A: pass at callsite.
         ├── Unknown           → Strategy A first; verify; fall back to B if fails.
         └── No (filters)      → Strategy B: wrapper element.
```

## Strategy A — Pass at callsite (preferred)

Apply the `data-qa-*` attribute as a prop on the component element. Most well-built components forward unknown DOM attributes to the root element.

```tsx
// Before
<Button onClick={addToCart}>Buy now</Button>

// After
<Button data-qa-buy-button onClick={addToCart}>Buy now</Button>
```

**How to verify it works:**

1. Read the package's TypeScript types if available: `node_modules/@deco/storefront/Button.d.ts`. If the props extend `React.HTMLAttributes<HTMLButtonElement>` or similar, `data-*` is forwarded.
2. Run the dev server, render the component, inspect the DOM. The attribute should appear on a real HTML element.
3. If types aren't available and dev server isn't running, default to Strategy B — wrapper is safe.

## Strategy B — Wrapper element

Wrap the component in a generic `<span>` or `<div>` carrying the `data-qa-*`. The wrapper has no semantic effect on the component but gives the engine a reliable selector.

```tsx
// Before
<Button onClick={addToCart}>Buy now</Button>

// After (inline-level wrap)
<span data-qa-buy-button>
  <Button onClick={addToCart}>Buy now</Button>
</span>
```

**Wrapper element choice:**

- `<span>` for inline contexts (buttons, links inside text).
- `<div>` for block-level contexts (cards, sections).

**Pitfalls to watch for:**

- A wrapper around a flex/grid child may break layout (the wrapper becomes the flex item, the child no longer is). Verify visually after the edit if the component sits in a flex parent.
- A wrapper around an `<a>` or `<button>` does NOT make the wrapper clickable — that's fine for QA purposes (the engine clicks the inner element), but it means the wrapper is "invisible" to user interaction.

## Strategy C — Open PR upstream (out of scope for v1)

If the same external component is used across many stores, the right long-term fix is to add `data-qa-*` directly in the design system / package. This skill does NOT do that — it's a separate workstream the user owns.

Mention it in the PR body as a follow-up: "Component `Button` from `@deco/storefront` was wrapped because props are filtered. Consider adding `data-qa-*` forwarding upstream."

## Detecting that props are filtered

A package component filters props (and Strategy A fails) if:

- The component uses an allowlist destructuring: `function Button({ children, onClick }: Props) { return <button>{children}</button>; }` — extra props are dropped.
- TypeScript types do NOT extend `React.HTMLAttributes` or similar.
- Manual inspection in the rendered DOM shows the attribute missing on the root element.

Default to wrapping when in doubt. The diff cost of a wrapper is small; debugging a silently-dropped attribute later is expensive.

## Recording the strategy

In the Phase 2 mapping table, record which strategy was used:

| Slug | File:Line | Element source | Strategy | Confidence |
|---|---|---|---|---|
| `data-qa-buy-button` | `sections/PDP.tsx:42` | local `<BuyButton>` | Edit component def | HIGH |
| `data-qa-cart-icon` | `sections/Header.tsx:18` | `@deco/storefront/Icon` | Wrapper `<span>` (filters props) | HIGH |
| `data-qa-product-card` | `sections/ProductShelf.tsx:24` | local `<ProductCard>` (no spread) | Edit component def + add spread | MEDIUM |

The strategy column makes the PR diff understandable to reviewers.
