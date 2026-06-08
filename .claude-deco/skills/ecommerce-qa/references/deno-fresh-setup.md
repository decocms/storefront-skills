# Wiring QA in Deno + Fresh repos

Many deco.cx stores still run on Deno + Fresh (the original deco stack). Newer stores use `@decocms/runtime` on Bun/Node. The skill must detect which and wire QA differently. The engine itself doesn't care — it's an npm package that both runtimes can invoke.

## Detect the runtime

In Phase 1:

| Signal | Means |
|---|---|
| `deno.json` or `deno.jsonc` exists, no `package.json` | **Pure Deno**. Wire via Deno tasks. |
| `deno.json` AND `package.json` exist | **Mixed**. Prefer `package.json` (usually has a JS-tooling dep like Cypress, Tailwind, Vite). |
| Only `package.json` exists | **Pure Node/Bun**. Default flow — see main SKILL.md. |

`deno.lock` is also a strong signal of pure-Deno. Absence of `node_modules/.bin` directory after a hypothetical install is another.

## Pure Deno wiring

For a repo with `deno.json` and no `package.json`, do NOT create a `package.json`. Use Deno's npm interop instead.

### Update `deno.json` (merge tasks)

Skill must read the existing `deno.json`, add the `qa:*` tasks to its `tasks` field, and write it back. Use template `templates/deno-tasks.json.tmpl` as the source of the fragment.

Example merge:

```jsonc
// deno.json (after merge)
{
  "tasks": {
    // ... existing tasks
    "qa:local": "deno run -A npm:@decocms/qa@latest journey --url http://localhost:8000 --headed --debug",
    "qa:smoke": "deno run -A npm:@decocms/qa@latest journey --smoke",
    "qa:run": "deno run -A npm:@decocms/qa@latest journey --junit junit.xml --github"
  }
}
```

Notes:
- **`deno task` does NOT support bash `${VAR:-default}` expansion** — it uses `deno_task_shell`, which throws `Error parsing script ... Unexpected character` on the `:-`. Do not put `${URL:-…}` in a task. Instead: hardcode `--url http://localhost:8000` in `qa:local`, and let `qa:smoke`/`qa:run` fall back to the `.qarc.json` `url` (the engine reads it when `--url` is absent). To target another URL, **append it as a trailing arg** — `deno task qa:run --url https://preview…` — since `deno task` forwards extra args to the command. This is also how the workflows pass the preview/prod URL — but in CI the URL is first placed in an `env:` var and referenced as `--url "$TARGET_URL"`, **never** inlined as `${{ ... }}` in the shell, to avoid command injection from untrusted PR-comment URLs.
- `deno run -A` grants all permissions — required because Playwright spawns browsers + writes files. Engine binary needs filesystem, network, env, and run permissions.
- `npm:@decocms/qa@latest` always resolves the newest published engine via Deno's npm specifier. The skill is version-agnostic — track latest rather than pinning, since the engine moves fast (verify with `npm view @decocms/qa version`).
- No need for a `bun install` step in CI — Deno resolves `npm:` specifiers on first run.

### Workflows

Use `templates/workflows/qa-pr-deno.yml.tmpl` and `qa-main-deno.yml.tmpl` (Deno variants). They use `denoland/setup-deno@v1` instead of `oven-sh/setup-bun@v2`. The engine invocation becomes `deno task qa:run --url $PREVIEW_URL` (CI exposes a separate `qa:run` task or invokes `deno run` directly with CI-friendly flags).

### Local debug script

`scripts/qa-local.sh` is unchanged — it just calls `deno task qa:local "$@"`. Or the skill skips the shell script and points users straight at `deno task qa:local`.

## When the preview is behind Cloudflare Bot Management

Some stores front their deco preview with Cloudflare Bot Management. A journey launched from a GitHub-Actions runner IP then gets an interstitial / `403` challenge page instead of the storefront, and every step fails with "element not found" against HTML that isn't the store. Spoofing a real User-Agent doesn't reliably clear it (Bot Management also scores the IP / TLS fingerprint) — and you shouldn't have to.

