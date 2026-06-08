# Detecting a deco.cx ecommerce repo

Phase 1 of the skill aborts if the repo isn't deco.cx. Use multiple signals and require at least one strong positive. After confirming it's deco, classify the runtime (Deno vs Node/Bun) — wiring differs. See `deno-fresh-setup.md` for Deno-specific guidance.

## Strong signals (any of these = deco.cx repo)

1. **`deco.ts` or `deco.tsx` at repo root.** This is the deco runtime entry. Most reliable signal.
2. **`wrangler.toml` with `decoctl` or `deco` in the name field.** deco apps deploy via Cloudflare Workers using a deco-specific wrangler config.
3. **`package.json` dependency on `@deco/*` or `@decocms/*` packages** — e.g., `@deco/dev`, `@deco/storefront`, `@decocms/runtime`.
4. **`deno.json` importing from `https://deno.land/x/deco@*`** or `npm:@deco/*`.
5. **PR history with comments from `decobot`/`deco-bot`/`decocms-bot`** — query: `gh pr list --state all --limit 10 --json comments`. If any past PR has deco-bot comments, the repo is deco-deployed.

## Ecommerce vs internal tooling

A repo passing the strong signals above might still be **internal tooling** (admin panel, MCP, ops dashboard) rather than an ecommerce storefront. The skill only applies to storefronts. Filter further:

- README/description mentions "store", "ecommerce", "storefront", "loja", or a brand name.
- `routes/` (Fresh) or `pages/`/`app/` (Next) contains files like `produto/`, `product/`, `categoria/`, `c/`, `carrinho/`, `cart/`, `checkout/`.
- Components named `ProductCard`, `ProductShelf`, `PDP`, `PLP`, `BuyButton`, `Minicart`, etc.

If none of these are present, the repo is likely internal tooling — abort with a clearer message naming the missing ecommerce signals.

## Runtime classification (after confirming it's a deco ecommerce)

| Signal | Classification |
|---|---|
| `deno.json` (or `deno.jsonc`) AND no `package.json` | **Pure Deno + Fresh** → see `deno-fresh-setup.md` |
| `deno.json` AND `package.json` (mixed) | **Mixed** → prefer `package.json` wiring (likely Cypress/Vite already there) |
| `package.json` AND no `deno.json` | **Pure Node/Bun** → default wiring |
| Neither (just `wrangler.toml`) | Rare — ask the user. Likely a broken setup. |

The runtime classification drives which template files the skill scaffolds in Phase 4:
- Pure Deno → `qa-pr-deno.yml.tmpl`, `qa-main-deno.yml.tmpl`, merge `deno-tasks.json.tmpl` into `deno.json`.
- Mixed or Pure Node/Bun → `qa-pr.yml.tmpl`, `qa-main.yml.tmpl`, add scripts to `package.json`.

## Existing test framework detection

Independent of runtime, check what test frameworks already exist:

| Framework | Signals |
|---|---|
| Cypress | `cypress.config.{js,ts}`, `cypress/` directory, `cypress` in deps |
| Playwright (test) | `playwright.config.{js,ts}`, `@playwright/test` in deps |
| Vitest | `vitest.config.{js,ts}`, `vitest` in deps |
| Jest | `jest.config.{js,ts}`, `jest` in deps |

The skill does NOT remove or migrate these — it adds `@decocms/qa` alongside. See `coexistence-with-existing-tests.md`.

## Weak signals (suggestive but not definitive)

- `apps/` directory with deco-style app manifests.
- `.deco/` or `decofile/` directory.
- `manifest.gen.ts` (codegen artifact from deco CLI).
- `fresh.config.ts` or `fresh.gen.ts` — Fresh framework, often deco's base.
- Imports from `https://deno.land/x/deco@*`.

## Negative signals (abort if seen)

- `next.config.*` + no deco files → standalone Next.js, not deco.
- `gatsby-config.*`, `astro.config.*`, `nuxt.config.*` → other frameworks.
- `shopify.app.toml` + no deco files → Shopify Hydrogen or app, not deco.

## Detection procedure

Run these checks in order, stop at first match:

1. `Glob("deco.{ts,tsx}", root)` → match means deco.
2. `Read("wrangler.toml")` → check for `decoctl` or `deco-`.
3. `Read("package.json")` → check `dependencies` and `devDependencies` for any `@deco/*`.
4. `gh pr list --state all --limit 10 --json comments` → check for decobot.
5. If none of 1-4: ABORT with clear message naming the missing signals.

Abort message format:

```
This skill targets deco.cx ecommerce repos. Could not confirm this is one:
  - deco.ts / deco.tsx not found
  - wrangler.toml absent or no decoctl reference
  - no @deco/* dependencies in package.json
  - no decobot comments in recent PR history

If this IS a deco.cx repo, please share the signal I missed.
```

## Production URL detection

Once stack is confirmed, detect prod URL for `.qarc.json`:

1. **`wrangler.toml`** — look for `routes` field with `*.com/*` pattern. Extract the domain.
2. **README.md** — first H1 paragraph often mentions the production URL.
3. **`.env.example` or `.env.production`** — `SITE_URL`, `PUBLIC_URL`, `DECO_SITE_URL` keys.
4. **GitHub repo metadata** — `gh repo view --json homepageUrl`.

If multiple candidates conflict (e.g., wrangler has staging URL, README has prod URL), ask the user via `AskUserQuestion` rather than guessing.
