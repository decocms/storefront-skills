---
name: deco-ecommerce-qa
description: Use when inside a deco.cx ecommerce repository (deco.ts present, decobot in PR history) and the user wants automated QA for purchase-journey correctness — set up E2E coverage, test the add-to-cart / checkout flow, or scaffold a CI gate for the store with the @decocms/qa engine. NOT for load/cache performance testing (use deco-e2e-testing) or hand-written Playwright spec files.
---

# Setup deco.cx Ecommerce QA

## Overview

Installs E2E coverage of the purchase journey (home → PLP → PDP → cart → `/checkout`) in a deco.cx ecommerce repo, opens a PR. Strategy: mark critical JSX elements with `data-qa-*` boolean attributes (standardized across 200+ stores), generate engine config + GitHub Actions workflow that runs on PR previews (decobot) and main.

**Core principle: do NOT probe selectors at runtime.** Selectors are deterministic because the JSX is the source of truth. If a `data-qa-*` attribute is missing, the CI fails — that IS the contract.

## Execution modes

Two modes. **Default is `interactive` — its behavior is exactly as documented in every phase below.** A second `headless` mode exists for onboarding/CI, where deviations are called out inline.

- **`interactive`** (default) — every confirmation gate is live: the Phase 1 `AskUserQuestion`s, the Phase 2 mapping-table approval, and the Phase 5 "confirm before push" stop. Nothing in the `headless` notes changes any of this.
- **`non-interactive` / `headless`** — activated **only** when the env var `QA_SETUP_MODE=headless` is set (equivalently, the caller/onboarding flow sets it). In this mode the three interactive gates are skipped (see the **(headless)** notes in Phases 1, 2, and 5) and **the opened PR becomes the single human review point**. Headless authorizes *only* the documented automatic path — safe defaults, auto-applied HIGH/MEDIUM markings, and the explicit Phase 5 push sequence. It does **not** relax the **idempotency pre-check** (Phase 1), which runs identically in both modes: a fully set-up repo or an already-open setup PR is still a no-op.

If `QA_SETUP_MODE` is unset or any value other than `headless`, run in `interactive` mode.

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
| `data-qa-category-link` | Category link in header/menu (mobile + desktop both OK). **Mark only links that actually open a PLP** — if the header uses one generic nav component for institutional links, dropdown triggers AND category links, marking the generic anchor tags all of them and the engine clicks the wrong (first-in-DOM) one. See `references/category-link-disambiguation.md`. |
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

**CORE markers (the doctor gate — REQ-01).** Eight slugs are the minimum viable journey and are gated at setup time (Phase 3.5) and in CI: `data-qa-category-link`, `data-qa-product-card`, `data-qa-pdp-title`, `data-qa-buy-button`, `data-qa-cart-icon`, `data-qa-minicart`, `data-qa-minicart-checkout`, `data-qa-checkout-page` (the last is satisfied by the attribute **OR** a `features.checkoutUrlPattern` / `features.checkoutCrossOrigin` flag — see Phase 4). Every other slug is optional: a missing **optional** marker just skips its step; a missing **CORE** marker fails setup. Full subsection in `references/data-qa-conventions.md`.

## Phases

Execute in order. Each phase is idempotent — running the skill twice on the same repo only fills gaps, doesn't overwrite.

### Phase 1 — Recognize the repo

**Idempotency pre-check (runs first, in BOTH modes).** Before any other work, short-circuit if the repo is already set up or a setup PR is already open — never duplicate.

- **Already set up? → full no-op.** True when `.qarc.json` exists **and** parses as valid (has `url`, `cep`, `viewports`, `selectors`, `features`) **AND** at least one of: a `.github/workflows/qa-*.yml` workflow exists, or `@decocms/qa` is listed as a dependency in `package.json`/`deno.json`. If fully set up → **exit without opening a PR**, logging what was found (config path + workflow/dep). Do nothing else.
  - **Partial setup keeps AUGMENT mode** (the existing behavior): `.qarc.json` present but **no** workflow and **no** `@decocms/qa` dep → not "fully set up". Continue into Phases 1–3 to fill `data-qa` gaps and **skip Phase 4** (see Phase 4). This is the same AUGMENT switch noted below.
