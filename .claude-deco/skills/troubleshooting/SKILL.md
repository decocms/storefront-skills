---
name: troubleshooting
description: "Quick fixes for common, isolated issues in deco.cx storefronts. Use when the user reports a specific symptom that doesn't warrant a full skill. This is a growing knowledge base — add new entries as they're discovered."
---

A living collection of quick fixes for one-off problems in deco.cx storefronts. Each entry describes the symptom, root cause, and exact fix.

---

## Entries

### HTML `lang` attribute wrong or missing

**Symptom:** The page renders with `<html lang="en">` (or no `lang`) but the site is in Portuguese (or another language). Accessibility tools and SEO audits flag the mismatch.

**Root cause:** In Deno Fresh, the `lang` attribute on `<html>` is set via `ctx.lang` inside the `render` callback of `fresh.config.ts`. If the line is absent, Fresh defaults to `"en"`.

**Fix:** Open `fresh.config.ts` at the project root and add (or update) the `render` callback:

```ts
import { defineConfig } from "$fresh/server.ts";
import { plugins } from "deco/plugins/deco.ts";
import manifest from "./manifest.gen.ts";

export default defineConfig({
  plugins: plugins({
    manifest,
    htmx: true, // keep whatever options were already here
  }),
  render: (ctx, render) => {
    ctx.lang = "pt-BR"; // ← set to the correct BCP-47 language tag
    render();
  },
});
```

Common language tags: `pt-BR`, `pt-PT`, `en`, `en-US`, `es`, `es-AR`.

**Verify:** After deploying, inspect the page source and confirm `<html lang="pt-BR">`.

---

### Section loader returning null doesn't emit HTTP 404

**Symptom:** A product page for a non-existent product returns HTTP 200 instead of 404. Google indexes it as a valid page; PMax continues sending paid traffic to it.

**Root cause:** `return null` from a section loader does not trigger HTTP 404 in deco. The framework only short-circuits via `HttpError`, which `notFound()` throws internally.

**Fix:** Import `notFound` from `@deco/deco` and call it instead of returning null:

```typescript
import { notFound } from "@deco/deco";

export const loader = async (props: Props, _req: Request, ctx: AppContext) => {
  if (!props.page) {
    notFound(); // throws HttpError(404) — not a return, no value needed
  }
  // ...
};
```

**Note:** For deferred sections, `notFound()` only fires HTTP 404 when the page renders SSR (i.e. for bots via `shouldForceRender`, or with `?__decoFBT=0`). Regular users always receive the initial HTTP 200 shell; the error state renders inside the HTMX partial.

**Verify:**
```bash
# Must return 404 for bots
curl -o /dev/null -s -w "%{http_code}" \
  "https://www.store.com/missing-product/p?__decoFBT=0"
```

---

<!-- Add new entries below this line, following the same format:
### Short symptom title
**Symptom:**
**Root cause:**
**Fix:**
**Verify:**
-->
