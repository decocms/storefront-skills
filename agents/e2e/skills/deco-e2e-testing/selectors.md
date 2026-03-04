# Platform-Specific Selectors

Different e-commerce platforms have different DOM structures. Use these as starting points.

## VTEX-based Sites (Most Deco Sites)

VTEX is the most common backend for Deco sites in Brazil.

```typescript
const SITE_CONFIG = {
    // Products always show price with R$
    productCard: 'a:has-text("R$")',
    
    // PDP URLs end with /p
    pdpUrlPattern: /\/p$/,
    
    // Portuguese buy button
    buyButton: 'button:has-text("Comprar")',
    
    // Sizes in list items
    sizeButton: (size: string) => `li button:has-text("${size}")`,
    
    // Cart drawer header
    minicartText: 'Minha Sacola',
    
    // Brazilian sizes
    sizes: ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'],
}
```

**Cart API patterns to wait for:**
```typescript
await page.waitForResponse(r => 
    r.url().includes('orderForm') ||  // VTEX orderForm API
    r.url().includes('/items')        // Cart items endpoint
)
```

---

## Shopify-based Sites

```typescript
const SITE_CONFIG = {
    productCard: '[data-product-card] a',
    pdpUrlPattern: /\/products\//,
    buyButton: 'button[name="add"]',
    sizeButton: (size: string) => `input[value="${size}"]`,
    minicartText: 'Your Cart',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
}
```

**Cart API patterns:**
```typescript
await page.waitForResponse(r => 
    r.url().includes('/cart/add') ||
    r.url().includes('/cart.js')
)
```

---

## VNDA-based Sites

```typescript
const SITE_CONFIG = {
    productCard: '.product-item a',
    pdpUrlPattern: /\/produto\//,
    buyButton: 'button.add-to-cart',
    sizeButton: (size: string) => `.variant-option:has-text("${size}")`,
    minicartText: 'Carrinho',
    sizes: ['P', 'M', 'G', 'GG'],
}
```

---

## Wake Commerce Sites

```typescript
const SITE_CONFIG = {
    productCard: '[data-product] a',
    pdpUrlPattern: /\/p\//,
    buyButton: 'button:has-text("Adicionar")',
    sizeButton: (size: string) => `[data-variant="${size}"]`,
    minicartText: 'Sacola',
    sizes: ['P', 'M', 'G', 'GG'],
}
```

---

## English Language Sites (US/International)

```typescript
const SITE_CONFIG = {
    productCard: 'a:has-text("$")',  // USD currency
    buyButton: 'button:has-text("Add to Cart")',
    minicartText: 'Shopping Bag',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
}
```

---

## Selector Testing Tips

### In Browser DevTools

Test your selectors before using them:

```javascript
// Count matching elements
document.querySelectorAll('a:has-text("R$")').length

// Check if element is visible
document.querySelector('button:has-text("Comprar")')?.offsetParent !== null

// Find all size buttons
document.querySelectorAll('li button').forEach(b => console.log(b.textContent))
```

### In Playwright

```typescript
// Debug: log all matching elements
const products = await page.locator('a:has-text("R$")').all()
console.log(`Found ${products.length} products`)

// Debug: take screenshot of element
await page.locator('button:has-text("Comprar")').screenshot({ path: 'buy-button.png' })
```

---

## Fallback Strategies

When primary selectors fail:

### Product Cards
```typescript
// Try multiple patterns
const selectors = [
    'a:has-text("R$")',
    '[data-product-card]',
    '.product-card a',
    'a[href*="/p"]',
]

for (const sel of selectors) {
    const count = await page.locator(sel).count()
    if (count > 0) {
        console.log(`Using selector: ${sel} (${count} matches)`)
        return sel
    }
}
```

### Buy Button
```typescript
const buySelectors = [
    'button:has-text("Comprar")',
    'button:has-text("Add to Cart")',
    'button:has-text("Adicionar")',
    'button[data-add-to-cart]',
    '.add-to-cart-button',
]
```

### Sizes
```typescript
// Generic: any button with short text (likely a size)
const sizeButtons = page.locator('li button').filter({ hasText: /^[A-Z0-9]{1,3}$/ })
```
