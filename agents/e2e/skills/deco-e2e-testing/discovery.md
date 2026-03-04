# Site Discovery Guide

Before implementing e2e tests, you MUST discover these site-specific values. This guide shows exactly where to find each one.

## Required Information Checklist

| Info | Status | Value |
|------|--------|-------|
| Site URL | ☐ | |
| PLP Path | ☐ | |
| Fallback PDP Path | ☐ | |
| Product Card Selector | ☐ | |
| Buy Button Selector | ☐ | |
| Size Button Pattern | ☐ | |
| Available Sizes | ☐ | |
| Minicart Text | ☐ | |
| Currency Symbol | ☐ | |
| Voltage Options | ☐ | (electronics only) |

---

## Framework Endpoints

All Deco sites have these built-in endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/deco/_liveness` | Health check - returns 200 when server is ready |
| `?__d` | Debug mode - adds server-timing headers |

The liveness endpoint is critical for test warmup - see SKILL.md for details.

---

## 1. Site URL

The dev server runs at `http://localhost:8000` by default (configurable via `APP_PORT` env variable).

No tunnel or external URL needed — tests always run against the local dev server.

---

## 2. PLP Path (Category Page)

**Where to find:**
- `components/header/` → menu/nav components
- `sections/Header*.tsx` → navigation links
- `static/` → sitemap or nav configs

**Search commands:**
```bash
grep -r 'href="/' components/header/
grep -r 'href="/' sections/Header*.tsx
```

**Common patterns:**
- `/feminino`, `/masculino` (fashion)
- `/roupas`, `/calcados` (apparel)
- `/category/{slug}` (generic)

---

## 3. Fallback PDP Path

**Where to find:**
- Any product URL in sections or loaders
- Search for `/p` suffix (VTEX pattern)
- Product loader test fixtures

**Search commands:**
```bash
grep -r '"/.*\/p"' sections/ loaders/
grep -r 'productId\|skuId' loaders/
```

**Format:** `/product-name-sku/p`

**IMPORTANT - Choosing a good fallback product:**
- **Avoid electronics** that require voltage selection (110V/220V modals block the cart)
- **Avoid fashion items** that require size selection if possible
- **Prefer simple products** like:
  - Thermal boxes, containers
  - Pillows, towels, bedding
  - Kitchen utensils
  - Decorative items
- Look for products in `.deco/blocks/` JSON files that link to `/p` URLs

---

## 4. Product Card Selector

**Where to find:**
- `components/product/ProductCard.tsx`
- Look for the main link/anchor wrapping the product

**Search commands:**
```bash
cat components/product/ProductCard.tsx | head -100
grep -r 'data-product\|ProductCard' components/
```

**Read the file and identify:**
- What wrapper element is clickable?
- What text always appears? (usually price)

**Common selectors:**
| Platform | Selector |
|----------|----------|
| VTEX (BRL) | `a:has-text("R$")` |
| VTEX (USD) | `a:has-text("$")` |
| Generic | `[data-product-card]` |
| Shopify | `.product-item a` |

---

## 5. Buy Button Selector

**Where to find:**
- `components/product/AddToCartButton.tsx`
- `components/product/ProductDetails.tsx`
- `islands/AddToCartButton.tsx`

**Search commands:**
```bash
grep -r 'Comprar\|Add to Cart\|Adicionar' components/product/
grep -r 'addToCart\|add-to-cart' islands/
```

**Common selectors:**
| Language | Selector |
|----------|----------|
| PT-BR | `button:has-text("Comprar")` |
| EN | `button:has-text("Add to Cart")` |
| Generic | `button[data-add-to-cart]` |

---

## 6. Size Button Pattern

**Where to find:**
- `components/product/VariantSelector.tsx`
- `components/product/Sizes.tsx`
- `islands/Sizes.tsx`

**Search commands:**
```bash
cat components/product/VariantSelector.tsx
grep -r 'size\|variant\|sku' components/product/
```

**Common patterns:**
| Structure | Pattern |
|-----------|---------|
| List buttons | `li button:has-text("${size}")` |
| Direct buttons | `button[data-size="${size}"]` |
| Radio inputs | `input[value="${size}"]` |

---

## 7. Available Sizes

**Where to find:**
- Same files as size button
- Look for size arrays or enums
- Check variant options in product loaders

