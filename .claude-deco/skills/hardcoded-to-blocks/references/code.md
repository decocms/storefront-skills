# Code for the content shapes

Paths follow a TanStack Start site with `src/lib/cms/`, `src/sections/` (CMS
sections only) and `src/components/` (everything else). Locales are `en`
(default) and `pt`; rename `Pt` for your secondary language.

## Registry

One file names everything the build must find. Types come from the sections'
`Props`.

```ts
// src/lib/cms/registry.ts
import type { Props as HeaderMenu } from "~/sections/HeaderMenu";
import type { Props as Footer } from "~/sections/Footer";

/** Blocks on every page, loaded with the root route. */
export interface GlobalBlocks {
  "Header menu": HeaderMenu;
  Footer: Footer;
}
export const GLOBAL_BLOCK_NAMES: (keyof GlobalBlocks)[] = ["Header menu", "Footer"];

/** CMS pages the routes render; editors compose them from sections. */
export const PAGE_PATHS = ["/", "/storefront"];
```

## Global blocks

```ts
// src/lib/cms/blocks.ts
import { useLoaderData } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { localize } from "./localize";
import { GLOBAL_BLOCK_NAMES, type GlobalBlocks } from "./registry";

// Plain JSON from the decofile; shapes are checked by check:cms.
// `unknown` is rejected by TanStack's serializer, and a recursive Json type
// makes useLoaderData hit TS2589.
type RawProps = Record<string, any> | null;

/** Live block (with Studio drafts), else the version committed with the build. */
async function resolveBlock(name: string): Promise<RawProps> {
  const { resolvePageSections } = await import("@decocms/blocks/cms");
  const live = await resolvePageSections([{ __resolveType: name }])
    .then(([section]) => section?.props ?? null, () => null);
  if (live) return live as RawProps;
  const { blocks } = await import("../../../.deco/blocks.gen");
  const committed = blocks[name] as Record<string, unknown> | undefined;
  if (!committed) return null;
  const { __resolveType: _, ...props } = committed;
  return props;
}

export const loadGlobalBlocks = createServerFn({ method: "GET" })
  .handler(async (): Promise<Partial<Record<keyof GlobalBlocks, RawProps>>> => {
    const resolved = await Promise.all(GLOBAL_BLOCK_NAMES.map(resolveBlock));
    return Object.fromEntries(GLOBAL_BLOCK_NAMES.map((name, i) => [name, resolved[i]]));
  });

export function useGlobalBlock<N extends keyof GlobalBlocks>(name: N, locale: "en" | "pt"): GlobalBlocks[N] | null {
  const blocks: Partial<Record<keyof GlobalBlocks, RawProps>> | undefined = useLoaderData({ from: "__root__" });
  const props = blocks?.[name] as GlobalBlocks[N] | null | undefined;
  return props ? localize(props, locale) : null;
}
```

```ts
// src/routes/__root.tsx
export const Route = createRootRoute({
  loader: () => loadGlobalBlocks(),
  // …
});
```

The block file, seeded from the old constant:

```json
// .deco/blocks/Header%20menu.json
{
  "__resolveType": "site/sections/HeaderMenu.tsx",
  "links": [
    { "label": "Site Editor", "labelPt": "Editor de Sites", "href": "/storefront/editor/overview" }
  ]
}
```

The section renders the block and takes runtime props outside `Props`, so it
also previews standalone in Studio:

```tsx
// src/sections/HeaderMenu.tsx
export interface NavigationLink {
  /** @title Label (English) */
  label: string;
  /** @title Label (Português) @description Shown on Portuguese pages. When empty, the English label is used. */
  labelPt?: string;
  /** @title Link @description Path such as /storefront. Portuguese pages add /pt automatically. */
  href: string;
}
/** @title Header menu */
export interface Props {
  /** @titleBy label */
  links: NavigationLink[];
}
export default function HeaderMenu({ links = [], locale = "en", pathname = "/" }: Props & { locale?: "en" | "pt"; pathname?: string }) {
  const prefix = locale === "pt" ? "/pt" : "";
  return <nav>{links.map((link) =>
    <a key={link.href} href={link.href.startsWith("/") ? `${prefix}${link.href}` : link.href}
       aria-current={pathname.startsWith(link.href) ? "page" : undefined}>{link.label}</a>)}</nav>;
}
```

The header component (in `src/components/`) calls
`useGlobalBlock("Header menu", locale)?.links ?? []` and passes them down.
Derive anything the editor should not need to know (active item, version-aware
links) from the link itself, never from an extra id field.

## Composed pages

```ts
// src/lib/cms/pages.ts
import { createServerFn } from "@tanstack/react-start";

export interface CmsPage {
  name?: string;
  sections: { component: string; key: string; index: number; props: Record<string, any> }[];
}

export const loadCmsPage = createServerFn({ method: "GET" })
  .inputValidator((path: string) => path)
  .handler(async ({ data: path }): Promise<CmsPage | null> => {
    const { resolveDecoPage, resolvePageSections } = await import("@decocms/blocks/cms");
    const live = await resolveDecoPage(path).catch(() => null);
    if (live) return { name: live.name, sections: live.resolvedSections as CmsPage["sections"] };
    const { blocks } = await import("../../../.deco/blocks.gen");
    const committed = Object.values(blocks).find(
      (block) => block?.__resolveType === "website/pages/Page.tsx" && block.path === path);
    if (!committed) return null;
    return { name: committed.name, sections: (await resolvePageSections(committed.sections ?? [])) as CmsPage["sections"] };
  });
```