**Default fix: the `deco-qa-bot` UA carve-out.** Engine `@decocms/qa` ≥ 0.5.0 tags its browser User-Agent with a `deco-qa-bot/1.0` token; add a one-time Cloudflare WAF carve-out for that token (host-scoped to `*.decocdn.com`) and the QA bot flows through every deco preview on the zone. Nothing changes in the workflow — keep polling the preview link. Full playbook in `cloudflare-bot-allowlist.md`.

**Fallback (no Cloudflare zone access): test a locally-booted storefront** instead of the remote preview. Build and serve the store inside the CI job, then point the engine at `localhost`:

```yaml
      - name: Build & start storefront
        run: |
          deno cache dev.ts main.ts   # pre-warm: a cold deco build re-fetches the shared graph 100s of times
          deno task build
          deno task preview &
          timeout 60 bash -c 'until curl -sf http://localhost:8000 >/dev/null; do sleep 2; done'
      - name: Run purchase journey
        env:
          TARGET_URL: http://localhost:8000
        run: deno task qa:run --url "$TARGET_URL"
```

Trade-off: you test the PR's freshly built code, not the exact deco preview deployment — but it dodges the challenge entirely and still exercises the full journey. Cross-origin checkout (`checkoutCrossOrigin`) can't be validated against `localhost` (the engine skips it locally), so this pairs best with same-origin / `checkoutUrlPattern` stores. See `ci-local-boot.md` for the cold-build pre-warm + committed-decofile details. *(Learning: Osklen used this before the UA carve-out existed; technos now uses the carve-out.)*

## Mixed (Deno + package.json) wiring

If the repo has BOTH `deno.json` and `package.json` (typical when Cypress or Vite is already installed), prefer the **npm side** for consistency with the existing tooling:

1. Add `@decocms/qa` as `devDependencies` in `package.json` set to `latest`.
2. Add scripts `qa:local`, `qa:smoke` to `package.json`.
3. Use the default workflow templates (`qa-pr.yml.tmpl`, `qa-main.yml.tmpl`).
4. **Do not** add the same tasks to `deno.json` — pick one source of truth (npm side wins because it's where Cypress/Vite live).

This matches the agent's choice in screenshot 3 (option 3): "Create a minimal package.json with devDep + npm scripts (Cypress is already npm-based)" — but in a mixed repo the package.json already exists, so it's just adding to it.

## Why not always use `bun` in CI?

`bunx @decocms/qa` is more concise and faster to bootstrap, but it requires installing Bun in CI. In pure Deno repos:
- The team doesn't use Bun for anything else.
- Adding Bun setup is friction with zero corresponding payoff.
- `deno run npm:@decocms/qa` works identically.

In mixed repos (with `package.json`), Bun is already de facto the JS package manager (or pnpm/npm — same idea), so reusing the same toolchain is consistent.

## What if `deno.json` doesn't have a `tasks` field?

Add one. Don't create a competing config file. Merge logic in the skill:

1. Read `deno.json` (parse JSON, tolerate JSONC if `.jsonc`).
2. If `tasks` doesn't exist, add `"tasks": {}`.
3. Merge `qa:local` and `qa:smoke` into `tasks`, preserving existing keys.
4. Write back with same indentation as input.

If the parse fails (truly broken JSON), abort and ask the user to fix `deno.json` before proceeding.

## What about Fresh-specific routes?

Fresh stores ecommerce routes under `routes/` (file-based routing). PDP, PLP, cart, checkout components live inside `routes/produto/[slug].tsx`, `routes/c/[category].tsx`, etc. Phase 2 of the skill (locating elements) doesn't change — same grep patterns work — but be aware that JSX target files often follow the Fresh route convention rather than the Next-style `pages/`.

Components from `@deco/storefront` or `https://deno.land/x/deco@*` are external imports. Apply the wrapper strategy (`references/wrapping-external-components.md`) regardless of Deno-vs-Node.
