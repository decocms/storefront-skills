---
name: cms-friendly-props
description: "Use when creating a section, adding or changing a field on an existing section's Props, shaping an editorial array (tabs, cards, links, banners, slides), picking a widget for a field (image, video, color, rich text, HTML, date, secret), or reviewing whether a section is editable enough for a non-technical merchant in the Studio. Covers the JSDoc annotations the schema generator recognises, the formats the Studio form actually renders, and the prop shapes that break the editor in ways code review cannot see. Not about how the component looks — about the shape of the data the editor fills in."
---

# CMS-friendly props

A section's `Props` type **is** the admin form. The shape you write here is the UX
a merchant gets — a badly shaped field is not ugly code, it is a real editor
stuck in front of a real client.

Two rules cover most of it:

1. **Every prop gets `@title`.** Without one, the Studio falls back to the raw
   TypeScript identifier — that is how `desktopCardWidth` ends up as a field
   label in a client's form.
2. **Declaration order is form order.** Put what the editor touches most at the
   top: content before configuration, title before padding.

## How the schema is produced

`@decocms/blocks-cli` (`scripts/generate-schema.ts`) walks the exported `Props`
type with ts-morph and reads **only doc-block comments** (`/** … */`). A plain
`//` comment never reaches the schema. That gives a clean split worth keeping:

- `/** @title … @description … */` — label + help text in the Studio. Written
  for whoever fills the form, not for whoever reads the code.
- `// normal comment` — engineering reasoning, measurements, the "why" behind a
  value. Never shown to the editor.

That split is load-bearing. A real section shipped a `@description` containing
twenty lines of typography measurements and production URLs — the editor opened
the form and got a spec sheet where the help text should be.

After changing `Props`: rerun the generator (`deno task generate` / `bun run
generate:deco`, depending on the stack) and restart the dev server. Nothing
watches for this.

## Annotations the generator recognises

Read from `generate-schema.ts` — `NUMERIC_TAGS`, `BOOLEAN_TAGS`, and the final
passthrough branch.

| Tag | Effect |
|---|---|
| `@title` | Field label |
| `@description` | Help text under the label |
| `@format` | Picks the widget — table below |
| `@titleBy` | Which field labels each row of an array |
| `@default` | Default value; coerces `true`/`false`/`null`/number/JSON, else the raw string |
| `@options` | Inline enum (one JSON object per line), or the loader path for `dynamic-options` |
| `@minimum` / `@maximum` | Numeric bounds, validated in the form |
| `@exclusiveMinimum` / `@exclusiveMaximum` / `@multipleOf` | Numeric constraints |
| `@minLength` / `@maxLength` | String length |
| `@minItems` / `@maxItems` | Array length |
| `@minProperties` / `@maxProperties` | Object size |
| `@uniqueItems` | Forbids repeated array items |
| `@readOnly` / `@writeOnly` / `@deprecated` | JSON-Schema flags |
| `@pattern` | Validation regex |
| `@examples` | One per line, or JSON |
| `@placeholder` | Input placeholder |
| `@hide` | Stays in the schema, hidden from the form |
| `@ignore` | Dropped from the schema entirely — the editor never knew it existed |
| `@widget`, `@icon`, `@label`, `@section`, `@group`, `@mode`, `@hideOption` | Passed through to the schema |

Two coercion traps:

- **Numeric tags** (`minimum`, `maxItems`, `maxLength`, …) are `Number(value)`.
- **Boolean tags** (`readOnly`, `writeOnly`, `deprecated`, `uniqueItems`,
  `ignore`) compare against the literal string `"true"`. Write `@uniqueItems
  true`, not a bare `@uniqueItems`.

**`@hide` vs `@ignore`.** `@ignore` is skipped before the schema is written, so
the prop does not exist for the Studio at all. `@hide` writes `hide: "true"` and
the form filters it out — the field is still in the schema and still resolvable,
which is what you want when another block or the server fills the value. Either
way, leave a `//` comment saying why, or the next person just sees a field that
inexplicably is not there.

## Formats and widget types

Two ways to reach the same widget. `WIDGET_TYPE_FORMATS` in the generator maps a
**type alias** onto a `format`; `@format` sets it directly.

| Type alias | Emitted `format` | Studio widget |
|---|---|---|
| `ImageWidget` | `image-uri` | Image picker (upload / library) |
| `VideoWidget` | `video-uri` | Video upload / URL |
| `HTMLWidget` | `html` | Raw HTML editor |
| `RichText` | `rich-text` | Rich text editor with toolbar |
| `Color` | `color` | Colour picker |
| `Secret` | `password` | Masked field |
| `TextArea` | `textarea` | Multi-line plain text |
| `Code` | `code` | Code editor |
| `DateTimeWidget` | `date-time` | Date/time picker |

