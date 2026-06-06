---
name: deco-ecommerce-qa
description: Use when inside a deco.cx ecommerce repository (deco.ts present, decobot in PR history) and the user wants automated QA for purchase-journey correctness — set up E2E coverage, test the add-to-cart / checkout flow, or scaffold a CI gate for the store with the @decocms/qa engine. NOT for load/cache performance testing (use deco-e2e-testing) or hand-written Playwright spec files.
---

# Setup deco.cx Ecommerce QA

## Overview

Installs E2E coverage of the purchase journey (home → PLP → PDP → cart → `/checkout`) in a deco.cx ecommerce repo, opens a PR. Strategy: mark critical JSX elements with `data-qa-*` boolean attributes (standardized across 200+ stores), generate engine config + GitHub Actions workflow that runs on PR previews (decobot) and main.

**Core principle: do NOT probe selectors at runtime.** Selectors are deterministic because the JSX is the source of truth. If a `data-qa-*` attribute is missing, the CI fails — that IS the contract.

## When to use

- User is inside a deco.cx ecommerce repo and asks to add QA, E2E, Playwright, smoke tests, checkout tests, or "set up tests".
- Repo has `deco.ts`/`deco.tsx`, `wrangler.toml` with `decoctl`, or `decobot` in PR comment history.

## When NOT to use

- Repo is not a deco.cx ecommerce (Shopify Hydrogen, standalone Next.js, marketing site).
- Engine package `@decocms/qa` is not published / unreachable — verify with `npm view @decocms/qa version` before starting. Capture that version and **pin it exactly** in every CI path: the verdict must stay reproducible and attributable to *store* changes, never to engine drift (a journey is a regression signal only if red ⟺ the store broke). `@latest` is reserved for local debugging (`qa:local`). See **Engine version pinning** below.
- User explicitly asks for Playwright `*.spec.ts` files instead of the engine-driven setup.

## Canonical data-qa attributes

> **The slug list is owned by the engine and grows between versions. ALWAYS run `npx @decocms/qa@{{ENGINE_VERSION}} list-slugs` (or `deno run -A npm:@decocms/qa@{{ENGINE_VERSION}} list-slugs`) at the start of Phase 2 and treat its output as authoritative** — do not trust this table or your memory. The list below is a snapshot and may lag the engine. `qa doctor --url <URL>` reports which slugs are present on a given page.

Snapshot of the canonical slugs (verify with `list-slugs`):

| Slug | Element |
|---|---|
| `data-qa-category-link` | Category link in header/menu (mobile + desktop both OK) |
| `data-qa-menu-trigger` | Hamburger button that opens nav drawer (required if category link is drawer-gated) |
| `data-qa-dismiss` | Close control (the ✕) of a blocking popup/overlay — newsletter, cookie-consent, age-gate. Optional but **strongly recommended** when the store shows such a popup before a product is reached: the engine clicks it to clear the overlay, so no `?qa=`-style branching is needed. See `references/data-qa-conventions.md`. |
| `data-qa-product-card` | Each product card wrapper on PLP |
| `data-qa-pdp-title` | Product `<h1>` on PDP |
| `data-qa-buy-button` | Add to cart CTA on PDP |
| `data-qa-variant-option` | Size/variant option(s) on PDP — required if the store gates add-to-cart behind variant selection (mark the visible, clickable option in every render branch) |
| `data-qa-variant-confirm` | Optional "confirm variant" button, if the store has a separate confirm step after picking a variant |
| `data-qa-cart-icon` | Cart icon in header |
| `data-qa-cart-count` | Cart item-count badge near the cart icon (engine asserts it increments after add-to-cart) |
| `data-qa-minicart` | Minicart drawer wrapper |
| `data-qa-minicart-checkout` | "Go to checkout" CTA inside minicart |
| `data-qa-checkout-page` | Wrapper of `/checkout` page (assertion target) |
| `data-qa-cep-input` | CEP input (optional, BR stores) |
| `data-qa-cep-submit` | CEP submit button (optional) |
| `data-qa-search-input` | Search input (optional) |
| `data-qa-pdp-price` | PDP selling/"from" price (cart-state assertion) |
| `data-qa-minicart-items` | Minicart line-list container — **must render in both the empty and filled states** (the empty-cart gate is `wrapper present && 0 rows`, so a missing wrapper on the empty state silently no-ops). Detail in `references/cart-state-gates.md`. |
| `data-qa-minicart-item` | Each minicart line wrapper (cart-state assertion) |
| `data-qa-minicart-item-name` / `data-qa-minicart-item-variant` / `data-qa-minicart-item-price` | Name / variant label / per-item price within a line |
| `data-qa-minicart-item-remove` | Remove control in the line |
| `data-qa-minicart-subtotal` / `data-qa-minicart-total` | Cart subtotal / total (mark the visible one) |
| `data-qa-quantity-value` / `data-qa-quantity-increment` / `data-qa-quantity-decrement` | Shared quantity stepper (generic — scope by `data-qa-minicart-item` ancestor) |

