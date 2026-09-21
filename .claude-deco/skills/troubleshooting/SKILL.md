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

### A prop renders as `[object Object]` after adding a Variant (TanStack)

**Symptom:** A field wrapped in a `website/flags/multivariate/*` flag renders the literal text
`[object Object]` on the page. JSON-LD built from the same field contains the whole
`{ "__resolveType": ..., "variants": [...] }` blob instead of a string, so Google invalidates the
rich result — and every variant, including the one that should be hidden, is exposed at once.
Build is green, the deploy check is green, HTTP is 200, and there is nothing in the console.
Both variants are affected, so a *scheduled* swap is already broken before its start date.

**Root cause:** The TanStack resolver (`@decocms/blocks`, `src/cms/resolve.ts`) recognizes only
two flag `__resolveType` values — `website/flags/multivariate.ts` and
`website/flags/multivariate/section.ts`. `message.ts` and `image.ts` are valid on the Deno/Fresh
runtime (which resolves flags by module path) and still ship as files inside `@decocms/blocks`,
but nothing reaches them on TanStack. An unrecognized `__resolveType` hits the *"Unknown type —
preserve `__resolveType`"* fallback, which assumes it is a site section and returns the object
untouched. The prop reaches the component as an object; `dangerouslySetInnerHTML={{ __html }}`
then coerces it to `[object Object]`. SSR and hydration coerce identically, so there is not even
a hydration mismatch to notice.

**Fix:** Replace the `__resolveType` in the block JSON — nothing else changes (`variants`, the
values, and the matcher rules stay as they are):

```diff
- "__resolveType": "website/flags/multivariate/message.ts",
+ "__resolveType": "website/flags/multivariate.ts",
```

`website/flags/multivariate.ts` is generic over the value type on TanStack, so it covers strings,
image widgets and anything else. See [[variants]].

**Verify:** `curl` the preview and count the marker — a green CI check proves nothing here,
because the failure mode is silent:

```bash
curl -s https://<preview-host>/<page> | grep -c "\[object Object\]"   # must be 0
curl -s https://<preview-host>/<page> | grep -c "multivariate/"        # must be 0 in the HTML
```

Then open the accordion/section in a browser and confirm the expected variant's text is there.

---

<!-- Add new entries below this line, following the same format:
### Short symptom title
**Symptom:**
**Root cause:**
**Fix:**
**Verify:**
-->
