---
name: hardcoded-to-blocks
description: "Convert a hardcoded TanStack Start site (texts, menus, pages written in components and constants) into deco CMS blocks that anyone on the team edits in Studio's Site Editor, without changing how the site looks. Use when asked to make a site or page editable in the CMS, move hardcoded content to blocks, make a menu/footer/home/landing editable, let editors add/remove/reorder sections, handle EN/PT (or any two-language) content in the CMS, or when the Site Editor says 'Want to edit this website with easy-to-use forms? Set up content editing' or 'No page found for /'. Covers the inventory, the three content shapes (global blocks, composed pages, collections), the bilingual field convention, seeding blocks from existing code, a build-time content check, and pixel-level parity verification. Assumes @decocms/blocks + @decocms/tanstack 7.x; Fresh/Deno sites are already block-native."
---

# Hardcoded site → deco CMS blocks

The goal is not "move strings into JSON". It is: **a person who is not a
developer opens the Site Editor, changes something, publishes, and the site
changes — while the site renders exactly as before the conversion.** Every step
below serves one of those two halves.

Work in small PRs, one content area at a time (menu → home → landings → …).
Each PR must be pixel-identical to `main` before merge (see
[Verification](#verification)), so the conversion never ships a visual change by
accident.

For field shapes, widgets and JSDoc annotations, load **cms-friendly-props**
first; this skill assumes it. For page JSON basics see **new-page**.

---

## Step 0 — Make sure Studio can see and run the site

Check these before writing any block. Each one cost a full debugging round in a
real conversion.

| Symptom in the Site Editor | Cause | Fix |
|---|---|---|
| "Want to edit this website… **Set up content editing**" | No `.deco/blocks/` directory (so `blocks.gen.json` is `{}`), or no block whose `__resolveType` is a section listed in `meta.manifest.blocks.sections` | Create the first block (Step 3). The button only links to the blocks repo; it configures nothing. |
| Preview shows `Blocked request. This host ("….style.dev") is not allowed` | Studio runs `vite dev` in a sandbox and loads it from the sandbox domain. Freestyle sandboxes use `<handle>.style.dev`, Kubernetes ones use deco domains | `server.allowedHosts: [".decocdn.com", ".decocms.com", ".style.dev"]` in `vite.config.ts`. The `@decocms/tanstack` Vite plugin does not add `.style.dev`. |
| "**Clone failed**" / "Blocks unavailable", setup log shows `remote: Repository not found. fatal: Authentication failed` | The repo is private and the GitHub credential of the Studio **org** that owns the project has no access to it (common after a project moves orgs) | Not a code problem. An admin grants the deco GitHub app access to the repo (org settings → installations) and reconnects GitHub in the project settings. |
| "No page found for /" in the Blocks panel | The route is not a CMS page | Expected until you convert it into a page (Step 5). Global blocks still edit fine from **Content**. |

Also confirm the admin protocol is wired: `createSiteSetup` + `createAdminSetup`
+ `applySectionConventions` in `src/setup.ts`, and `createDecoWorkerEntry(…, {
admin: { handleMeta, handleDecofileRead, handleDecofileReload, handleRender,
corsHeaders } })` in the worker entry. Without `admin`, `/live/_meta`,
`/.decofile` and `/live/previews/*` are not served.

---

## Step 1 — Inventory: what is content, what is interface

Grep every component for literal text, link lists and bilingual constants
(`label`/`labelPt`, `COPY = { en, pt }`, `t.title`). Classify each one:

| Goes to the CMS (content) | Stays in code (interface or logic) |
|---|---|
| Headings, intros, card texts, CTAs and their links | `aria-label`s, "Skip to content", "Open navigation" |
| Menus, footers, banners | Button states ("Copy link" → "Link copied") |
| Lists editors will reorder (cards, steps, guides) | Text tied to logic: version pickers, status labels driven by data |
| Page composition (which sections, in which order) | Navigation built by code from several sources |

Rule of thumb: if changing it requires a code release anyway (a new version, a
new route), it stays in code — putting it in the CMS only adds a second place to
forget. Record the inventory (area, file, fields, priority) and convert by
priority, most-viewed pages first.

Delete dead components you find on the way; they would otherwise become sections
in Studio (Step 2).

---

## Step 2 — Only CMS sections live in `src/sections/`

The generator registers **every** `.tsx` under the `sections` glob in
`setup.ts`. Each one appears in Studio's "add section" list — including your
layout, header, search box and MDX helpers. An editor who adds `DocLayout` to a
page breaks it.

- Move everything that is not a CMS section to `src/components/`, update the
  imports (including content files like MDX), and keep `src/sections/` for
  sections only.
- A section has a **default export** and an exported interface named
  **`Props`** — the generator takes the local `Props` interface first. Runtime
  props the CMS must not see (`locale`, `pathname`, `product`) are added on the
  component signature, not in `Props`:

  ```tsx
  export interface Props { /** @title Title */ title: string }
  export default function Hero({ title, locale = "en" }: Props & { locale?: Locale }) { … }
  ```
- Add `export const sync = true` to sections rendered on first paint, so they are
  bundled synchronously and do not blank during hydration.
- After any `Props` change: `bun run generate` and **commit the regenerated
  `.deco/meta.gen.json`**. Studio reads the committed file in Fast Preview; a
  stale one hides new sections (it happened with 11 sections missing).

---

## Step 3 — Pick the shape for each piece of content

| Shape | Use for | Stored as | Loaded by |
|---|---|---|---|
| **Global block** | Things on every page: header menu, footer, banners | `.deco/blocks/Header%20menu.json`, `__resolveType: "site/sections/X.tsx"` | One server fn in the **root route** loader, read with a hook |
| **Composed page** | Pages editors should rearrange: home, landings | `.deco/blocks/pages-Home.json`, `__resolveType: "website/pages/Page.tsx"`, `path`, `sections[]` | `resolveDecoPage(path)` in the route loader, rendered with `DecoPageRenderer` |
| **Collection** | Many long-form documents (articles, posts) | Blog posts (`@decocms/apps-blog`), one block per document | Your own index by key, never one page block per document |

Code for the first two is in [references/code.md](references/code.md).

Decisions that held up in production:

- **Keep your routes.** Do not switch the whole site to `cmsRouteConfig` just to
  get CMS pages: its catch-all would take over routes you own (content files,
  redirects, locale prefixes). Use `resolveDecoPage` + `DecoPageRenderer` only in
  the routes that are CMS pages.
- **Page keys must start with `pages-`** on 7.x (`getAllPages` skips anything
  else). File names are `encodeURIComponent(key) + ".json"`.
- **Do not create one page block per item** for hundreds of documents: Studio's
  page list is flat (no folders, no virtualization) and `findPageByPath` walks
  every page and compiles a URLPattern per request.
- **No fallback copy in code.** If a block or page cannot be resolved at runtime
  (a draft deleted it), fall back to the version committed with the build
  (`import { blocks } from ".deco/blocks.gen"`), not to a duplicate of the
  content in a constant. A constant fallback becomes a second source of truth
  that drifts.
- `DecoPageRenderer` wraps each section in `<section id data-manifest-key>`.
  That is what makes click-to-select work in the preview — keep it. Check your
  CSS for direct-child selectors (`.page > section`) before converting.

---

## Step 4 — Two languages: one block, `foo` + `fooPt`

Studio has **no locale concept for site content**, and blocks has no i18n.
Path matchers plus variants could pick a language, but every block would hold
two full copies of its content. What worked:

- **One block per piece of content, never one per language.** Two blocks for the
  same menu was rejected by the team as unproductive: every change has to be
  made twice and they drift.
- **Convention:** any text field `foo` may have a sibling `fooPt`. Pages under
  the secondary locale show `fooPt` when it is filled and fall back to `foo`
  otherwise. Fields stay flat, so `@titleBy` keeps working (an `{ en, pt }`
  object would break list titles).
- **One generic `localize(props, locale)`** applied once where blocks are loaded;
  sections only ever read `foo`. Links are written without the locale prefix
  and the component adds it.
- Automatic translation (an LLM fills the other language in the Studio PR via a
  GitHub Action) is possible but needs an API key and a review step; start with
  manual fields and add it later if the team asks.

The helper is in [references/code.md](references/code.md#localize).

---

## Step 5 — Seed the blocks from the current code

Never retype content. Extract the existing constants with a throwaway script
(evaluate the `COPY` object in isolation with `tsx`, replace component
references such as `icon: Blocks` with string keys) and write the JSON from it.
This keeps both languages byte-identical to what ships today, which is what
makes the pixel comparison in the next step meaningful.

Icons and other component references become a closed enum in `Props`
(`icon: keyof typeof ICONS`), never a free-text field.

---

## Step 6 — A content check that runs in the build

Studio publishes through a PR, so a build-time check stops broken content
before merge. `scripts/check-cms.ts` (sketch in
[references/code.md](references/code.md#check-cms)) should fail on:

- a block whose `__resolveType` is neither a section nor another block;
- an empty required field — read `required` from the section's schema in
  `.deco/meta.gen.json`, following `allOf` **and** `anyOf` (array fields are
  `anyOf: [Resolvable, array]`; skip the `Resolvable` branch or nested lists are
  never checked);
- an internal link (`href`, `url`, `link`, `*Href`) to a page that does not
  exist — check at **any depth**, even where the schema has no entry;
- each section inside a page, labelled by position (`"pages-Home".sections[1]`);
- a registered global block or page path that is missing.

Run it after `generate` in the build script so it sees the current schema.

---

## Verification

Each PR is verified three ways. Details and scripts in
[references/verification.md](references/verification.md).

1. **HTML parity.** Render the converted pages on the branch and on `main`, strip
   `<script>` and comments, and diff `<body>` and `<title>`. The only expected
   difference is the `<section data-manifest-key>` wrappers on composed pages.
2. **Pixel parity.** Full-page screenshots of each page in both languages at
   desktop and mobile widths, on both servers, diffed pixel by pixel. Scroll the
   page first so reveal-on-scroll animations run. Differences of a few pixels at
   intensity ≤ 7/255 are transition noise; anything visible is a regression.
3. **Live edit.** With the dev server running, edit the block JSON (change a
   text, empty a `fooPt`, remove and reorder sections) and confirm each change
   shows on the right locale only. Then do the same in Studio end to end: edit →
   publish → PR → merge → deploy.

---

## Gotchas

- **Loader return types must be serializable for TanStack Start.** `unknown`
  fails; a recursive `Json` type triggers `TS2589` in `useLoaderData`. Type block
  props as `Record<string, any>` at the boundary and cast to the section's
  `Props` where you use them.
- **Read root loader data with `useLoaderData({ from: "__root__" })`.**
- **Dev HMR race:** after editing a block file, the first request may still see
  the old content. Wait for `[deco] applied N-block delta` in the dev log, or
  restart the dev server with the edit already in place.
- **Element ids keyed by index** (`build-path-0` instead of `build-path-storefront`)
  change the HTML but nothing else — check no CSS or link targets them.
- **External links** in CMS lists still need `target="_blank" rel="noopener
  noreferrer"`; set them from the URL, not from a field.
- **Draft preview on the live URL** (`?__draft=`) only works for hosts listed in
  the site block's `previewHosts` or `DECO_ALLOWED_PREVIEW_HOSTS`; the sandbox
  preview works without it.
- **Layout cache** varies only by device: do not mark a locale-dependent global
  block as a cached layout section.
- **Local build OOM** in the Worker step is a heap limit, not your change; run
  with `NODE_OPTIONS=--max-old-space-size=8192` and compare with `main`.
- **Moving components** breaks open PRs that import the old path; announce the
  new path in the PR description.

## Reference implementation

`deco-sites/docs-tanstack` (private), PRs #12 (menu as global block), #18 (home
and footer), #19 (landings), #20 (composed pages, `src/components` split).
