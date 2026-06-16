# Disambiguating `data-qa-category-link` on a generic nav component

The single most common reason a fresh setup needs several iterations on a store with a "normal" header. The journey fails late — at `enter-pdp` with `data-qa-product-card missing` — but the **root cause is upstream**: the wrong link got marked as the category link.

## The trap: one component, three roles

Many deco storefronts render every header/menu entry through **one generic component** (e.g. `NavItem.tsx`, `MenuItem.tsx`, `HeaderLink.tsx`) that emits the **same markup** for three semantically different things:

| Role | Example | Leads to a PLP? |
|---|---|---|
| Institutional / editorial link | "Conheça o projeto" → `/asas-para-voar` | ❌ no products |
| Dropdown / submenu trigger | "Destaques" (no `href`, just opens a panel) | ❌ no navigation |
| **Real category / PLP link** | "Roupas masculinas" → `/roupas-masculinas?sort=...` | ✅ has `data-qa-product-card` |

If you mark `data-qa-category-link` on the generic `<a>` (or on the component's root), **all three roles inherit the attribute** — including the institutional links and (if they render an anchor) the dropdown triggers.

## Why this fails at `enter-pdp`, not at `navigate-plp`

The engine's `findSelector` resolves a slug to the **first `[data-qa-category-link]` in DOM order**. In a typical header the institutional/editorial links come first, so the engine:

1. clicks the first `[data-qa-category-link]` — the **institutional** one,
2. lands on a page with **no products** (`navigate-plp` "succeeds" because the URL did change),
3. then `enter-pdp` looks for `data-qa-product-card`, finds none, and fails with **`data-qa-product-card missing`**.

The symptom points at the PDP / product card, but nothing is wrong there — the journey simply navigated to the wrong kind of page. Whenever `data-qa-product-card missing` shows up on a store with a generic nav component, **suspect over-marked category links first.**

## Critical nuance: the `selectors` override does NOT fix this

The engine's error message suggests "…or set `overrides.selectors[…]` in `.qarc.json`", and elsewhere this skill describes `selectors` as an override. **That override does not help here**, and it's important to understand why:

> `findSelector` tries the **raw `[data-qa-<slug>]` selector first** and only falls back to `selectors[slug]` when the attribute exists **nowhere** in the DOM.

Because you've marked the attribute on *several* links, the raw selector **does** match (the wrong, first element) — so the fallback to `selectors[slug]` never triggers and your override is silently ignored. You cannot patch over-marking from `.qarc.json`.

⇒ **The fix must be at the source (JSX): only the links that actually open a PLP may carry `data-qa-category-link`.**

## The JSX fix

Mark the attribute **conditionally**, gated on a discriminator that distinguishes a real PLP link from institutional/dropdown ones. The discriminator is **store-specific** — read the header data/code to find it.

```tsx
// Only mark when the href points at a product listing.
// In this store, every category link carries ?sort=; institutional/dropdown links don't.
<a
  href={href}
  {...(href?.includes("sort=") ? { "data-qa-category-link": true } : {})}
>
  {label}
</a>
```

Common discriminators seen across stores (pick what's *provably* true for THIS store, don't assume):

- the href carries a listing query string (`?sort=`, `?O=`, `?map=`);
- the href matches the store's PLP route shape (`/c/`, `/collection/`, a known category-slug pattern);
- a typed field on the menu item (`item.type === "category"`, `item.__resolveType` ending in a PLP loader);
- the item has an `href` at all (excludes dropdown triggers) **and** isn't in a known institutional set.

**General rule:** mark only the nav link that **provably opens a PLP carrying `data-qa-product-card`**. When in doubt, verify with the Phase 2 target-check (below) before trusting the marking.

## Verify the target, not just the attribute (Phase 2)

Marking the attribute is not enough — confirm the **first** marked link actually lands on a PLP:

- Run `qa doctor --url <preview>` **on the destination page of the FIRST `data-qa-category-link` in DOM order** (not on some arbitrary PLP you picked) and confirm that page reports `data-qa-product-card`.
- Cheap, browserless heuristic to list what you actually marked and check the first href:
  ```sh
  curl <preview>/ | grep -oE '<a[^>]*data-qa-category-link[^>]*>'
  ```
  If the first match's `href` is an institutional/editorial route (no products), you've hit this pitfall — tighten the discriminator.

*(Learning: aviator — a generic `NavItem` carried institutional links, dropdown triggers and category links with identical markup. Marking the generic anchor put `data-qa-category-link` on all of them; the engine clicked the first (institutional "Conheça o projeto" → `/asas-para-voar`), landed on a product-less page, and `enter-pdp` failed with `data-qa-product-card missing`. A `.qarc.json` `selectors` override did nothing because the raw attribute already matched. Gating the mark on `href?.includes("sort=")` — true only for real category links in this store — fixed it.)*
