# Parsing the deco preview URL from PR comments

The deco platform posts a PR comment when a preview is ready. The bot's username, the comment format, and the URL host have varied across platform versions, so the workflow must match **multiple styles**.

> **Prerequisite: the workflow MUST check out the repo, or `.qarc.json` is ignored.** The engine loads its config from `join(process.cwd(), ".qarc.json")` — i.e. only if the file is present in the runner's working directory. **Without an `actions/checkout` step the file doesn't exist on the runner**, and the journey runs with just `--url` + built-in defaults: `features.checkoutUrlPattern`, `viewports`, and `selectors` are all **silently dropped**. The shipped templates always check out first; this bites anyone hand-writing a simplified manual workflow that skips checkout (it feels unnecessary when you "only" need a URL). Typical symptom: `data-qa-checkout-page missing` even though `checkoutUrlPattern` is set in `.qarc.json`, or viewport scoping being ignored. *(Learning: aviator.)*

## Known comment styles

### Style A — Visible "Visit Preview" link (older `decobot`)

```
deco Deployment · commit f20e5dc

| Name    | Status   | Preview                                | Updated                       |
| ------- | -------- | -------------------------------------- | ----------------------------- |
| farmrio | ✅ Ready | [Visit Preview](https://...workers.dev) | Thu, 21 May 2026 22:11:41 GMT |
```

- Bot login: `decobot`
- Marker: visible `[Visit Preview](URL)` link.
- Host: `*.workers.dev` historically.

### Style B — HTML comment marker (newer deco platform)

```html
<!-- deco-pr-comment id=42 commit=f20e5dc -->
Preview ready: https://pr-42-farmrio.decocdn.com
```

- Bot login: varies (`deco-bot`, `decocms-bot`, sometimes `github-actions[bot]` if posted via Actions).
- Marker: HTML comment `<!-- deco-pr-comment` at the top of the body.
- Host: `*.decocdn.com`, `*.deco.site`, `*.deco-cx.com`.

## Detection regex (handles both styles)

```js
const URL_REGEX = /\[Visit Preview\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s"<]+\.(?:workers\.dev|decocdn\.com|deco\.site|deco-cx\.com)\b[^\s"<]*/;
const READY_REGEX = /Ready|ready|✅|deco-pr-comment/;
const BOT_LOGINS = new Set(['decobot', 'deco-bot', 'decocms-bot', 'github-actions[bot]']);
```

`URL_REGEX` has two alternatives:
1. Capture group 1: URL inside `[Visit Preview](...)`.
2. Whole-match (no capture): URL on a known deco host.

In code, prefer the captured group if present, fall back to the whole match (`m[1] || m[0]`).

## Bot identification

**Trust the comment's AUTHOR, not its body.** A `pull_request`-triggered run drives the journey against whatever URL we extract here, so the trust decision must be unspoofable. `BOT_LOGINS` already includes the generic `github-actions[bot]` account that newer deploys post through, so matching on login alone is both sufficient and safe:

```js
const isBot = c.user && BOT_LOGINS.has(c.user.login);
```

Do **NOT** also trust a comment because its body contains `deco-pr-comment` or a deco-host URL. Any PR author (or a drive-by commenter) could post a crafted `✅ Ready` comment with `[Visit Preview](https://attacker.example/...)` and redirect the QA job to a host they control. Use `deco-pr-comment` / `READY_REGEX` only to recognize the *ready* state and `URL_REGEX` only to *extract* the URL — never to decide trust.

If the real preview bot ever posts under a login not in `BOT_LOGINS`, add that login to the set (don't widen the filter back to body text). The `workflow_dispatch` manual URL is the escape hatch in the meantime.

## Polling

- Interval: 20s.
- Total timeout: 10 minutes.
- Sort candidates by `updated_at` DESC and take the first that matches `READY_REGEX`.

## workflow_dispatch fallback

The PR workflow MUST accept a manual URL via `workflow_dispatch` input. This is the escape hatch when:

- Decobot is slow or down.
- The PR is from a fork (decobot may not deploy fork PRs).
- The preview URL is known but the comment hasn't landed yet.
- The team wants to test against staging instead of preview.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      url:
        description: Manual override (skip preview polling)
        required: true
        type: string
```

In the resolve step:

```yaml
- name: Resolve target URL
  id: target
  # Pass URLs via env, never inline ${{ }} into the shell — the preview URL comes
  # from an untrusted PR comment and a crafted value could otherwise inject commands.
  env:
    INPUT_URL: ${{ inputs.url }}
    PREVIEW_URL: ${{ steps.preview.outputs.url }}
  run: |
    if [ -n "$INPUT_URL" ]; then
      echo "url=$INPUT_URL" >> "$GITHUB_OUTPUT"
    else
      echo "url=$PREVIEW_URL" >> "$GITHUB_OUTPUT"
    fi
```

This pattern lets `gh workflow run qa-pr.yml --field url=https://staging.example.com` work from the CLI when needed.

## What to do if NO preview ever materializes

Some deco repos don't have automatic PR previews (e.g., they deploy manually). For those, the PR workflow should fail fast with a clear message — the team can either:

1. Set up the deco PR-preview integration.
2. Use `workflow_dispatch` with a manual URL each time.
3. Skip the PR workflow entirely and rely on `qa-main.yml` (post-merge testing).

Phase 1 of the skill should detect option 3 by checking if past PRs have any deco-bot comments at all. If none in last 10 PRs, ask the user whether to install the PR workflow or only the main workflow.

---

# Main: waiting for the prod deploy

The PR workflow waits on a **comment**; the main workflow waits on a **commit status**. They are different signals because prod has no PR to comment on.

## The signal

A push to `main` only *triggers* deco's prod build/deploy, which runs asynchronously **off** GitHub Actions (minutes). deco reports its progress as a legacy GitHub **commit status** (NOT a check-run and NOT an Actions workflow — so it never shows in `gh run list`; inspect it with `gh api repos/:owner/:repo/commits/<sha>/status`):

```
context:    "Deco / <site> / prod"     # e.g. "Deco / site-technos / prod" — stable across commits
target_url: https://admin.deco.cx/sites/<site>/spaces/build-logs?commit=<sha>&provider=gcp
state:      pending  ──(build + deploy running)──>  success    # prod is live
```

If QA-main runs the journey on `push` immediately, it races this deploy and tests the **previous** prod version → false `data-qa-*`-missing failures (the markers exist in the just-merged code but aren't deployed yet).

## The wait step

Mirror the PR workflow's `Wait for deco preview`, but poll the commit status via `getCombinedStatusForRef` (it consolidates repeated posts to the final state per context):

```js
const PROD_CONTEXT = /^Deco \/ .+ \/ prod$/;   // per-store slug → match by pattern, site-agnostic
const { data } = await github.rest.repos.getCombinedStatusForRef({
  owner: context.repo.owner, repo: context.repo.repo, ref: context.sha,
});
const prod = data.statuses.find(s => PROD_CONTEXT.test(s.context));
// prod?.state: 'success' → run journey; 'failure'/'error' → fail fast (link target_url);
// undefined or 'pending' → keep polling (deco takes a moment to register the pending status).
```

- **Poll interval 20s, timeout 20 min** (prod builds run longer than preview builds).
- **Gate on `if: github.event_name == 'push'`** so a `workflow_dispatch` run (manual URL override / prod smoke) skips the wait entirely.
- **Fail fast on `failure`/`error`** with the `target_url` build-logs link — testing a prod that didn't republish would be misleading.
- Match the context with the regex, never a hardcoded `Deco / site-technos / prod`: the slug differs per store, and the template is site-agnostic.