Formats the Studio form renders that have **no** type alias — reach them with
`@format`:

| `@format` | Widget |
|---|---|
| `color-input` | Colour picker (accepted alongside `color`) |
| `rich-text-inline` | Rich text without block-level controls |
| `markdown` | Textarea in markdown mode |
| `date` | Date picker (no time) |
| `datetime` | Accepted variant of `date-time` |
| `url` | URL input |
| `file-uri` | File picker (same field as video) |
| `icon-select` | Icon picker, previews from the site's `sprites.svg` |
| `dynamic-options` | Server-backed combo box — see below |
| `location` / `map` | Location and map pickers |

Picking a text widget, in order: **`rich-text`** when the editor needs bold or an
inline link (one field beats a text field plus a separate URL field);
**`textarea`** for plain running text; a bare `string` for one line; **`html`**
only for markup pasted from somewhere else — it is the least protection against
an editor breaking the page.

Never ship a bare `string` where a widget exists. A `videoSrc` with no `@format`
renders as a text box asking a merchant for a URL. And once a field is titled
"Video (MP4)", editors keep pasting URLs even after the picker arrives — rename
it to what it is ("Video (desktop)") and say what an empty value does.

## `@titleBy` — the one-line fix that makes an array usable

Every type used as a CMS array item needs `/** @titleBy <field> */` above it.
Without it the Studio labels every row `Item 1`, `Item 2`, `Item 3` and the
editor has to open each one to find out what it is.

```ts
/** @titleBy label */
export interface FooterLink {
  /** @title Label */
  label: string;
  /** @title URL */
  href: string;
}
```

`@titleBy` also takes a mustache template, including a nested path — useful when
no single field is a good label:

```ts
/** @titleBy {{{image.desktop}}} */
/** @titleBy Slide — {{{alt}}} */
```

It costs one line of JSDoc. There is no reason to skip it.

## `@options` — a closed set instead of free text

**Inline**, one `@options` line per choice:

```ts
/**
 * @title Level
 * @options { "label": "Advanced", "value": "advanced" }
 * @options { "label": "Intermediate", "value": "intermediate" }
 */
level: string;
```

**Server-backed** (`@format dynamic-options` + `@options <loader path>`) — the
editor types and picks a real entity out of the catalog, so there is no typo to
make and they see a product name instead of an id:

```ts
/** @titleBy product */
export interface LookProductRef {
  /**
   * @title Product
   * @description Product shown in this look.
   * @format dynamic-options
   * @options site/loaders/lookProductOptions.ts
   */
  product: string;
}
```

The loader contract: it receives `{ term }` — what the editor is typing — and
returns an array of **plain strings**; the chosen string is stored verbatim. The
trick that makes this readable *and* usable is to pack both halves into one
string (`"<skuId> — <product name>"`) and parse it back out on read.

A plain string union needs none of this — `type Align = 'left' | 'center'`
already renders as a select.

## Shapes that break the editor

### Nest a one-to-many relation. Never link it by a typed key.

If an item belongs to exactly one group, the items array lives **inside** the
group object.

```ts
// Good — a column owns its own links
export interface FooterColumn {
  /** @title Heading */
  heading: string;
  /** @title Links */
  links: FooterLink[];
}

// Bad — two sibling arrays joined by a key the editor types from memory
tabs: { label: string; key: string }[];
cards: { caption: string; categoryKey?: string }[];
```

The bad shape fails three ways: a typed key has no autocomplete, a mismatched key
makes the card vanish from its tab with no visible error, and two arrays now have
to be kept in sync by hand. Only use sibling-plus-key when the relation is
genuinely many-to-many, which is rare in editorial commerce content.

### Two sibling fields with the same anonymous inline type share one form state

This one is invisible in code review and only reproduces inside the Studio.

```ts
// Bad — both fields emit an identical inline schema, so the Studio drives them
// from a single form state: typing into the first mirrors into the second.
collection?: { collectionId: string } | { skuId: string };
collection2?: { collectionId: string } | { skuId: string };
```

It shipped, live, on published content. The fix is a real array — each slot gets
its own schema node, indexed by position:

```ts
/** @titleBy label */
export interface Companion { /* … */ }

/** @title Companion products */
products?: Companion[];
```

Demote the old fields to `@hide @deprecated` rather than deleting them, so
existing decofiles keep resolving.

### Every CMS array can contain holes

An array resolved by the Studio is not really `T[]` at runtime — it is
`Array<T | null>`. A resolvable wrapped around one element (a multivariate flag,
for example) that matches no variant leaves that slot `null` **without shrinking
the array**, and an editor can save an empty row. TypeScript sees none of it: the
generated type says `T[]`, compiles clean, and breaks in production on the first
`.map` that assumes a field exists.

