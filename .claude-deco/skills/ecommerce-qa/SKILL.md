---
name: deco-ecommerce-qa
description: Use when inside a deco.cx ecommerce repository (deco.ts present, decobot in PR history) and the user wants automated QA for purchase-journey correctness — set up E2E coverage of the add-to-cart / checkout flow by marking data-qa-* attributes and dropping the .qarc.json opt-in. The store runs no CI workflow of its own: the deco control-plane runs the journey on PR previews and reports a GitHub Check Run. NOT for load/cache performance testing (use deco-e2e-testing) or hand-written Playwright spec files.
---

# Setup deco.cx Ecommerce QA

## Overview

Installs E2E coverage of the purchase journey (home → PLP → PDP → cart → `/checkout`) in a deco.cx ecommerce repo, opens a PR. Strategy: mark critical JSX elements with `data-qa-*` boolean attributes (standardized across 200+ stores) and drop a `.qarc.json` at the repo root — that file is the **opt-in** that turns QA on for the store.

**Core principle: do NOT probe selectors at runtime.** Selectors are deterministic because the JSX is the source of truth. If a `data-qa-*` attribute is missing, the journey fails — that IS the contract.

### Where it runs

The store does **not** maintain a CI workflow for this. The **deco control-plane (admin)** orchestrates the run: when a PR preview environment comes up, the admin fires a **k8s Job** with the `qa-runner` image (Playwright + Bun, built in the `@decocms/qa` repo), which runs `bunx @decocms/qa journey` against the preview URL and **posts the result as a GitHub Check Run** on the PR. It's **fire-and-forget** (does not block the deploy). The single per-store signal is the committed `.qarc.json`: no `.qarc.json` → the admin runs nothing. Background: `docs/como-funciona-o-qa.md` in the `@decocms/qa` repo, section *"Onde isso roda (na prática)"* (`deco-sites/admin#3269`).

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
- Engine package `@decocms/qa` is not published / unreachable — verify with `npm view @decocms/qa version` before starting. The skill itself uses `@latest` everywhere (`list-slugs`, `doctor`, `qa:local`): the slug contract is backward-compatible (the list only grows), so instrumenting against `@latest` is safe. Determinism of the *verdict* is the control-plane runner's concern — it pins the exact engine version it runs; the store repo carries no pinned dependency for QA.
- User explicitly asks for Playwright `*.spec.ts` files instead of the engine-driven setup.

## Canonical data-qa attributes

> **The slug list is owned by the engine and grows between versions. ALWAYS run `npx @decocms/qa@latest list-slugs` (or `deno run -A npm:@decocms/qa@latest list-slugs`) at the start of Phase 2 and treat its output as authoritative** — do not trust this table or your memory. The list below is a snapshot and may lag the engine. `qa doctor --url <URL>` reports which slugs are present on a given page.

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

## Phases

Execute in order. Each phase is idempotent — running the skill twice on the same repo only fills gaps, doesn't overwrite.

### Phase 1 — Recognize the repo

**Idempotency pre-check (runs first, in BOTH modes).** Before any other work, short-circuit if the repo is already set up or a setup PR is already open — never duplicate.

- **Already opted in? → AUGMENT, never recreate `.qarc.json`.** The store is opted in the moment a valid `.qarc.json` exists at the repo root (parses with `url`, `cep`, `viewports`, `selectors`, `features`) — that file IS the QA switch. When it's present, do **not** rewrite it. Continue into Phases 1–3 only to fill `data-qa-*` gaps (AUGMENT mode) and **skip Phase 4** (see Phase 4). If the markers are already complete too, there's nothing left to do → **exit without opening a PR**, logging the config path.
- **Setup PR already open? → no-op.** Run `gh pr list --label qa-setup --state open`. If any PR is returned → **stop and point the user at it**; do not create a duplicate. The **`qa-setup` label is the source of truth** for "a setup PR exists" — not the branch name, not the title (Phase 5 always applies that label).