```tsx
// src/components/HomePage.tsx — the frame (header, footer) stays in code
import { DecoPageRenderer } from "@decocms/tanstack";
export function HomePage({ page, locale }: { page: CmsPage; locale: "en" | "pt" }) {
  const sections = page.sections.map((s) => ({ ...s, props: { ...localize(s.props, locale), locale } }));
  return <Layout locale={locale}>
    <DecoPageRenderer sections={sections as Parameters<typeof DecoPageRenderer>[0]["sections"]} pagePath="/" />
  </Layout>;
}

// src/routes/index.tsx — and src/routes/pt/index.tsx with locale "pt", same path "/"
export const Route = createFileRoute("/")({
  loader: async () => {
    const page = await loadCmsPage({ data: "/" });
    if (!page) throw notFound();
    return page;
  },
  component: () => <HomePage page={Route.useLoaderData()} locale="en" />,
});
```

```json
// .deco/blocks/pages-Home.json
{
  "__resolveType": "website/pages/Page.tsx",
  "name": "Home",
  "path": "/",
  "sections": [
    { "__resolveType": "site/sections/HomeHero.tsx", "title": "…", "titlePt": "…" },
    { "__resolveType": "site/sections/HomeGuides.tsx", "tracks": [] }
  ]
}
```

The secondary-locale route resolves the **same** path; only `locale` changes.
The tab title can come from a section (e.g. the intro section's `title`)
instead of a separate SEO field.

## Localize

```ts
// src/lib/cms/localize.ts
export const PT_SUFFIX = "Pt";

/** `fooPt` replaces `foo` on Portuguese pages when filled; `*Pt` keys are dropped. */
export function localize<T>(value: T, locale: "en" | "pt"): T {
  if (Array.isArray(value)) return value.map((item) => localize(item, locale)) as T;
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    // Skip `fooPt` only when `foo` exists, so a field genuinely named `ctaPt` survives.
    if (key.endsWith(PT_SUFFIX) && key.length > PT_SUFFIX.length && key.slice(0, -PT_SUFFIX.length) in source) continue;
    const translated = source[`${key}${PT_SUFFIX}`];
    const usePt = locale === "pt" && typeof translated === "string" && translated.trim() !== "";
    result[key] = usePt ? translated : localize(child, locale);
  }
  return result as T;
}
```

## check-cms

Run in the build **after** `generate`. `pageExists` is site-specific: check the
route table, content files and redirects.

```ts
// scripts/check-cms.ts (core)
type Schema = { $ref?: string; allOf?: Schema[]; anyOf?: Schema[]; properties?: Record<string, Schema>; items?: Schema; required?: string[] };
const LINK_KEY = /^(href|url|link)$|(Href|Url|Link)$/;

function flatten(schema: Schema, defs: Record<string, Schema>): Schema {
  const s = schema.$ref ? flatten(defs[schema.$ref.replace("#/definitions/", "")] ?? {}, defs) : schema;
  // Array fields are anyOf [Resolvable, array]: check the inline branch.
  const inline = (s.anyOf ?? []).filter((b) => !b.$ref?.endsWith("/Resolvable"));
  const parts = [s, ...[...(s.allOf ?? []), ...inline].map((p) => flatten(p, defs))];
  return {
    ...s,
    items: parts.find((p) => p.items)?.items,
    required: parts.flatMap((p) => p.required ?? []),
    properties: Object.assign({}, ...parts.map((p) => p.properties ?? {})),
  };
}

function checkValue(value: unknown, schema: Schema | undefined, path: string, ctx: Ctx, errors: string[]) {
  const s: Schema = schema ? flatten(schema, ctx.defs) : {}; // no schema: still check links
  if (Array.isArray(value)) return value.forEach((v, i) => checkValue(v, s.items, `${path}[${i}]`, ctx, errors));
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const field of s.required ?? []) {
    const v = record[field];
    if (field !== "__resolveType" && (v == null || (typeof v === "string" && !v.trim()))) errors.push(`${path}.${field} is required`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" && LINK_KEY.test(key.replace(/Pt$/, "")) && child.startsWith("/") && !ctx.pageExists(child))
      errors.push(`${path}.${key} links to a page that does not exist: ${child}`);
    checkValue(child, s.properties?.[key], `${path}.${key}`, ctx, errors);
  }
}

export function checkBlock(name: string, block: Record<string, any>, ctx: Ctx, label = `"${name}"`): string[] {
  const errors: string[] = [];
  const type = block?.__resolveType;
  if (typeof type !== "string") return [`${label} has no __resolveType`];
  if (ctx.pages.has(type)) { // meta.manifest.blocks.pages
    if (typeof block.path !== "string" || !block.path.startsWith("/")) errors.push(`${label}.path must start with /`);
    (block.sections ?? []).forEach((section: any, i: number) =>
      errors.push(...checkBlock(name, section, ctx, `${label}.sections[${i}]`)));
    return errors;
  }
  const section = ctx.sections[type]; // meta.manifest.blocks.sections
  if (!section && !ctx.blockNames.has(type)) return [`${label} uses ${type}, which is neither a section nor a block`];
  checkValue(block, section, label, ctx, errors);
  return errors;
}
```

`main()` reads `.deco/meta.gen.json` and every `.deco/blocks/*.json` (block name
= `decodeURIComponent(filename)`), runs `checkBlock` on each, then reports
missing `GLOBAL_BLOCK_NAMES` and `PAGE_PATHS` without a page. Exit 1 on any
error. Cover each rule with a unit test that builds a small fake schema.