The engine prefers the first **visible** element when multiple match. Safe to mark mobile + desktop variants both.

**Cart-state slugs (the `data-qa-pdp-price` / `data-qa-minicart-*` / `data-qa-quantity-*` block above) are asserted by the engine itself in `@decocms/qa` ≥ 0.3.0** — the journey gains `cart-persists-reload` + `cart-controls` steps and fails the verdict when the cart is empty / wrong quantity / variant / price. Just mark them; do NOT scaffold companion scripts. (The pinned 0.5.x engine prints all cart-state slugs in `list-slugs`; very old engines resolved them from config at runtime and may omit them — check the version, not just `list-slugs`.) Each cart-state assertion is gated on its marker's presence (missing marker → skipped, not failed), so mark them all to get full coverage. See `references/cart-state-gates.md` for placement plus the pt-BR price-parse and dead-code-path gotchas.

## Phases

Execute in order. Each phase is idempotent — running the skill twice on the same repo only fills gaps, doesn't overwrite.

### Phase 1 — Recognize the repo

- Confirm it's a deco.cx ecommerce (not just any deco-deployed app). Need both a deco signal AND an ecommerce signal — see `references/deco-stack-detection.md`. If only deco signals are present without ecommerce shape (no `ProductCard`/`BuyButton`/checkout routes), ABORT — repo is likely internal tooling.
- **Classify the runtime:**
  - `deno.json` AND no `package.json` → **Pure Deno + Fresh**. Use Deno workflow templates + merge tasks into `deno.json`. See `references/deno-fresh-setup.md`.
  - `deno.json` AND `package.json` → **Mixed**. Use default (Node/Bun) wiring via `package.json`.
  - Only `package.json` → **Pure Node/Bun**. Default wiring.
- **Detect existing test frameworks** (Cypress, Playwright, Vitest, Jest): leave them alone — the skill adds `@decocms/qa` alongside. See `references/coexistence-with-existing-tests.md`.
- Detect package manager from lockfile (`bun.lock` / `pnpm-lock.yaml` / `package-lock.json` / `deno.lock`).
- **Capture the engine version to pin:** `npm view @decocms/qa version`. This is the value for `{{ENGINE_VERSION}}` in every template (workflows, deno tasks, the `package.json` devDep). See **Engine version pinning** at the end of Phase 4.
- Detect production URL from `wrangler.toml`/README/env files. If unclear, ask the user via `AskUserQuestion`.
- Check if `.qarc.json` already exists. If yes, switch to AUGMENT mode (skip Phase 4 workflow generation).
- Check past PRs for deco preview bots (`decobot`/`deco-bot`/`decocms-bot`). If none found in last 10 PRs, the repo may not have automatic previews — ask the user whether to install the PR workflow or only `qa-main.yml`.

### Phase 2 — Locate target elements

