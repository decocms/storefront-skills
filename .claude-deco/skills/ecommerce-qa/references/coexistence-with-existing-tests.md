# Coexisting with existing test frameworks

A repo may already have Cypress, Playwright, Vitest, or Jest configured. The skill does NOT replace them — it adds `@decocms/qa` alongside. Three reasons:

1. **Don't break what works.** The team's existing tests have institutional knowledge baked in (auth flows, fixtures, test data setup) that you can't easily migrate.
2. **Scope discipline.** This skill sets up the canonical purchase journey. Bespoke tests (login flow, custom forms, edge cases) are out of scope and belong with the existing framework.
3. **Low risk PR.** Adding files is reviewable. Removing existing tests is a separate decision with separate risk.

## Detection

In Phase 1, check for signals of existing test frameworks:

| Framework | Signals |
|---|---|
| Cypress | `cypress.config.{js,ts}`, `cypress/` directory, `cypress` in `package.json` deps |
| Playwright (test) | `playwright.config.{js,ts}`, `tests/` or `e2e/` with `*.spec.ts`, `@playwright/test` in deps |
| Vitest | `vitest.config.{js,ts}`, `vitest` in deps |
| Jest | `jest.config.{js,ts}`, `jest` in deps |
| Other | any `*.spec.{js,ts}` files outside `node_modules/` |

If any are present, the skill records them in the Phase 2 mapping table and prints a note:

> Detected existing test framework: Cypress. The skill will add `@decocms/qa` alongside it — your existing tests are untouched. The new `qa:local` script does not conflict with Cypress's `cypress:open` / `cypress:run`.

## Naming conflicts

The only script the skill adds is `qa:local` (a local-debug convenience). Conflict is rare — most projects use `test:*` or `cypress:*` for similar purposes. If the repo already has `qa:local` for something else, the skill renames its script to `deco-qa:local` and updates the README accordingly.

There are no CI workflow files to conflict over — the journey runs on the deco control-plane (see SKILL.md → **Where it runs**), not via a workflow committed to the store.

## Overlap with an existing purchase-journey suite — coexist, but flag it

The frameworks above usually test *different* things (login, forms, edge cases) and just coexist. But sometimes the repo already has a hand-written Playwright suite that walks the **same** purchase funnel (home → PLP → PDP → add-to-cart → minicart) — commonly a performance-metrics suite (TTFB / cache cold-vs-warm / lazy `/deco/render`) that clicks through the funnel as a side effect (e.g. the output of a perf-testing setup like the `deco-e2e-testing` skill).

**Detect the overlap** (not just "Playwright is present") — a spec where all three hold:
- it navigates home → PLP → PDP → add-to-cart; AND
- it finds elements by **brittle text/class selectors** (`button:has-text("COMPRAR")`, `[class*="minicart"]`) rather than `data-qa-*`; AND
- its cart assertion is **weak** — e.g. `expect(minicartOpen).toBe(true)`: it checks the drawer *opened*, not that the cart holds the right item / quantity / price, and it stops before `/checkout`.

That funnel-walk is exactly what `@decocms/qa` now does deterministically (stable `data-qa-*` selectors) and more strictly (cart-state assertions through `/checkout`) — so it is **redundant and more fragile** than the engine. Meanwhile any **performance-forensics** the suite collects (cache hit/miss per loader, Server-Timing, lazy-render analysis) is genuinely additive — the engine does NOT replace it.

**Still coexist — never delete or rewrite the existing suite.** The overlap is flagged in the Phase 5 PR body so the team decides:

> Heads-up: `tests/e2e/<spec>` already walks the purchase funnel with text/class selectors and only asserts the minicart opened. This PR's `@decocms/qa` journey now covers that funnel deterministically and asserts real cart state (item / quantity / variant / price / persistence) through `/checkout`. You can safely **drop the funnel-walk + `minicartOpen` assertion** and keep only the suite's performance-metrics collection (TTFB / cache / lazy-render), which the engine doesn't do. Optional — left to you.

Detecting the overlap and **leaving the suite untouched** is the rule; the recommendation lives in the PR description, never in a code change. For a full migration, the canonical journey is documented at https://github.com/decocms/qa (informational — the skill does not perform it).

## What about `package.json` test runner conflict?

If the existing framework uses Bun (`bun test`) and the new engine uses Bun (`bunx @decocms/qa`), there's no conflict — they're independent invocations. If the existing framework uses npm/yarn/pnpm, the engine's `bunx` calls still work (Bun is just a faster `npx`), but the team may prefer consistency:

- All-npm repo: change templates to `npx @decocms/qa` instead of `bunx`.
- All-pnpm repo: change to `pnpm dlx @decocms/qa`.
- Mixed: stick with `bunx` (works regardless of which other tools are present).

The default is `bunx` (matches the engine's recommended runtime). The skill should ask the user via `AskUserQuestion` if the repo has a clear pnpm/npm convention that should be honored.