- Confirm it's a deco.cx ecommerce (not just any deco-deployed app). Need both a deco signal AND an ecommerce signal — see `references/deco-stack-detection.md`. If only deco signals are present without ecommerce shape (no `ProductCard`/`BuyButton`/checkout routes), ABORT — repo is likely internal tooling.
- **Classify the runtime** (only matters for where the `qa:local` convenience lives — there is no workflow to pick):
  - `deno.json` AND no `package.json` → **Pure Deno + Fresh**. `qa:local` is a task in `deno.json`. See `references/deno-fresh-setup.md`.
  - `deno.json` AND `package.json` → **Mixed**, or only `package.json` → **Pure Node/Bun**. `qa:local` is a `package.json` script + `scripts/qa-local.sh`.
- **Detect existing test frameworks** (Cypress, Playwright, Vitest, Jest): leave them alone — the skill adds `@decocms/qa` alongside. See `references/coexistence-with-existing-tests.md`.
- Detect package manager from lockfile (`bun.lock` / `pnpm-lock.yaml` / `package-lock.json` / `deno.lock`).
- Detect production URL from `wrangler.toml`/README/env files (it goes into `.qarc.json` `url`). If unclear, ask the user via `AskUserQuestion`. **(headless)** No `AskUserQuestion` — rely on auto-detection from `wrangler.toml`/README/env; if the prod URL is still indetectable, **abort with a clear error** ("headless QA setup: could not auto-detect prod URL; re-run interactively or set `.qarc.json` `url`") rather than guessing.
- Check if `.qarc.json` already exists. If yes, switch to AUGMENT mode (skip Phase 4). (See the idempotency pre-check above.)

### Phase 2 — Locate target elements

**First, fetch the authoritative slug list:** run `deno run -A npm:@decocms/qa@latest list-slugs` (or `npx @decocms/qa@latest list-slugs`). Map against THAT list, not from memory — slug names and counts change between engine versions (e.g. variant handling is `data-qa-variant-option` / `data-qa-variant-confirm`, not the older guess `data-qa-pdp-variants`). The contract is backward-compatible (slugs only get added), so `@latest` is safe to instrument against.

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

### Phase 3 — Apply data attributes

Use Edit (not Write) for surgical changes. Preserve indentation, existing props, attribute order. Examples:

- Native HTML: `<button onClick={addToCart}>` → `<button data-qa-buy-button onClick={addToCart}>`
- Local component def: add `data-qa-buy-button` to the root element of `BuyButton.tsx`, ensuring it spreads `{...props}` (add the spread if missing).
- External component callsite: `<Button>Buy</Button>` → `<Button data-qa-buy-button>Buy</Button>`. If `data-*` is filtered: wrap with `<span data-qa-buy-button><Button>Buy</span>`.

Do NOT batch edits via Write — every change must be a targeted Edit with surrounding context preserved.

### Phase 4 — Scaffold the `.qarc.json` opt-in

