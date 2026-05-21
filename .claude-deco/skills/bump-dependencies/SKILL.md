---
name: bump-dependencies
description: Update deco and apps dependencies in a deco.cx storefront. Use when the user asks to bump, update, or upgrade deco, apps, or storefront dependencies.
---

# Bumping Dependencies in deco.cx

Deco storefronts pin their dependencies in `deno.json`. The two main packages to keep updated are **@deco/deco** (the core framework) and **apps** (the deco apps ecosystem).

---

## Quick Way — `deno task update`

The recommended way to bump dependencies:

```bash
deno task update
```

This runs Deco's official update script (`https://deco.cx/update`) which automatically updates all deco-related dependencies to their latest compatible versions.

After updating, clean the cache to avoid stale modules:

```bash
deno task cache_clean
```

Which runs `rm deno.lock; deno cache -r main.ts`.

---

## Manual Bump — Editing `deno.json`

When you need to pin a specific version or update selectively, edit `deno.json` directly.

### Dependencies to Update

There are two groups of entries per package — **JSR imports** and **CDN imports** — and their versions must stay in sync.

#### @deco/deco (core framework)

```jsonc
// deno.json → imports
{
  // JSR import — main entry point
  "@deco/deco": "jsr:@deco/deco@1.191.2",
  "@deco/deco/": "jsr:@deco/deco@1.191.2/",

  // CDN import — used for raw file access
  "deco/": "https://cdn.jsdelivr.net/gh/deco-cx/deco@1.191.2/",

  // Dev tools — keep in sync with deco version
  "@deco/dev": "jsr:@deco/dev@1.191.2",
  "@deco/dev/": "jsr:@deco/dev@1.191.2/"
}
```

When bumping `@deco/deco`, update **all four entries** to the same version. Also update `@deco/dev` to match.

#### apps (deco apps ecosystem)

```jsonc
// deno.json → imports
{
  // CDN import — main entry point
  "apps/": "https://cdn.jsdelivr.net/gh/deco-cx/apps@0.144.1/"
}
```

Single entry — just update the version number in the URL.

### Finding the Latest Version

Before bumping, check the latest available versions:

- **@deco/deco** — check JSR: `https://jsr.io/@deco/deco`
- **apps** — check GitHub releases: `https://github.com/deco-cx/apps/releases`

Or from the command line:

```bash
# Latest @deco/deco on JSR
deno info jsr:@deco/deco

# Latest apps release on GitHub
gh release list -R deco-cx/apps -L 1
```

### Step-by-Step Manual Bump

1. **Find the latest version** using the methods above
2. **Find the current versions** in `deno.json` under `imports`
3. **Replace the version numbers** — make sure JSR and CDN versions match for `@deco/deco`
3. **Clean the cache:**
   ```bash
   rm deno.lock; deno cache -r main.ts
   ```
4. **Start the dev server** to verify nothing broke:
   ```bash
   deno task start
   ```
5. **Run checks:**
   ```bash
   deno task check
   ```

---

## Other @deco/* Packages

These are secondary packages that may also need updating, but less frequently:

| Package | Import pattern | Notes |
|---|---|---|
| `@deco/mcp` | `jsr:@deco/mcp@x.y.z` | MCP server integration |
| `@deco/durable` | `jsr:@deco/durable@x.y.z` | Durable objects |
| `@deco/warp` | `jsr:@deco/warp@x.y.z` | Edge runtime |

These do **not** necessarily follow the same version as `@deco/deco`. Update them independently as needed.

---

## Troubleshooting

### Cache issues after bump

If you see import errors or stale modules after updating:

```bash
rm deno.lock; deno cache -r main.ts
```

### Type errors after bump

Run the full check suite to catch issues early:

```bash
deno task check
```

This runs formatting, linting, and type checking.

### Version mismatch between JSR and CDN

If `@deco/deco` JSR version and `deco/` CDN version don't match, you'll get runtime errors or inconsistent behavior. Always keep them in sync.
