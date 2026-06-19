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
    "qa:local": "deno run -A npm:@decocms/qa@latest journey --url http://localhost:8000 --headed --debug"
  }
}
```

Notes:
- **`deno task` does NOT support bash `${VAR:-default}` expansion** — it uses `deno_task_shell`, which throws `Error parsing script ... Unexpected character` on the `:-`. Do not put `${URL:-…}` in a task. Instead: hardcode `--url http://localhost:8000` in `qa:local`. To target another URL, **append it as a trailing arg** — `deno task qa:local --url https://preview…` — since `deno task` forwards extra args to the command.
- `deno run -A` grants all permissions — required because Playwright spawns browsers + writes files. Engine binary needs filesystem, network, env, and run permissions.
- `npm:@decocms/qa@latest` always resolves the newest published engine via Deno's npm specifier. `qa:local` is for local debug, so `@latest` is the right call (no pinning). The control-plane runner owns verdict determinism, not the store repo.

### Local debug script

`scripts/qa-local.sh` is unnecessary in pure Deno — point users straight at `deno task qa:local`.

## Mixed (Deno + package.json) wiring

If the repo has BOTH `deno.json` and `package.json` (typical when Cypress or Vite is already installed), prefer the **npm side** for consistency with the existing tooling:

1. Add a `qa:local` script to `package.json` (`bunx @decocms/qa@latest journey --url ${1:-http://localhost:8000} --headed --debug`, via `scripts/qa-local.sh`). No pinned devDep is needed — the journey runs on the control-plane runner, which installs the engine itself.
2. **Do not** add the same task to `deno.json` — pick one source of truth (npm side wins because it's where Cypress/Vite live).

## What if `deno.json` doesn't have a `tasks` field?

Add one. Don't create a competing config file. Merge logic in the skill:

1. Read `deno.json` (parse JSON, tolerate JSONC if `.jsonc`).
2. If `tasks` doesn't exist, add `"tasks": {}`.
3. Merge `qa:local` into `tasks`, preserving existing keys.
4. Write back with same indentation as input.

If the parse fails (truly broken JSON), abort and ask the user to fix `deno.json` before proceeding.

## What about Fresh-specific routes?

Fresh stores ecommerce routes under `routes/` (file-based routing). PDP, PLP, cart, checkout components live inside `routes/produto/[slug].tsx`, `routes/c/[category].tsx`, etc. Phase 2 of the skill (locating elements) doesn't change — same grep patterns work — but be aware that JSX target files often follow the Fresh route convention rather than the Next-style `pages/`.

Components from `@deco/storefront` or `https://deno.land/x/deco@*` are external imports. Apply the wrapper strategy (`references/wrapping-external-components.md`) regardless of Deno-vs-Node.