**First, fetch the authoritative slug list:** run `deno run -A npm:@decocms/qa@{{ENGINE_VERSION}} list-slugs` (or `npx @decocms/qa@{{ENGINE_VERSION}} list-slugs`) — the **same version you pinned in Phase 1**, so you map against exactly what CI will run. Map against THAT list, not from memory — slug names and counts change between engine versions (e.g. variant handling is `data-qa-variant-option` / `data-qa-variant-confirm`, not the older guess `data-qa-pdp-variants`).

For each canonical attribute, find candidate JSX in the codebase:

1. Grep for semantic patterns (multiple aliases per slug — list in `references/component-detection.md`).
2. Read each candidate file via Read (do NOT trust grep alone — confirm it's the JSX you want).
3. Classify each match:
   - **Native HTML** (`<button>`, `<a>`): inline edit.
   - **Local component** (`<BuyButton />` defined in this repo): edit the component definition. Verify it spreads `...props` to its root element.
   - **External component** (imported from `@deco/storefront` etc.): apply at callsite. If the component filters props, fall back to wrapper. See `references/wrapping-external-components.md`.

Build a table: `slug → file:line → strategy → confidence`. **Present this table to the user before any edits.** The user approves the mapping; only then proceed to Phase 3.

If confidence is low for any slug (multiple plausible matches, ambiguous semantics), do NOT auto-edit — leave a `{/* TODO(qa): mark with data-qa-<slug> */}` comment near the most likely candidate and list it for human resolution.

### Phase 3 — Apply data attributes

Use Edit (not Write) for surgical changes. Preserve indentation, existing props, attribute order. Examples:

- Native HTML: `<button onClick={addToCart}>` → `<button data-qa-buy-button onClick={addToCart}>`
- Local component def: add `data-qa-buy-button` to the root element of `BuyButton.tsx`, ensuring it spreads `{...props}` (add the spread if missing).
- External component callsite: `<Button>Buy</Button>` → `<Button data-qa-buy-button>Buy</Button>`. If `data-*` is filtered: wrap with `<span data-qa-buy-button><Button>Buy</span>`.

Do NOT batch edits via Write — every change must be a targeted Edit with surrounding context preserved.

### Phase 4 — Scaffold config + workflows

Skip this phase entirely in AUGMENT mode. Pick template variants based on the runtime classification from Phase 1.

**Common to all runtimes:**
- `.qarc.json` (root): URL, CEP (`01310-100` default), viewports `["desktop","mobile"]`, empty `selectors` and `features` (see `references/checkout-quirks.md` for when to populate `features.checkoutUrlPattern` / `checkoutCrossOrigin`).
- `.gitignore`: append `qa-output/`.
- **Previews behind Cloudflare (engine ≥ 0.5.0).** The PR workflow runs against the decobot `*.decocdn.com` preview, which is fronted by Cloudflare Bot Management — a CI datacenter-IP headless Chromium gets a `403`/challenge instead of the store. The engine (≥ 0.5.0) tags its User-Agent with a `deco-qa-bot/1.0` token so a **one-time** zone WAF carve-out can let the QA bot through without weakening protection for real users. Set it once at the Cloudflare zone (works for every deco store); see `references/cloudflare-bot-allowlist.md`. If you can't touch the zone, use a `workflow_dispatch.url` override or the Deno local-boot fallback below.
- **Waiting for the prod deploy on main.** A push to `main` only *triggers* deco's prod build/deploy, which runs asynchronously **off** GitHub Actions (minutes) — it is NOT a workflow or check-run, so there's nothing to `needs:`. If QA-main fires on `push` and hits prod immediately, it races the deploy and tests the *previous* version → false `data-qa-*`-missing failures. The fix (baked into both `qa-main.yml` templates): a `Wait for deco prod deploy` step polls the deco **commit status** `Deco / <site> / prod` (legacy status API) via `getCombinedStatusForRef` until it flips `pending → success`, then runs the journey; it fails fast on `failure`/`error` (with the build-logs link) and times out after 20 min. Gated on `github.event_name == 'push'` so `workflow_dispatch` overrides skip the wait. The context carries the per-store slug, so it's matched by pattern `/^Deco \/ .+ \/ prod$/` (site-agnostic). This mirrors the PR workflow's `Wait for deco preview`. See `references/decobot-preview-parsing.md`.

**Pure Node/Bun (or Mixed):**
- `.github/workflows/qa-pr.yml` (from `templates/workflows/qa-pr.yml.tmpl`): triggers on `pull_request` + `workflow_dispatch` (manual URL fallback). Polls for deco preview comment (handles multiple bot logins + marker styles — see `references/decobot-preview-parsing.md`), runs `bunx @decocms/qa@{{ENGINE_VERSION}} journey --url $PREVIEW_URL --junit junit.xml --github`.
- `.github/workflows/qa-main.yml` (from `templates/workflows/qa-main.yml.tmpl`): triggers on push to `main` + `workflow_dispatch`. **Waits for the deco prod deploy** (polls the `Deco / <site> / prod` commit status until `success`) before running the engine against the prod URL — see "Waiting for the prod deploy on main" below.
- `scripts/qa-local.sh`: `bunx @decocms/qa journey --url ${1:-http://localhost:8000} --headed --debug`.
- `package.json`: add `@decocms/qa` as a devDep **pinned to the exact `{{ENGINE_VERSION}}`** (not `latest` / `^`) + scripts `qa:local`, `qa:smoke`. Commit the lockfile so CI installs that exact build.

**Pure Deno + Fresh:**
- `.github/workflows/qa-pr.yml` (from `templates/workflows/qa-pr-deno.yml.tmpl`) and `.github/workflows/qa-main.yml` (from `qa-main-deno.yml.tmpl`). Same **preview-link** strategy as Node/Bun, but with Deno: `denoland/setup-deno@v2.x`, poll the decobot comment for the `*.decocdn.com` preview (secure bot-only filter — see `references/decobot-preview-parsing.md`), then `deno task qa:run --url "$TARGET_URL"`. The main workflow also **waits for the prod deploy commit status** before running (see "Waiting for the prod deploy on main" above). The Playwright step derives the engine's chromium revision from the pinned version (`npm view @decocms/qa@{{ENGINE_VERSION}} dependencies.playwright`). **`{{ENGINE_VERSION}}` (from Phase 1) is the only placeholder to fill — otherwise site-agnostic.** `workflow_dispatch.url` overrides to hit any reachable URL (e.g. prod smoke).
  - **Requires engine ≥ 0.5.0 + the Cloudflare carve-out** (see the "Previews behind Cloudflare" note above). Without the `deco-qa-bot` allowlist the preview 403s the CI runner.
  - **Fallback when you can't add the Cloudflare carve-out** (no zone access): build & boot the storefront in CI (`deno task build` → `deno task preview` → `--url http://localhost:8000`) instead of polling the preview. Slower (cold deco builds re-fetch the module graph — pre-warm with `deno cache`) and needs the decofile committed at `.deco/blocks/`. See `references/ci-local-boot.md` for that workflow variant.
- `deno.json`: merge in tasks from `templates/deno-tasks.json.tmpl` (`qa:local`, `qa:smoke`, `qa:run`). `qa:run` / `qa:smoke` pin `npm:@decocms/qa@{{ENGINE_VERSION}}`; only `qa:local` keeps `@latest` (local debug). Commit `deno.lock`. `qa:run` may carry `--timeout 20000` as headroom.
- Do NOT create `package.json`. Do NOT create `scripts/qa-local.sh` (tasks live in `deno.json`).

**If pre-existing scripts `qa:local`/`qa:smoke` conflict:** rename the skill's to `deco-qa:local`/`deco-qa:smoke` and update workflows accordingly. See `references/coexistence-with-existing-tests.md`.

**Engine version pinning (deterministic CI).** The journey verdict must be reproducible and attributable to *store* changes — never to engine drift. So every CI/verdict path pins the **exact** `{{ENGINE_VERSION}}` captured in Phase 1: the workflow `journey` commands, `qa:run`/`qa:smoke`, and the `package.json` devDep + committed lockfile (`deno.lock` for Deno). `@latest` is reserved for `qa:local`, where reproducibility doesn't matter and you want the newest build to debug against. **Bump deliberately, never automatically:** to adopt a newer engine, open a PR that bumps `{{ENGINE_VERSION}}` in the workflows + `package.json`/`deno.json` — the QA journey *is* that PR's gate, so you adopt the new engine only if the store stays green. A tool whose whole value is determinism cannot let a silent `@latest` release flip a store's verdict with no store-side change. (No Renovate/Dependabot — the bump is a human decision.)

### Phase 5 — Open PR

- Create branch `chore/setup-qa`.
- Commit message: `chore(qa): set up E2E suite with data-qa attributes`.
- PR body: include the Phase 2 mapping table, list of modified files, debug instructions (`bun run qa:local`), link to engine docs. **If an existing suite already walks the same purchase funnel** (weak text/class selectors, `minicartOpen`-style assertion — see `references/coexistence-with-existing-tests.md`), add the overlap heads-up so the team can drop the redundant funnel-walk and keep only its perf-metrics. Never edit that suite — flag only.
- **STOP before `git push` and `gh pr create`. Ask the user to confirm.** Modifying source code + opening a PR has high blast radius. Never auto-push. **A standing "don't ask, just ship it" / "I trust you, open the PR" does NOT authorize the push** — under time pressure especially, still show the diff + the PR body and get an explicit yes for *this* push. (Local commits on the `chore/setup-qa` branch are fine; the gate is the push/PR.)

### Phase 6 — Verify

Apply `superpowers:verification-before-completion`: do not declare success without observing the workflow run green.

- After PR is open: `gh pr checks --watch`.
- If checks pass: report JUnit link + success. Done.
- If checks fail: apply `superpowers:systematic-debugging`. Read `gh run view --log-failed`. Most common cause: missing or mis-marked `data-qa-*`. Identify which step of the journey failed, locate the missing element, edit + commit a fix. Do NOT patch in CI logs without re-reading the failing JSX.

## Common mistakes

- **Auto-editing without showing the Phase 2 table to the user.** Always confirm before editing — JSX changes are PR-visible.
- **Using Write instead of Edit.** Write loses surrounding context. Always Edit.
- **Marking PLP product card's buy button with `data-qa-buy-button`.** That's a quick-add on the card, not the PDP CTA. Distinguish: `data-qa-buy-button` is PDP-only.
- **Assuming external components forward `data-*`.** Verify by reading typings or testing in browser. If unsure, wrap.
- **Variant-gated buy button → empty cart → "minicart-checkout not found".** If the buy button is disabled until a size is picked, the engine's click-buy-then-select-variant order leaves it never re-clicking buy. Mark the buy button with BOTH `data-qa-buy-button` and `data-qa-variant-confirm`. Don't misdiagnose the empty cart as a VTEX/localhost issue — it adds to cart fine locally once variant-confirm is set. (See `data-qa-conventions.md`.)
- **Assuming a green journey means the cart actually filled.** Historically the journey asserted *clicks*, NOT *cart state* — so an emptied/wrong-quantity/wrong-price cart passed green. The pinned engine (≥ 0.5.x) asserts cart state natively: mark the cart-state slugs (`data-qa-minicart-item*` etc.) and the journey fails the verdict on a broken cart. No companion scripts — just the markers (see `references/cart-state-gates.md`).
- **Editing the wrong add-to-cart file (dead code).** Before assuming a file matters, grep for imports and trace what `data-qa-buy-button` actually executes. A `sdk/useAddToCart.ts` is often dead code; the real path is usually a local hook in `AddToCartButton/common.tsx` whose `onAddItem` comes from a platform wrapper (`AddToCartButton/vtex.tsx`) where the real `useCart().addItems({ quantity })` lives. A "break" in the dead file is a no-op — and proves nothing about the tests.
- **Two-level mobile drawer.** If the mobile drawer's top-level items open submenus instead of linking to PLPs, step 2 can't find a category link (engine opens only one level) — scope `.qarc.json` to `"viewports": ["desktop"]`.
- **Wrong checkout mode.** Run `curl -sL -o /dev/null -w '%{url_effective} %{num_redirects}' STORE.com/checkout` first: same-origin (0 redirects) → `selectors["data-qa-checkout-page"]="#checkoutMainContainer"`; cross-origin redirect → `features.checkoutCrossOrigin: true`; or skip the DOM marker and assert the URL with `features.checkoutUrlPattern: "**/checkout**"`. (See `checkout-quirks.md` Pattern 2.)
- **Preview returns 403 / bot-challenge in CI.** If the deco preview (or prod) sits behind Cloudflare Bot Management, the journey from a CI-runner IP gets an interstitial/403 instead of the store. Fix (default): engine ≥ 0.5.0 sends a `deco-qa-bot/1.0` User-Agent token — add a **one-time** Cloudflare WAF carve-out for it (`and not http.user_agent contains "deco-qa-bot"`, scoped to `*.decocdn.com`); surgical, and works for every deco store from a single zone rule. See `references/cloudflare-bot-allowlist.md`. Don't fight it with spoofed headers. No zone access? Fall back to booting the storefront in CI and testing localhost (`references/ci-local-boot.md`). *(Learning: technos — the UA carve-out; Osklen earlier used the local-boot fallback.)*
- **QA-main racing the prod publish.** On deco, a push to `main` only *triggers* the prod build/deploy (async, off Actions, minutes). If QA-main runs the journey on `push` immediately, it tests the *previous* prod and reports a false `data-qa-*`-missing failure (the markers exist in the just-merged code but aren't live yet). The `qa-main.yml` template already gates on the deco prod **commit status** (`Deco / <site> / prod` → `success`) before running — don't strip that step. *(Learning: technos #333 — first QA-main push failed at `navigate-plp` because prod hadn't republished yet.)*
- **Verify locally before the PR.** A warm `deno task start` + `deno task qa:run --url http://localhost:8000` reproduces the whole journey (and catches all of the above) without waiting on CI.
- **Declaring success because the PR opened.** Phase 6 is mandatory — workflow must run green.

## References

- `references/data-qa-conventions.md` — full canonical attribute list with placement guidance.
- `references/component-detection.md` — grep patterns per slug, JSX reading heuristics.
- `references/wrapping-external-components.md` — decide inline vs spread vs wrap.
- `references/decobot-preview-parsing.md` — regex + polling logic for the PR comment (multiple styles).
- `references/deco-stack-detection.md` — signals to identify a deco.cx repo + runtime classification.
- `references/deno-fresh-setup.md` — wiring for pure Deno + Fresh repos (no `package.json`).
- `references/cloudflare-bot-allowlist.md` — **the default fix for Cloudflare-gated previews**: the engine's `deco-qa-bot/1.0` UA token (≥ 0.5.0) + the one-time zone WAF carve-out that lets the QA bot through `*.decocdn.com`; how to diagnose, scope, and harden it.
- `references/ci-local-boot.md` — **fallback** for when you can't add the Cloudflare carve-out: build & boot the storefront in CI (`build`+`preview` → localhost) instead of testing the gated deco preview; cold-build pre-warm + the committed-`.deco/blocks` prerequisite.
- `references/coexistence-with-existing-tests.md` — how to coexist with Cypress, Playwright, Vitest, Jest.
- `references/checkout-quirks.md` — VTEX cross-domain (URL-pattern assertion), regional CEPs, variant selectors.
- `references/cart-state-gates.md` — the cart-state markers the engine asserts natively (≥ 0.3.0), plus the dead-code-path and pt-BR price-parse gotchas.