Compact once, at the point the data enters the component, before any
`.map`/`.filter`/`.find`. Prefer a helper that narrows the type over
`.filter(Boolean)`, which works at runtime but leaves you casting afterwards —
and which also eats legitimately authored `0`, `''` and `false`.

This matters most in a section that renders on every page (header, footer): one
unhandled hole there takes down the whole site, not one section.

### Render sensibly with empty props

The Studio opens a brand-new block with empty `Props` and shows a preview. It
must not break and must not be blank. Declare `DEFAULT_*` constants for the shape
optional fields fall back to and use them in the component, instead of scattering
`?? something` through the JSX. A section that renders a real-looking default is
also how an editor learns what the field is for.

### Variants: a discriminated union, not a string enum plus dead fields

When a field can come from genuinely different structures, model it as a union of
types, each with its own `/** @title <readable name> */`. The Studio renders a
variant selector and only shows the fields of the chosen variant — instead of an
inert `aspectRatio` text box sitting under every other choice.

```ts
/** @title Wide */
export interface WideLayout {
  /** @title Aspect ratio */
  aspectRatio: string;
}

/** @title Container */
export interface ContainerLayout {
  // No fields on purpose: Container is the zero-config default crop.
  // An empty object is still a distinct, valid union member — the variant
  // selector needs two real shapes to offer, not a shape and `undefined`.
}

/** @title Layout */
layout?: WideLayout | ContainerLayout;
```

Two details that make this safe on a live section: variants are told apart
structurally at runtime (`'aspectRatio' in layout`), so no extra discriminant
field has to be saved; and keeping the prop **optional** means every decofile
authored before the union existed keeps rendering exactly as it did.

Pair a string union with a `Record<Union, …>` when each member needs a matching
value — the compiler then refuses to let anyone add an option without its
counterpart.

### Treat every free-text CMS field as untrusted input

A text field inside a variant is the one place TypeScript cannot help — the
editor can type anything. Wrap the parsing of such a value in a `try`/`catch` at
the consumer. On a `layout`-level section or anything on the home page, a bad
value takes the whole page down, not just that block.

### Do not leak layout controls as content fields

A CMS field should carry an **editorial** decision — which image, which text,
which colour, how many items. Not a **layout** one — card width in pixels, a
desktop gap separate from a mobile gap as a raw number.

The test: if you removed the field and fixed one value in the component, would
the editor lose a decision they actually need to make? If not, it is not a prop.
A real CMS review with a client removed a set of these because every editor was
using the same value anyway — the fields only added a way to break the layout by
accident.

When a dev-only escape hatch genuinely has to stay visible, suffix its `@title`
with "(advanced)" so the editor can tell it apart from a field meant for daily
use.

### Fields the editor can set with no effect

A prop that reaches no DOM attribute is worse than a missing one — the editor
sets it, nothing happens, and they conclude the CMS is broken. This accumulates
when a shared type is reused for a narrower purpose: a `Cta` type carrying
`buttonStyle`, `backgroundColor`, `hoverColor`, `showArrowIcon` gets attached to
a section that only ever reads `url` and `text`.

To verify a removal, regenerate and inspect the generated schema artifact — every
removed field should be gone from it and every kept field still present.

## Split the type file when `Props` grows

Past roughly 30–40 lines, or once there are two or more nested types (an array
item, a variant union), move the types into a sibling `types.ts` — types only, no
logic. It keeps the shape findable without scrolling the component, and keeps the
generator's job obvious.

More than about eight top-level fields with no grouping reads as a wall of inputs.
Cluster them into named nested objects.

## Checklist before regenerating the schema

- [ ] Every prop has `@title`, and `@description` wherever the field is not
      self-evident.
- [ ] Every type used as a CMS array item has `@titleBy`.
- [ ] Image / video / colour / rich-text / date / secret fields use the right
      type alias or `@format` — no free-text field holding an image URL, no raw
      hex string without a colour picker.
- [ ] One-to-many relations are nested; no two sibling arrays joined by a key the
      editor types.
- [ ] No two sibling fields share the same anonymous inline type.
- [ ] Arrays coming from `Props` are compacted before the first
      `.map`/`.filter`/`.find`.
- [ ] The section renders something sensible with completely empty `Props`.
- [ ] No field is a layout control wearing a content field's clothes.
- [ ] Field order matches the order an editor would fill them, top to bottom.
- [ ] `@description` carries help for the editor — not measurements, URLs, or
      engineering notes.

Then regenerate the schema and restart the dev server.

## Related

`new-section` (scaffolding a section), `images` (what the `@description` of an
image field must say about retina sizing), `variants` (multivariate flags, which
are what puts `null` holes in a CMS array), `review` (the pre-publish pass).
