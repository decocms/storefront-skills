---
name: asset-hash-busting
description: Use when Icon or SVG sprite components fetch sprites.svg repeatedly causing excessive bandwidth, or when asset() is called inside a component render function for a constant URL.
---

# SVG Sprites — prevent repeated fetch loop

## Problem

Calling `asset()` inside the component body recomputes the URL on every render. Since `<Icon>` is rendered once per icon on the page, each instance triggers a separate fetch to `sprites.svg` — causing the sprite file to be downloaded repeatedly in a loop instead of once.

```tsx
// ❌ recomputed on every <Icon> render
function Icon({ id }: Props) {
  const spritesUrl = asset("/sprites.svg");
  return <svg><use href={`${spritesUrl}#${id}`} /></svg>;
}
```

## Fix — hoist to module level

```tsx
// ✅ computed once, shared across all renders
const spritesUrl = asset("/sprites.svg");

function Icon({ id }: Props) {
  return <svg><use href={`${spritesUrl}#${id}`} /></svg>;
}
```

## General rule

Any `asset()` call whose result does not depend on props belongs outside the component.