- **Setup PR already open? → no-op.** Run `gh pr list --label qa-setup --state open`. If any PR is returned → **stop and point the user at it**; do not create a duplicate. The **`qa-setup` label is the source of truth** for "a setup PR exists" — not the branch name, not the title (Phase 5 always applies that label).
  - **Exception — a doctor-failed draft is NOT a completed setup.** A PR that is a **draft also labeled `qa-doctor-failed`** (opened by a headless run whose Phase 3.5 doctor gate failed — see Phase 5) must **not** count as the de-dup target, or a re-run would no-op forever and never fix it. Query with `gh pr list --label qa-setup --state open --json number,isDraft,labels` and ignore entries that are `isDraft` **and** carry `qa-doctor-failed`; continue and update/replace that draft (or surface it for the human to fix).

- Confirm it's a deco.cx ecommerce (not just any deco-deployed app). Need both a deco signal AND an ecommerce signal — see `references/deco-stack-detection.md`. If only deco signals are present without ecommerce shape (no `ProductCard`/`BuyButton`/checkout routes), ABORT — repo is likely internal tooling.
- **Classify the runtime:**
  - `deno.json` AND no `package.json` → **Pure Deno + Fresh**. Use Deno workflow templates + merge tasks into `deno.json`. See `references/deno-fresh-setup.md`.
  - `deno.json` AND `package.json` → **Mixed**. Use default (Node/Bun) wiring via `package.json`.
  - Only `package.json` → **Pure Node/Bun**. Default wiring.
- **Detect existing test frameworks** (Cypress, Playwright, Vitest, Jest): leave them alone — the skill adds `@decocms/qa` alongside. See `references/coexistence-with-existing-tests.md`.
- Detect package manager from lockfile (`bun.lock` / `pnpm-lock.yaml` / `package-lock.json` / `deno.lock`).
- **Capture the engine version to pin:** `npm view @decocms/qa version`. This is the value for `{{ENGINE_VERSION}}` in every template (workflows, deno tasks, the `package.json` devDep). See **Engine version pinning** at the end of Phase 4.
- Detect production URL from `wrangler.toml`/README/env files. If unclear, ask the user via `AskUserQuestion`. **(headless)** No `AskUserQuestion` — rely on auto-detection from `wrangler.toml`/README/env; if the prod URL is still indetectable, **abort with a clear error** ("headless QA setup: could not auto-detect prod URL; re-run interactively or set `.qarc.json` `url`") rather than guessing.
- Check if `.qarc.json` already exists. If yes, switch to AUGMENT mode (skip Phase 4 workflow generation). (See the idempotency pre-check above for the full-setup no-op vs. partial-setup AUGMENT distinction.)
- Check past PRs for deco preview bots (`decobot`/`deco-bot`/`decocms-bot`). If none found in last 10 PRs, the repo may not have automatic previews — ask the user whether to install the PR workflow or only `qa-main.yml`. **(headless)** No `AskUserQuestion` — default to installing **only `qa-main.yml`** (skip the PR-preview workflow) and **record that choice in the PR body** so the reviewer can opt back into the PR workflow.

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

**(headless)** Do not wait for human approval. **Auto-apply the HIGH and MEDIUM confidence markings** and proceed straight to Phase 3. Still build the table — it goes into the PR body so the PR is the human review point (see Phase 5).

If confidence is low for any slug (multiple plausible matches, ambiguous semantics), do NOT auto-edit — leave a `{/* TODO(qa): mark with data-qa-<slug> */}` comment near the most likely candidate and list it for human resolution. **(headless)** Same — do **not** stop on LOW confidence: leave the `{/* TODO(qa): … */}` comment and **list every LOW-confidence slug in the PR body** for the reviewer to resolve. The PR is the gate, not an interactive prompt.

**Validate the click TARGET of navigation slugs — not just the attribute's presence.** Marking `data-qa-category-link` correctly means the *right* link is marked, not merely that *a* link has the attribute. After marking (and before relying on the journey), verify the target for `data-qa-category-link` / `data-qa-product-card`:

