---
name: block-cleanup
description: >-
  Audits and removes unnecessary .deco blocks in deco.cx/storefront projects. Identifies blocks
  not referenced by any page, blocks with legacy/test/backup names, inactive A/B tests, and
  duplicate redirects. Use when the user asks to clean up blocks, reduce deploy size, remove
  legacy content, or when the project has too many accumulated blocks.
---

# Block Cleanup — deco.cx

deco.cx projects accumulate blocks in `.deco/blocks/` over time. Unreferenced blocks increase
repository size, slow down deploys, and add noise to the CMS.

## Workflow

### 1. Audit — run the script

```bash
python3 scripts/audit-blocks.py /path/to/project
```

The script produces a report with 4 categories:
- **Orphans** — blocks never referenced by any active page
- **Legacy/Test** — blocks whose name contains `test`, `legacy`, `backup`, `example`, `old`, `bkp`
- **Inactive A/B** — `website/matchers/random.ts` matchers with `traffic=0` or `traffic=100`
- **Duplicate redirects** — identical destinations with different sources

### 2. Manual review

Before deleting:
- Confirm with the team that "orphan" blocks are not being used via API or dynamic context
- Check if A/B test blocks with traffic != 0/100 still have a pending decision
- Redirect blocks are rarely orphans — they are referenced via routes, not sections

### 3. Deletion

```bash
# Delete a single file
rm .deco/blocks/Test%20A%2FB%20Minicart.json

# Delete several at once (with care)
rm .deco/blocks/Test*.json
```

Commit after deletion. There is no need to publish via admin for blocks to stop existing —
deleting from git is sufficient.

## Deco block structure

- **Pages** (`website/pages/Page.tsx`): have `name`, `path`, `sections[]`
  - `sections[i].__resolveType` = name of the section block the page uses
- **A/B Matchers** (`website/matchers/random.ts`): have `traffic` (0–1)
- **Redirects** (`website/loaders/redirect.ts`): have `from` and `to`
- **Sections** (any other type): reusable blocks referenced by pages

## Identifying unreferenced blocks

A block is "orphan" if its filename does not appear as `__resolveType` in any page.
Note: sections can be referenced by block name (e.g. `"Header - 01"`) or by relative path.
The script handles both cases.

## Quick reference for suspicious names

```
teste / test / teste a/b / teste ab
legacy / legado
backup / bkp
exemplo / example
old / antigo
```

## Scripts

- `scripts/audit-blocks.py` — full auditor with report output
