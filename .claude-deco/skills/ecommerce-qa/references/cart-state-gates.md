# Cart-state assertions & gotchas

`@decocms/qa` ≥ 0.3.0 asserts cart state **inside the journey** — empty cart,
quantity, variant, price floor, persistence-after-reload, and minicart controls.
With the engine pinned (≥ 0.5.x) you scaffold nothing: just **mark the cart-state
slugs** and the journey fails the verdict when the cart is broken.

- Mark `data-qa-pdp-price`, `data-qa-minicart-items` (the line-list wrapper —
  must render in BOTH the empty and filled minicart states, or the empty-cart
  gate silently no-ops), `data-qa-minicart-item`, `-item-name` / `-variant` /
  `-price`, `-item-remove`, and the `data-qa-quantity-value` / `-increment` /
  `-decrement` stepper.
- Each assertion is gated on its marker's presence (missing marker → skipped,
  not failed), so mark them all for full coverage.
- `list-slugs` may not print these (they're resolved from config at runtime) —
  don't conclude they're unsupported from `list-slugs` alone; check the version.

## Gotcha: mark the REAL add-to-cart path (dead code)

Before assuming a file matters, **trace what `data-qa-buy-button` actually
executes.** deco storefronts often ship a file that *looks* like the hook but
isn't wired: `sdk/useAddToCart.ts` may be dead code (grep for imports — if
nothing imports it, editing it is a no-op). The real path is usually a local
`useAddToCart` in `AddToCartButton/common.tsx` whose `onAddItem` comes from a
platform wrapper (`AddToCartButton/vtex.tsx`) where the real
`useCart().addItems({ quantity })` lives. A "break" applied to the dead file
proves nothing — the cart still fills, the assertion still passes.

## Gotcha: pt-BR price parsing

The price assertion compares the PDP price to the cart line price, so both must
parse. `formatPrice(x,"BRL")` renders integers **without** cents
(`"R$ 1.997"`, `.` = thousands separator); `formatPriceWithCents` renders
`"R$ 1.997,00"` (`,` = decimal). Robust pt-BR parse: if the token has a comma,
comma=decimal and dots=thousands; otherwise dots=thousands and cents=00. A line
price span often holds the list price (struck) + the selling price — take the
LAST price token.

> **Legacy (engines < 0.3.0).** Those engines had no native cart-state assertion
> — a broken cart passed green — so the skill once shipped two companion
> Playwright scripts as a hard gate. With the engine pinned ≥ 0.5.x that path is
> unreachable; the scripts and their `qa:assert` task/step were removed. If you
> ever inherit a repo pinned to a pre-0.3.0 engine, recover them from git history.
