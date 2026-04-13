---
name: new-section
description: Create a new deco.cx Section — a visual Preact + Tailwind component with typed props, optional inline/external loaders, and Islands for client-side behavior. Use when the user asks to build, add, or scaffold a new section on a deco storefront.
---

# Creating a New Section on deco.cx

Sections are visual components rendered **server-side** in Preact with Tailwind CSS. Props typed in TypeScript automatically generate editable forms in the deco Admin.

---

## Step 1 — Scaffold the section file

**Path:** `sections/MySection.tsx`

Rules:
- Use `class` (not `className`) for Tailwind
- **No client-side code** in the section file — no hooks, event listeners, `onClick`, `useState`, `useEffect`, etc.
- All props must have TypeScript types; use `?` for optional props and always provide default values in the function signature

```typescriptreact
import type { ImageWidget } from "apps/admin/widgets.ts";
import { TextArea, Color } from "apps/admin/widgets.ts";
import type { Product } from "apps/commerce/types.ts";
import type { ProductDetailsPage } from "apps/commerce/types.ts";
import type { ProductListingPage } from "apps/commerce/types.ts";

export interface Props {
  title?: string;
  description?: TextArea;
  image?: ImageWidget;
  backgroundColor?: Color;
  products?: Product[] | null;
  productPage?: ProductDetailsPage | null;
  productListingPage?: ProductListingPage | null;
}

export default function MySection({
  title = "My Section",
  description = "Edit me in the Admin",
  image,
  backgroundColor,
  products,
}: Props) {
  return (
    <section style={{ backgroundColor }}>
      <h2 class="text-2xl font-bold">{title}</h2>
      {description && <p class="mt-2">{description}</p>}
    </section>
  );
}
```

---

## Step 2 — Add client-side behavior (when needed)

**Never** put hooks, `onClick`, `addEventListener`, or any browser API directly in the section file.

How to handle client-side behavior depends on the site's stack — **check first**:

### Preact sites → Islands

Use Islands for client-side interactivity. Create a file in `islands/` and import it into the section.

**Path:** `islands/MyInteractiveBlock.tsx`

```typescriptreact
import { useState } from "preact/hooks";

interface Props {
  initialCount?: number;
}

export default function MyInteractiveBlock({ initialCount = 0 }: Props) {
  const [count, setCount] = useState(initialCount);
  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
```

Import and use it inside the section:

```typescriptreact
import MyInteractiveBlock from "../islands/MyInteractiveBlock.tsx";

export default function MySection({ ... }: Props) {
  return (
    <section>
      <MyInteractiveBlock initialCount={0} />
    </section>
  );
}
```

### HTMX sites → `hx-*` attributes

Some deco sites use HTMX instead of Preact. On these sites, **do not create Islands**. Use `hx-*` attributes directly in the section's JSX to drive interactivity via server-side partial responses.

```typescriptreact
export default function MySection({ ... }: Props) {
  return (
    <section>
      <button hx-post="/api/action" hx-target="#result" hx-swap="innerHTML">
        Submit
      </button>
      <div id="result" />
    </section>
  );
}
```

To tell which approach to use, look for:
- An `islands/` folder with `.tsx` files → **Preact Islands**
- `hx-*` attributes in existing sections, or HTMX loaded in the layout → **HTMX**

---

## Step 3 — Add server-side data with a Loader (optional)

### Inline Loader (simple, lives in the section file)

Use when the data fetch is tightly coupled to this section and does not need to be shared.

```typescriptreact
import type { AppContext } from "apps/commerce/mod.ts";

export const loader = async (props: Props, req: Request, ctx: AppContext) => {
  const categories = await ctx.invoke.vtex.loaders.categories.tree({});
  return { ...props, categories };
};
```

### External Loader (reusable, lives in `/loaders`)

Use when the returned type should be selectable as a content source for multiple sections.
The section prop type must match the loader return type to enable the connection in Admin.

**Path:** `loaders/myData.ts`

```ts
import type { AppContext } from "apps/commerce/mod.ts";

interface MyData {
  name: string;
  value: number;
}

const loader = async (_props: unknown, _req: Request, _ctx: AppContext): Promise<MyData[]> => {
  return [{ name: "example", value: 42 }];
};

export default loader;
```

---

## Step 4 — Place the section on a page

Use `updateJson` with `replaceOrAdd: "add"` to insert the section at a specific position.

To insert at position 2 (0-indexed → key index `1`):

```json
{
  "__resolveType": "site/sections/MySection.tsx",
  "title": "Hello from MySection",
  "description": "Visible in the Admin"
}
```

Call `updateJson` with:
- `key`: `["sections", 1]`
- `newValue`: the JSON above
- `replaceOrAdd`: `"add"`

To remove a section, set `newValue` to `undefined`.

---

## Widget reference

| Widget | Import |
|---|---|
| `ImageWidget` | `import type { ImageWidget } from "apps/admin/widgets.ts"` |
| `TextArea` | `import { TextArea } from "apps/admin/widgets.ts"` |
| `Color` | `import { Color } from "apps/admin/widgets.ts"` |
| `Product` | `import type { Product } from "apps/commerce/types.ts"` |
| `ProductDetailsPage` | `import type { ProductDetailsPage } from "apps/commerce/types.ts"` |
| `ProductListingPage` | `import type { ProductListingPage } from "apps/commerce/types.ts"` |

---