- Run `qa doctor --url <preview>` **on the destination page of the FIRST `data-qa-category-link` in DOM order** (the one the engine's `findSelector` will pick — NOT an arbitrary PLP) and confirm that page reports `data-qa-product-card`.
- If the first `[data-qa-category-link]` does **not** land on a PLP, you've hit the generic-nav-component pitfall — the marking is on an institutional/dropdown link. Fix it at the JSX source (gate the attribute on a PLP discriminator); a `.qarc.json` `selectors` override will NOT help. See `references/category-link-disambiguation.md`.
- Browserless heuristic to list what you actually marked and eyeball the first href:
  `curl <preview>/ | grep -oE '<a[^>]*data-qa-category-link[^>]*>'`

### Phase 2.5 — Gotcha sweep + add-to-cart path trace

Before applying attributes, run a **heuristic gotcha sweep** over the Phase 2 candidates. These are agent-driven greps + Reads, **not** a static analyzer — they *flag likely* problems and steer Phase 3 marking, so they have false negatives. The empirical backstop is the Phase 3.5 doctor/journey gate. For each item, record `verdict + file:line evidence + action taken`; the results go into the PR body (REQ-02).

1. **CEP auto-submit (BR stores).** Grep the CEP/shipping component (`cep`, `postalCode`, `ShippingSimulator`, `calcular frete`) and Read it: is the submit/arrow control rendered **conditionally on a "sent" signal** (e.g. `hasSendCEP ? <Clear/> : <Submit/>`, an `onChange → verifyCEP()` that flips state)? If yes, it unmounts after fill and the engine clicks a detached node → 30s timeout. **Action: leave BOTH `data-qa-cep-input` and `data-qa-cep-submit` unmarked** — shipping (journey steps 4 & 7) then skips cleanly. See `references/data-qa-conventions.md` CEP ⚠ block. *(Learning: Osklen.)*
2. **Variant-confirm vs engine version.** Combine the pinned `{{ENGINE_VERSION}}` (Phase 1) with whether the PDP buy button is variant-gated (grep `disabled={!selected…}`, "Selecione um tamanho", disabled-until-variant). Decision: engine **≥ 0.5** → mark `data-qa-variant-option` (every render branch) and do **not** add `data-qa-variant-confirm`; engine **< 0.5** (click-buy-first) or a genuine modal confirm → mark the buy button with BOTH `data-qa-buy-button` + `data-qa-variant-confirm`. **Action: record which case + the version that drove it.** See `references/data-qa-conventions.md` Cases A/B/C. *(Learning: Osklen.)*
3. **Two-level mobile drawer.** Grep the drawer/menu (`MenuButton`, `MobileMenu`, drawer). Are the top-level items submenu **togglers** (a `<button>`/chevron with no `href` that opens a *second* level) rather than PLP `<a href>`? The engine opens only one level → step 2 finds no visible category-link. **Action: mark a top-level leaf category link if one exists; else scope `.qarc.json` to `"viewports": ["desktop"]`** (feeds Phase 4 / REQ-03) and note why. *(Learning: Osklen.)*
4. **`data-qa-minicart-items` dual-state.** Find the minicart component and confirm the line-list wrapper renders in BOTH the empty and filled branches (the empty-cart gate is `wrapperPresent && 0 rows`; absent on the empty state → silent no-op). **Action: if it only renders when items exist, also mark the empty-state container in Phase 3** (or leave a LOW-confidence TODO if the empty branch is ambiguous). See `references/cart-state-gates.md`.

**Trace the real add-to-cart path.** Starting from the element that will carry `data-qa-buy-button`, follow its `onClick`/handler through imports to the actual `useCart().addItems(...)` call, **skipping dead code** (an unused `sdk/useAddToCart.ts` is common; the live path is often `AddToCartButton/common.tsx` → a platform wrapper `AddToCartButton/vtex.tsx`). Record the resolved chain as `file:line → file:line → …` for the PR body; if it can't be fully resolved, log the partial chain + "could not fully trace" — don't fabricate certainty. See `references/cart-state-gates.md`.

**Interactive:** present these four verdicts + the traced path **together with** the Phase 2 mapping table for one combined approval. **(headless)** No approval — the verdicts + trace go straight into the PR body (the PR is the review point).

### Phase 3 — Apply data attributes

Use Edit (not Write) for surgical changes. Preserve indentation, existing props, attribute order. Examples:

- Native HTML: `<button onClick={addToCart}>` → `<button data-qa-buy-button onClick={addToCart}>`
- Local component def: add `data-qa-buy-button` to the root element of `BuyButton.tsx`, ensuring it spreads `{...props}` (add the spread if missing).
- External component callsite: `<Button>Buy</Button>` → `<Button data-qa-buy-button>Buy</Button>`. If `data-*` is filtered: wrap with `<span data-qa-buy-button><Button>Buy</span>`.

Do NOT batch edits via Write — every change must be a targeted Edit with surrounding context preserved.

### Phase 3.5 — Doctor CORE-marker gate (setup-time, best-effort)

Goal: catch a missing/mis-placed CORE marker **now**, before opening a PR that looks green but reds in CI (REQ-01). The CORE markers are the 8 listed under **CORE markers** in "Canonical data-qa attributes" above.

**`qa doctor` is a single-page reporter** — `Open the URL and report which data-qa-* slugs are present`. It prints `✓ data-qa-<slug> — count=N …` / `✗ data-qa-<slug> — missing` for the page you give it and **always exits 0** (it never fails on its own). So on the homepage it only sees the entry-page markers (`category-link`, `cart-icon`, often `minicart`); the deeper CORE markers (`product-card`, `pdp-title`, `buy-button`, `minicart-checkout`, `checkout-page`) are validated by the **journey**, which walks the flow and exits non-zero on a missing/mis-marked marker. Use both: doctor for a fast static read, the journey for the end-to-end verdict.

1. **Decide local-boot feasibility** (per `references/ci-local-boot.md`): the decofile must be committed at `.deco/blocks/` (not gitignored) and the repo buildable. If infeasible — no committed decofile, Cloudflare-only preview, a Node/Bun repo with no local preview, or boot times out — **skip cleanly**: record `doctor: deferred-to-CI (reason: <…>)` for the PR body and proceed. The workflow doctor pre-step + journey are then the gate. (Holds in both modes.)
2. **If feasible**, boot locally (pre-warm `deno cache dev.ts main.ts`, then `deno task build` → `deno task preview &`, poll `:8000`) and run:
   - `qa doctor --url http://localhost:8000` — capture the homepage marker table for the PR body.
   - **`qa journey --url http://localhost:8000`** — the real end-to-end CORE gate. If the full journey can't complete locally (cross-origin VTEX checkout, or a `checkoutUrlPattern` that only matches the real domain), fall back to **`qa journey --url http://localhost:8000 --smoke`** (steps 1,2,3,5 — home → PLP → PDP → add-to-cart) and note in the PR body that minicart/checkout were not exercised locally.
   - Build a CORE-marker results table: slug → present / missing / satisfied-by-feature → where checked (doctor page or journey step).
3. **Fail condition** — a CORE marker missing (and not feature-satisfied), or the journey reds on a CORE step:
   - **Interactive:** STOP. Report the missing marker(s) + the offending page/step, loop back to Phase 3 to fix the JSX, and re-run this gate. **Do not proceed to Phase 5.**
   - **(headless):** proceed to Phase 5 but open a **DRAFT PR flagged as failing** (see Phase 5) with the doctor/journey results at the top of the body — never a normal green-looking PR.

### Phase 4 — Scaffold config + workflows

Skip this phase entirely in AUGMENT mode. Pick template variants based on the runtime classification from Phase 1.

**Common to all runtimes:**
- **`.qarc.json` (root) — scaffold platform-aware, don't ship it empty (REQ-03).** Always set `url`, `cep` (`01310-100` default), and `viewports` `["desktop","mobile"]`. Then populate `features` / `viewports` from detection, **logging each choice + a one-line rationale in the PR body**:
  - **Checkout shape — probe first:** `curl -sL -o /dev/null -w '%{url_effective} %{num_redirects}' <prod>/checkout`. Same-origin (0 redirects, e.g. VTEX served at `/checkout`) → `features.checkoutUrlPattern: "**/checkout**"` (the store has no checkout DOM of its own to mark — don't rely on a `data-qa-checkout-page` you don't own). Cross-origin redirect → `features.checkoutCrossOrigin: true`. A deco-native checkout the store *does* own → keep `data-qa-checkout-page`, leave checkout features empty. Either checkout feature satisfies the CORE `data-qa-checkout-page` for the Phase 3.5 gate. See `references/checkout-quirks.md` Pattern 2.
  - **Blocking overlay/popup** (newsletter / cookie / age-gate / geolocation) detected in Phase 2 but with no clean ✕ to mark → `features.dismissOverlaysHeuristic: true` (prefer marking `data-qa-dismiss`; the heuristic is the documented fallback).
  - **Two-level mobile drawer with no top-level leaf link** (Phase 2.5 gotcha 3) → `"viewports": ["desktop"]`.
  Leave `selectors` empty unless a documented override applies (`references/checkout-quirks.md`).
- **`.qarc.json` is only read if the repo is checked out (it loads from `process.cwd()`).** The engine reads config from `join(process.cwd(), ".qarc.json")`. **Without an `actions/checkout` step the file does not exist on the runner**, so ALL config (`features.checkoutUrlPattern`, `viewports`, `selectors`) is **silently ignored** — the journey runs with only `--url` + defaults. The shipped templates already check out the repo; this warning matters for anyone writing a simplified **manual** workflow. Typical symptom: `data-qa-checkout-page missing` even though you set `checkoutUrlPattern`. (See `references/decobot-preview-parsing.md`.)
- `.gitignore`: append `qa-output/`.
- **Doctor CORE-marker pre-step (REQ-01 durable gate).** All four workflow templates run `qa doctor --url "$TARGET_URL"` **before** the journey and fail fast with a precise message if an **entry-page** CORE marker (`data-qa-category-link` or `data-qa-cart-icon`) is missing on the resolved target. `qa doctor` is single-page and **always exits 0**, so the step parses its `✓ … count=N` / `✗ … — missing` output and `exit 1`s itself; the journey step still gates the deeper markers (`product-card`, `pdp-title`, `buy-button`, `minicart-checkout`, `checkout-page`). This turns the most common setup failure — a missing/mis-marked category link, which otherwise reds cryptically at journey step 2 — into an early, named failure. Don't strip this step.
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
- **PR body — additive sections (REQ-01/02/03), in both modes.** Beyond the items above, include: (a) **Doctor CORE-marker results** — the 8-slug table from Phase 3.5, headed with its source (`setup-time local boot` vs `deferred-to-CI — local boot infeasible: <reason>`; add the `--smoke`-only caveat if minicart/checkout weren't exercised locally); (b) **Gotcha findings** — the four Phase 2.5 verdicts as `verdict + file:line + action taken`; (c) **Traced add-to-cart path** — the resolved `file:line → … → useCart().addItems(...)` chain (+ any dead file skipped); (d) **`.qarc.json` features chosen + rationale** — each populated `features` / `viewports` entry with its one-line cause.
- **Always apply the `qa-setup` label to the PR.** It is the source of truth the Phase 1 idempotency pre-check reads (`gh pr list --label qa-setup --state open`) — the branch name and title are not. A PR without this label will not de-duplicate against a future run.
- **STOP before `git push` and `gh pr create`. Ask the user to confirm.** Modifying source code + opening a PR has high blast radius. Never auto-push. **A standing "don't ask, just ship it" / "I trust you, open the PR" does NOT authorize the push** — under time pressure especially, still show the diff + the PR body and get an explicit yes for *this* push. (Local commits on the `chore/setup-qa` branch are fine; the gate is the push/PR.) **This confirmation gate applies in `interactive` mode only.**

**(headless) — push + PR are authorized by the mode itself.** The onboarding/CI flow set `QA_SETUP_MODE=headless` *to* run setup end-to-end, and the **PR is the human gate** — so no interactive confirmation. (The Phase 1 idempotency pre-check has already guaranteed this isn't a duplicate.) Run exactly this sequence:

1. **Branch.** Use `chore/setup-qa`. If the remote branch already exists (`git ls-remote --exit-code --heads origin chore/setup-qa`), append a unique suffix from the commit: `chore/setup-qa-<shorthash>` (`git rev-parse --short HEAD`).
2. **Commit** with the message above.
3. **Ensure the label exists** (idempotent — ignore "already exists"):
   `gh label create qa-setup --color 0E8A16 --description "QA setup PR" || true`
4. **Push + open the PR with the label:**
   `gh pr create --label qa-setup --title "chore(qa): set up E2E suite with data-qa attributes" --body "<body>"`
   where `<body>` = the Phase 2 mapping table + list of modified files + `bun run qa:local` debug instructions + engine-docs link + the **additive sections** (Doctor CORE-marker results, the four Gotcha findings, the traced add-to-cart path, the `.qarc.json` features + rationale) + (if any) the **LOW-confidence TODO list** from Phase 2 and the **decobot-absent → `qa-main.yml`-only** note from Phase 1.

**(headless) — if the Phase 3.5 doctor gate FAILED** (a CORE marker missing on a feasible local boot): still run steps 1–3, but in step 4 open the PR as a **flagged-failing draft** instead of a normal PR. Add a second label and the `--draft` flag, and put the doctor/journey results at the TOP of the body:
   - `gh label create qa-doctor-failed --color B60205 --description "QA setup blocked: CORE marker missing" || true`
   - `gh pr create --draft --label qa-setup --label qa-doctor-failed --title "[QA SETUP — DOCTOR FAILED] chore(qa): set up E2E suite with data-qa attributes" --body "<doctor/journey results first, then the normal body>"`

   This surfaces the broken setup for a human without shipping a green-looking PR, and the Phase 1 **doctor-failed draft exception** keeps a re-run from treating it as a completed setup.

### Phase 6 — Verify

Apply `superpowers:verification-before-completion`: do not declare success without observing the workflow run green.

- After PR is open: `gh pr checks --watch`.
- If checks pass: report JUnit link + success. Done.
- If checks fail: apply `superpowers:systematic-debugging`. Read `gh run view --log-failed`. Most common cause: missing or mis-marked `data-qa-*`. Identify which step of the journey failed, locate the missing element, edit + commit a fix. Do NOT patch in CI logs without re-reading the failing JSX.

## Common mistakes

- **Auto-editing without showing the Phase 2 table to the user.** Always confirm before editing — JSX changes are PR-visible. *(Interactive only; in `headless` mode auto-editing HIGH/MEDIUM is intended and the PR is the review point — see the Phase 2 **(headless)** note.)*
- **Using Write instead of Edit.** Write loses surrounding context. Always Edit.
- **Marking PLP product card's buy button with `data-qa-buy-button`.** That's a quick-add on the card, not the PDP CTA. Distinguish: `data-qa-buy-button` is PDP-only.
- **Over-marking a generic nav-item component as `data-qa-category-link`.** When the header renders institutional links, dropdown triggers AND category links through one component (e.g. `NavItem.tsx`) with identical markup, marking the generic anchor tags ALL of them. `findSelector` picks the **first `[data-qa-category-link]` in DOM order** — usually the institutional one → a product-less page → `enter-pdp` fails with `data-qa-product-card missing` (a misleading symptom; the real cause is the category link). A `.qarc.json` `selectors` override does **not** fix it — `findSelector` tries the raw `[data-qa-*]` first and only falls back to `selectors[slug]` when the attribute exists nowhere; since it exists (on several links) the override is ignored. **Fix at the JSX source**: gate the attribute so only real PLP links get it (discriminator is store-specific, e.g. `href?.includes("sort=")`). See `references/category-link-disambiguation.md`. *(Learning: aviator.)*
- **Assuming external components forward `data-*`.** Verify by reading typings or testing in browser. If unsure, wrap.
- **Variant-gated buy button → empty cart → "minicart-checkout not found" (engine-version-dependent).** The right marking depends on the engine's add-to-cart order, so check the version:
  - **Engine ≥ 0.5 (the common case):** the buy step **pre-selects the variant first** — it finds `data-qa-variant-option`, clicks an in-stock size, and only then clicks an already-enabled `data-qa-buy-button`. Marking the size options (in-stock only, every render branch) is **sufficient**; `data-qa-variant-confirm` is **not** required here.
  - **Older click-buy-first order (and genuine modal "confirm" flows):** the engine clicked `data-qa-buy-button` first, while still disabled → no-op → never re-clicked. There, mark the buy button with BOTH `data-qa-buy-button` and `data-qa-variant-confirm` (it doubles as the post-variant confirm). Don't misdiagnose the empty cart as a VTEX/localhost issue — it adds to cart fine locally once variant-confirm is set. *(Learning: Osklen.)*
  - See `data-qa-conventions.md` for the version-tagged step order and `references/checkout-quirks.md` Pattern 6.
- **Assuming a green journey means the cart actually filled.** Historically the journey asserted *clicks*, NOT *cart state* — so an emptied/wrong-quantity/wrong-price cart passed green. The pinned engine (≥ 0.5.x) asserts cart state natively: mark the cart-state slugs (`data-qa-minicart-item*` etc.) and the journey fails the verdict on a broken cart. No companion scripts — just the markers (see `references/cart-state-gates.md`).
- **Editing the wrong add-to-cart file (dead code).** Before assuming a file matters, grep for imports and trace what `data-qa-buy-button` actually executes. A `sdk/useAddToCart.ts` is often dead code; the real path is usually a local hook in `AddToCartButton/common.tsx` whose `onAddItem` comes from a platform wrapper (`AddToCartButton/vtex.tsx`) where the real `useCart().addItems({ quantity })` lives. A "break" in the dead file is a no-op — and proves nothing about the tests.
- **Two-level mobile drawer.** If the mobile drawer's top-level items open submenus instead of linking to PLPs, step 2 can't find a category link (engine opens only one level) — scope `.qarc.json` to `"viewports": ["desktop"]`.
- **Wrong checkout mode.** Run `curl -sL -o /dev/null -w '%{url_effective} %{num_redirects}' STORE.com/checkout` first: same-origin (0 redirects, VTEX served at `/checkout`) → the store has **no DOM of its own to mark**, so the clean default is `features.checkoutUrlPattern: "**/checkout**"` (don't try to mark a marker that isn't yours); a `selectors["data-qa-checkout-page"]="#checkoutMainContainer"` is the documented alternative when you'd rather assert VTEX's stable DOM hook. Cross-origin redirect → `features.checkoutCrossOrigin: true`. (See `checkout-quirks.md` Pattern 2.) Note: a `/checkout?orderFormId=test` returning 403 *outside* the journey is normal (no session/orderForm) — inside the journey, with a real cart, the URL matches the pattern.
- **A restricted `permissions:` block silently breaks `actions/checkout`.** GitHub Actions grants full default scopes only when *no* `permissions:` block exists; declaring one drops every scope not listed. So a block like `permissions: { pull-requests: read }` removes the default `contents: read` and checkout fails with `repository not found` (git exit 128). Always declare `contents: read` plus the scopes each job actually needs (PR workflow: `pull-requests: read` for comment polling + `checks: write` for the test report; main workflow: `statuses: read` for the prod-status poll + `checks: write`). The shipped templates already declare these.
- **Preview returns 403 / bot-challenge in CI.** If the deco preview (or prod) sits behind Cloudflare Bot Management, the journey from a CI-runner IP gets an interstitial/403 instead of the store. Fix (default): engine ≥ 0.5.0 sends a `deco-qa-bot/1.0` User-Agent token — add a **one-time** Cloudflare WAF carve-out for it (`and not http.user_agent contains "deco-qa-bot"`, scoped to `*.decocdn.com`); surgical, and works for every deco store from a single zone rule. See `references/cloudflare-bot-allowlist.md`. Don't fight it with spoofed headers. No zone access? Fall back to booting the storefront in CI and testing localhost (`references/ci-local-boot.md`). *(Learning: technos — the UA carve-out; Osklen earlier used the local-boot fallback.)*
- **QA-main racing the prod publish.** On deco, a push to `main` only *triggers* the prod build/deploy (async, off Actions, minutes). If QA-main runs the journey on `push` immediately, it tests the *previous* prod and reports a false `data-qa-*`-missing failure (the markers exist in the just-merged code but aren't live yet). The `qa-main.yml` template already gates on the deco prod **commit status** (`Deco / <site> / prod` → `success`) before running — don't strip that step. *(Learning: technos #333 — first QA-main push failed at `navigate-plp` because prod hadn't republished yet.)*
- **Verify locally before the PR.** A warm `deno task start` + `deno task qa:run --url http://localhost:8000` reproduces the whole journey (and catches all of the above) without waiting on CI.
- **Declaring success because the PR opened.** Phase 6 is mandatory — workflow must run green.
- **Trusting a green journey without the doctor gate.** A journey can pass mechanically while a CORE marker is absent or mis-placed (gated steps silently skip). The Phase 3.5 setup-time gate and the workflow `qa doctor` pre-step exist so a missing CORE marker reds early with a *named* marker instead of a cryptic mid-journey `SelectorNotFoundError` — don't strip the doctor pre-step from the workflow templates.

## References

- `references/data-qa-conventions.md` — full canonical attribute list with placement guidance.
- `references/category-link-disambiguation.md` — the generic-nav-component pitfall: why over-marking `data-qa-category-link` makes the engine click the wrong (first-in-DOM) link, why a `selectors` override can't fix it, and the JSX discriminator fix.
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
