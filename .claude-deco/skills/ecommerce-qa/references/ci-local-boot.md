# CI: build & boot the storefront locally (FALLBACK)

> **This is the fallback, not the default.** The default fix for a Cloudflare-gated preview is the `deco-qa-bot` UA carve-out (engine ≥ 0.5.0 + a one-time zone WAF rule) — see `cloudflare-bot-allowlist.md`. The shipped templates (`qa-pr-deno.yml.tmpl` / `qa-main-deno.yml.tmpl`) poll the decobot preview link. Use the local-boot variant below **only when you can't add the Cloudflare carve-out** (no access to the zone serving `*.decocdn.com`).

## TL;DR

When the preview can't be allowlisted, the PR/main workflows can instead **build the storefront and boot it on `http://localhost:8000` inside the CI job**, then run the `@decocms/qa` journey against localhost — no `*.decocdn.com` fetch, so Cloudflare never sees the request.

## Why not the deco preview link

The decobot preview (`https://envs-<site>--<hash>.decocdn.com`) sits behind **Cloudflare Bot Management**. From a CI runner (datacenter IP) driving headless Chromium, Cloudflare serves a challenge / `403` page, so Playwright's `page.goto(..., waitUntil: "load")` never fires `load` and **times out (~30s)** — step 1 (`visit-home`) fails with `ok=0` and the whole run reds.

Gotchas that make this confusing:
- The decobot comment can say **"✅ Ready"** while the URL is actually unreachable from CI (a `curl` from the runner returns `403`).
- It's intermittent by origin: the preview often loads fine from a developer laptop (residential IP) but fails from CI (datacenter IP) — so "works on my machine" doesn't predict CI.
- There's **no engine flag** (timeout/auth) that fixes it, and warm-up / retry / "skip when unreachable" are band-aids, not fixes.

Booting locally also tests the **PR's actual code** (the branch build) instead of an external deploy, and removes the flaky dependency on preview lifecycle/expiry.

> Provenance: discovered across deco stores (osklenbr documented it first; technos hit the same recurring red). **technos was ultimately fixed with the `deco-qa-bot` UA carve-out (`cloudflare-bot-allowlist.md`), which is now the default** — local-boot stays as the fallback for stores whose preview zone you can't allowlist.

## How (the local-boot variant)

Start from the default preview-link templates and swap the "Wait for deco preview" + "Resolve target URL" steps for build+boot steps (`qa-pr-deno.yml.tmpl` / `qa-main-deno.yml.tmpl` shipped as preview-link — this is a hand-modification):
1. **Install Playwright Chromium** matching the engine's bundled version (derived from `npm view @decocms/qa@latest dependencies.playwright`) — CI runners ship no browser and Deno won't auto-install one.
2. **Resolve target URL**: default `http://localhost:8000` (`boot=true`); a `workflow_dispatch.url` input overrides (`boot=false`) to hit any reachable URL (prod smoke test, or a preview from a residential runner). Passed via `env:` (never inline `${{ }}` in the shell).
3. **Build storefront** (if boot): `DECO_SITE_NAME={{SITE_NAME}} deno task build`.
4. **Boot storefront** (if boot): `deno task preview &`, then poll `:8000` until it answers (warm `{{PLP_PATH}}` so that route is compiled), `exit 0`.
5. **Run purchase journey**: `deno task qa:run --url <target>`.

### Don't use `deno task start` or `deno task dev` in CI
- **`start`** imports `https://deco.cx/run` → Cloudflare `403`s it from the runner IP.
- **`dev`** compiles islands on demand → the browser's first `page.goto(waitUntil: load)` can exceed the engine's hardcoded 30s budget on a 2‑vCPU runner.
- **`build`** precompiles everything from the committed `.deco/blocks` decofile (no deco.cx fetch); **`preview`** (`main.ts`) serves the snapshot fast on `:8000`.

## Prerequisite: committed decofile

`deno task build` needs the **decofile committed at `.deco/blocks/`** to render pages offline. Most deco repos commit it (`.gitignore` typically only ignores `.deco/metadata/`). If `.deco/blocks/` is absent or gitignored, the local build can't render real pages → the journey fails. In that case, fall back to `workflow_dispatch.url` against a reachable preview/prod, or commit the decofile.

## Cold builds: pre-warm the module cache (the real fix)

deco's per-island build **re-resolves the shared runtime from the network for every island**. On a cold cache that means the same ~dozen modules (htmx `Renderer.tsx` / `Bindings.tsx`, `LiveControls.tsx`, `@std/path`, …) get fetched **hundreds of times** — observed on technos: **935 downloads for only 17 unique URLs**, which ran ~20 min and timed the job out *before it even started compiling*. A warm cache collapses this (a warm build fetches a handful; technos's build after warming = **~20s**).

**Fix — pre-warm in ONE resolution pass, then build:**

```sh
deno cache dev.ts main.ts   # each module fetched exactly once
deno task build             # now hits the warm cache → seconds, not minutes
```

The templates do exactly this in the Build step. Two supporting speed-ups:
- **`actions/cache@v4`** on `~/.cache/deno` + `node_modules` (keyed on `hashFiles('deno.json')`, `restore-keys: deno-${{ runner.os }}-`) so the one-time fetch is reused across runs.
- `timeout-minutes: 20` is plenty once pre-warmed (prewarm fetch + ~20s build + boot + journey).

> Diagnosing this: compare `grep -c "Download " <build-log>` against the count of *unique* URLs. If total ≫ unique, you're in the re-fetch loop — pre-warm fixes it. (A bigger store like osklen built fine while a smaller technos looped, so it's not about size.)

## Background processes survive across steps

The `preview &` started in the **Boot storefront** step keeps running into the **Run purchase journey** step — GitHub Actions does not reap backgrounded processes between steps. The boot step `exit 0`s as soon as `:8000` responds; a `Dump storefront log on failure` step tails `/tmp/storefront.log` for diagnosis.

## Verify locally with CI parity

Reproduce the exact CI path before pushing:

```sh
DECO_SITE_NAME=<site> deno task build
DECO_SITE_NAME=<site> deno task preview &   # serves :8000
deno run -A npm:@decocms/qa@latest journey --url http://localhost:8000
```

(`deno task start` also works locally from a laptop, but it's NOT what CI runs — build+preview is the parity path.)