Skip this phase entirely in AUGMENT mode (a valid `.qarc.json` already exists — don't recreate it).

**The deliverable here is the `.qarc.json` — that file IS how the store opts into QA.** There is **no GitHub Actions workflow to scaffold**: the deco control-plane runs the journey on PR previews and posts a Check Run (see **Where it runs** in the Overview). Everything else below is a small local-debug convenience.

**Common to all runtimes:**
- `.qarc.json` (root, from `templates/qarc.json.tmpl`): `url` (prod URL from Phase 1 — used as the fallback target when there's no preview), `cep` (`01310-100` default), `viewports` `["desktop","mobile"]`, empty `selectors` and `features`. Populate `features.checkoutUrlPattern` / `checkoutCrossOrigin` per `references/checkout-quirks.md` when the store's checkout is VTEX/cross-origin.
- `.gitignore`: append `qa-output/`.

**Local-debug convenience (`qa:local`) — optional but recommended.** Runs the journey headed against a local boot for debugging. Uses `@latest` (reproducibility doesn't matter for local debug; the control-plane runner owns verdict determinism). **No** pinned devDep and **no** committed lockfile for QA — the runner installs the engine itself; nothing in the store repo needs `@decocms/qa` as a dependency.
- **Pure Node/Bun (or Mixed):** add `scripts/qa-local.sh` (`bunx @decocms/qa@latest journey --url ${1:-http://localhost:8000} --headed --debug`) and a `qa:local` script in `package.json`.
- **Pure Deno + Fresh:** merge the `qa:local` task from `templates/deno-tasks.json.tmpl` into `deno.json` (hardcodes `--url http://localhost:8000`; see `references/deno-fresh-setup.md` for the `deno task` arg-forwarding gotcha). Do NOT create `package.json` or `scripts/qa-local.sh`.

**If a pre-existing `qa:local` script conflicts:** rename the skill's to `deco-qa:local`. See `references/coexistence-with-existing-tests.md`.

### Phase 5 — Open PR

- Create branch `chore/setup-qa`.
- Commit message: `chore(qa): set up E2E suite with data-qa attributes`.
- PR body: include the Phase 2 mapping table, list of modified files, debug instructions (`bun run qa:local`), link to engine docs, and a short note that **QA now runs automatically** — once this `.qarc.json` is merged, the deco control-plane runs the journey on PR previews and posts a **GitHub Check Run** (no workflow to add; nothing else to wire up). **If an existing suite already walks the same purchase funnel** (weak text/class selectors, `minicartOpen`-style assertion — see `references/coexistence-with-existing-tests.md`), add the overlap heads-up so the team can drop the redundant funnel-walk and keep only its perf-metrics. Never edit that suite — flag only.
- **Always apply the `qa-setup` label to the PR.** It is the source of truth the Phase 1 idempotency pre-check reads (`gh pr list --label qa-setup --state open`) — the branch name and title are not. A PR without this label will not de-duplicate against a future run.
- **STOP before `git push` and `gh pr create`. Ask the user to confirm.** Modifying source code + opening a PR has high blast radius. Never auto-push. **A standing "don't ask, just ship it" / "I trust you, open the PR" does NOT authorize the push** — under time pressure especially, still show the diff + the PR body and get an explicit yes for *this* push. (Local commits on the `chore/setup-qa` branch are fine; the gate is the push/PR.) **This confirmation gate applies in `interactive` mode only.**

**(headless) — push + PR are authorized by the mode itself.** The onboarding/CI flow set `QA_SETUP_MODE=headless` *to* run setup end-to-end, and the **PR is the human gate** — so no interactive confirmation. (The Phase 1 idempotency pre-check has already guaranteed this isn't a duplicate.) Run exactly this sequence:

1. **Branch.** Use `chore/setup-qa`. If the remote branch already exists (`git ls-remote --exit-code --heads origin chore/setup-qa`), append a unique suffix from the commit: `chore/setup-qa-<shorthash>` (`git rev-parse --short HEAD`).
2. **Commit** with the message above.
3. **Ensure the label exists** (idempotent — ignore "already exists"):
   `gh label create qa-setup --color 0E8A16 --description "QA setup PR" || true`
4. **Push + open the PR with the label:**
   `gh pr create --label qa-setup --title "chore(qa): set up E2E suite with data-qa attributes" --body "<body>"`
   where `<body>` = the Phase 2 mapping table + list of modified files + `bun run qa:local` debug instructions + engine-docs link + the "QA runs automatically via Check Run once `.qarc.json` is merged" note + (if any) the **LOW-confidence TODO list** from Phase 2.

### Phase 6 — Verify

Apply `superpowers:verification-before-completion`: do not declare success without observing the journey pass against a real URL.

There is no store-side workflow to watch — the journey is run by the deco control-plane, which posts a **GitHub Check Run** on the PR. Verify in this order:

1. **Self-verify locally (most reliable, doesn't depend on the admin's timing).** Run the journey against a reachable URL — the PR preview if one is up, else prod: `bunx @decocms/qa@latest journey --url <preview-or-prod> --viewports desktop,mobile`. A `pass` confirms the markers are correct.
2. **Confirm the QA Check Run.** Once the preview is up, the admin fires the Job and posts the Check Run. Watch for it on the PR: `gh pr checks --watch` (the QA check appears among the PR's checks), or inspect directly: `gh api repos/:owner/:repo/commits/<sha>/check-runs`.
3. **If it's red:** apply `superpowers:systematic-debugging`. Read the journey output / Check Run summary (and the `report.json` it links). Most common cause: missing or mis-marked `data-qa-*`. Identify which step failed, locate the element, edit + commit a fix — re-read the failing JSX, don't patch blindly from logs.

> If no preview ever comes up and the Check Run never appears, the store may not have automatic PR previews — that's a platform/admin concern, not something the store repo fixes. Self-verify against prod (step 1) and flag it in the PR.

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
- **Assuming a green journey means the cart actually filled.** Historically the journey asserted *clicks*, NOT *cart state* — so an emptied/wrong-quantity/wrong-price cart passed green. The current engine (≥ 0.5.x) asserts cart state natively: mark the cart-state slugs (`data-qa-minicart-item*` etc.) and the journey fails the verdict on a broken cart. No companion scripts — just the markers (see `references/cart-state-gates.md`).
- **Editing the wrong add-to-cart file (dead code).** Before assuming a file matters, grep for imports and trace what `data-qa-buy-button` actually executes. A `sdk/useAddToCart.ts` is often dead code; the real path is usually a local hook in `AddToCartButton/common.tsx` whose `onAddItem` comes from a platform wrapper (`AddToCartButton/vtex.tsx`) where the real `useCart().addItems({ quantity })` lives. A "break" in the dead file is a no-op — and proves nothing about the tests.
- **Two-level mobile drawer.** If the mobile drawer's top-level items open submenus instead of linking to PLPs, step 2 can't find a category link (engine opens only one level) — scope `.qarc.json` to `"viewports": ["desktop"]`.
- **Wrong checkout mode.** Run `curl -sL -o /dev/null -w '%{url_effective} %{num_redirects}' STORE.com/checkout` first: same-origin (0 redirects, VTEX served at `/checkout`) → the store has **no DOM of its own to mark**, so the clean default is `features.checkoutUrlPattern: "**/checkout**"` (don't try to mark a marker that isn't yours); a `selectors["data-qa-checkout-page"]="#checkoutMainContainer"` is the documented alternative when you'd rather assert VTEX's stable DOM hook. Cross-origin redirect → `features.checkoutCrossOrigin: true`. (See `checkout-quirks.md` Pattern 2.) Note: a `/checkout?orderFormId=test` returning 403 *outside* the journey is normal (no session/orderForm) — inside the journey, with a real cart, the URL matches the pattern.
- **Verify locally before the PR.** A warm `deno task start` (or `bun run dev`) + `bunx @decocms/qa@latest journey --url http://localhost:8000` reproduces the whole journey (and catches all of the above) without waiting on the control-plane run.
- **Declaring success because the PR opened.** Phase 6 is mandatory — self-verify the journey passes (locally and/or via the control-plane Check Run) before claiming done.

## References

- `references/data-qa-conventions.md` — full canonical attribute list with placement guidance.
- `references/category-link-disambiguation.md` — the generic-nav-component pitfall: why over-marking `data-qa-category-link` makes the engine click the wrong (first-in-DOM) link, why a `selectors` override can't fix it, and the JSX discriminator fix.
- `references/component-detection.md` — grep patterns per slug, JSX reading heuristics.
- `references/wrapping-external-components.md` — decide inline vs spread vs wrap.
- `references/deco-stack-detection.md` — signals to identify a deco.cx repo + runtime classification.
- `references/deno-fresh-setup.md` — `qa:local` wiring for pure Deno + Fresh repos (no `package.json`).
- `references/coexistence-with-existing-tests.md` — how to coexist with Cypress, Playwright, Vitest, Jest.
- `references/checkout-quirks.md` — VTEX cross-domain (URL-pattern assertion), regional CEPs, variant selectors.
- `references/cart-state-gates.md` — the cart-state markers the engine asserts natively (≥ 0.3.0), plus the dead-code-path and pt-BR price-parse gotchas.