**Common size sets:**
| Type | Sizes |
|------|-------|
| Clothing (BR) | `['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2']` |
| Clothing (US) | `['XS', 'S', 'M', 'L', 'XL', 'XXL']` |
| Shoes (BR) | `['34', '35', '36', '37', '38', '39', '40', '41', '42']` |
| Shoes (US) | `['6', '7', '8', '9', '10', '11', '12']` |

---

## 8. Voltage Options (Electronics Stores)

**When needed:** For stores selling electronics (appliances, TVs, etc), products may require voltage selection before adding to cart.

**Where to find:**
- Same components as size selector
- Look for voltage-specific variant handling

**Search commands:**
```bash
grep -r 'voltage\|tensao\|110V\|220V' components/product/
grep -r 'Bivolt' components/
```

**Common voltages:**
```typescript
voltages: ['110V', '127V', '220V', 'Bivolt']
```

**Common selectors:**
```typescript
voltageSelector: (voltage: string) => `button:has-text("${voltage}")`
```

---

## 9. Minicart Text

**Where to find:**
- `components/minicart/`
- `islands/Cart.tsx`
- Look for drawer/modal header

**Search commands:**
```bash
grep -r 'Sacola\|Cart\|Bag\|Carrinho' components/minicart/
cat components/minicart/Cart.tsx | head -50
```

**Common values:**
| Language | Text |
|----------|------|
| PT-BR | `Minha Sacola` |
| EN | `Your Cart` or `Shopping Bag` |

---

## 9. Currency Symbol

**Where to find:**
- `sdk/format.ts` or similar
- Price components
- Locale configuration

**Common values:**
- `R$` (Brazil)
- `$` (US/Generic)
- `€` (Europe)

---

## Discovery Workflow

1. **Clone/open the site repo**
2. **Run discovery searches** for each item above
3. **Read key component files** to verify selectors
4. **Test selectors manually** in browser DevTools:
   ```javascript
   // In browser console on the live site:
   document.querySelectorAll('a:has-text("R$")').length
   document.querySelectorAll('button:has-text("Comprar")').length
   ```
5. **Fill in the checklist** and proceed to implementation

---

## 10. Deco Observability Headers

The test suite captures these Deco-specific headers for debugging:

| Header | Source | Purpose |
|--------|--------|---------|
| `x-deco-section` | `/deco/render` response | Section component type and title |
| `x-deco-page` | Page response | Matched page block name |
| `x-deco-route` | Page response | Matched route template |
| `x-deco-platform` | All responses | Platform identifier |
| `server-timing` | `?__d` mode | Loader timings and cache status |

**These are set automatically by the Deco runtime.** If they're missing, ensure you're using a recent version of:
- `@deco/deco` (runtime)
- `apps/website/handlers/fresh.ts` (page handler)

---

## Example: Completed Discovery

### Brazilian Fashion E-commerce

```typescript
const SITE_CONFIG = {
    baseUrl: 'http://localhost:8000',
    plpPath: '/feminino',
    fallbackPdpPath: '/macaquinho-feminino-curto-berry-16171000788507/p',
    debugParam: '?__d',
    
    productCard: 'a:has-text("R$")',
    pdpUrlPattern: /\/p/,
    buyButton: 'button:has-text("Comprar")',
    sizeButton: (size: string) => `li button:has-text("${size}")`,
    minicartText: 'Minha Sacola',
    
    sizes: ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', '38', '40', '42'],
    
    thresholds: {
        coldTTFB: 5000,
        warmTTFB: 2000,
        homeTTFB: 3000,
    },
}
```

### Brazilian Electronics Store (Casa e Video)

```typescript
const SITE_CONFIG = {
    baseUrl: 'http://localhost:8000',
    // Use non-electronics PLP to avoid voltage selection
    plpPath: '/utilidades-domesticas',
    // Simple product without voltage/size variants
    fallbackPdpPath: '/caixa-termica-12l-botafogo-azul/p',
    debugParam: '?__d',

    // Deco-specific data attribute
    productCard: '[data-deco="view-product"]',
    productCardFallback: 'a:has-text("R$")',
    pdpUrlPattern: /\/p/,
    buyButton: 'button:has-text("Comprar agora")',
    buyButtonFallback: 'button:has-text("Comprar")',
    minicartText: 'Produtos Adicionados',

    // Electronics store - voltage selection
    voltages: ['110V', '127V', '220V', 'Bivolt'],
    voltageSelector: (voltage: string) => `button:has-text("${voltage}")`,

    thresholds: {
        coldTTFB: 5000,
        warmTTFB: 2000,
        homeTTFB: 3000,
        homeWarmTTFB: 1500,
    },
}
```
