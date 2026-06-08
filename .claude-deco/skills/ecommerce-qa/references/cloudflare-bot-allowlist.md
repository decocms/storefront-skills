# Cloudflare bot allowlist — let the QA bot through gated previews

## TL;DR

deco `*.decocdn.com` previews sit behind **Cloudflare Bot Management**. A CI runner (datacenter IP) driving headless Chromium scores as a bot → Cloudflare returns a `403`/challenge instead of the store, and every journey step fails against HTML that isn't the storefront.

**The fix (default, since engine `@decocms/qa` ≥ 0.5.0):** the engine tags its browser User-Agent with a `deco-qa-bot/1.0` token. Add a **one-time** carve-out to the Cloudflare WAF rule that blocks bots so requests carrying that token are allowed. Surgical, and a single zone-level rule covers **every deco store** on that zone — you don't repeat this per repo.

This replaces the older "boot the storefront locally in CI" workaround (now the fallback — see `ci-local-boot.md`) for any store whose previews you can reach via the Cloudflare zone.

## The engine side (already done in ≥ 0.5.0)

In `src/engine/browser.ts`, `newContext` appends the token to the UA:

```ts
const QA_UA_TOKEN = "deco-qa-bot/1.0";
// ...
const uaOverride = process.env.QA_USER_AGENT?.trim();
const userAgent = uaOverride
  ? uaOverride
  : baseContext.userAgent
    ? `${baseContext.userAgent} ${QA_UA_TOKEN}`   // e.g. "Mozilla/5.0 … Chrome/… deco-qa-bot/1.0"
    : undefined;
const ctx = await browser.newContext({ ...baseContext, userAgent, /* … */ });
```

- The token rides on a normal Chromium UA, so the request still looks like a real browser to everything *except* the allowlist check.
- `QA_USER_AGENT` env var fully overrides the UA if a store needs a different token (rare). Default needs no config.
- Nothing to set in `.qarc.json` or the workflow — the token is automatic. The CI just needs the pinned `{{ENGINE_VERSION}}` to be ≥ 0.5.0.

## The Cloudflare side (one-time, per zone)

You need access to the Cloudflare zone that serves `*.decocdn.com` (deco platform / infra owner).

1. **Find the rule that's blocking the preview.** Cloudflare dashboard → **Security → Events** (or *WAF → Events*). Filter to the preview host (`envs-<site>--<hash>.decocdn.com`) or your test request. The blocked event names the rule (Rule ID + action `BLOCK`/`MANAGED_CHALLENGE`). It's usually a custom WAF rule keyed on a bot score, e.g. `cf.bot_management.score eq 1` or `… le 30`.
2. **Add the token as an exception to THAT rule** — edit the existing block rule's expression, don't create a separate Allow rule (a new rule can sit at the wrong precedence and either shadow other rules or be shadowed). Append:

   ```
   and not (http.user_agent contains "deco-qa-bot")
   ```

   So a rule like
   ```
   (cf.bot_management.score eq 1 and http.host wildcard "*.decocdn.com")
   ```
   becomes
   ```
   (cf.bot_management.score eq 1 and http.host wildcard "*.decocdn.com" and not http.user_agent contains "deco-qa-bot")
   ```
3. **Scope it to preview hosts.** Keep the `*.decocdn.com` host condition so the carve-out only ever applies to ephemeral previews — never to production storefronts. Don't widen the rule to the whole zone.
4. **Deploy** the rule. Effective within seconds.

### Platform-wide by design
Because the carve-out lives on the zone WAF rule (matched by UA token, host-scoped to `*.decocdn.com`), it applies to **all** deco stores served from that zone. Set it once; every store's QA workflow — present and future — flows through it. No per-site Cloudflare change.

## Verify

```sh
PREVIEW="https://envs-<site>--<hash>.decocdn.com"
# Without the token → blocked:
curl -s -o /dev/null -w '%{http_code}\n' "$PREVIEW"                         # 403 / 503
# With the token → allowed:
curl -s -o /dev/null -w '%{http_code}\n' -A "Mozilla/5.0 deco-qa-bot/1.0" "$PREVIEW"   # 200
```

A `200` only with the token confirms the carve-out is live and surgical. Then re-run the QA workflow — the journey should reach the store and proceed.

## Security tradeoff (read before shipping this platform-wide)

The carve-out is matched by a **static User-Agent token that travels on every QA request** — and lands in access logs, proxies, and error trackers. So treat it as **public, not secret**: anyone who observes one QA request (or reads this skill) can replay the token and walk straight through the bot rule. The blast radius is **every `*.decocdn.com` preview on the zone**, because the rule is intentionally zone-wide (one rule, all stores).

The host scope still bounds it:

- It's **host-scoped to `*.decocdn.com`** — it does **not** touch production storefronts or weaken bot protection for real users.
- But "just a preview" is not always low-value: previews can expose **unreleased code, staging data, feature flags, and internal pricing/config** before launch. Judge the carve-out against *that*, not against an empty page.

**Recommendation by context:**

- **Low-sensitivity previews:** the host-scoped UA carve-out is a fine balance — keep it simple.
- **Sensitive previews, or any externally-owned zone:** the UA token alone is not enough — AND a **second, non-public factor** onto the same rule:
  - **Shared secret header** (preferred): the workflow sends `x-qa-secret: <GitHub Actions secret>` and the rule matches `http.request.headers["x-qa-secret"][0] eq "<Cloudflare-stored secret>"`. The secret never rides the UA, never appears in this skill, and is rotatable. Needs the engine/workflow to set the header — see the open note below.
  - **Egress IP/ASN:** `and ip.geoip.asnum in {GH_ACTIONS_ASNs}` — pin to the CI network. Strong but brittle (GitHub's ranges change).

**Review periodically.** A zone-wide allowlist on a guessable token is the kind of thing that quietly outlives its reason — re-confirm its scope and necessity on a cadence.

> **Open (engine support):** today the engine only sends the static UA token, so the secret-header form needs a small engine feature — an optional `QA_AUTH_TOKEN` env that the engine forwards as a request header. Until that lands, the UA carve-out is the only turn-key option; for sensitive zones, pair it with the IP/ASN condition above.

## When you can't do this

No access to the Cloudflare zone (e.g. an external client owns it)? Use the **local-boot fallback**: build + boot the storefront inside the CI job and test `http://localhost:8000` — no preview fetch, no Cloudflare. See `ci-local-boot.md`. It's slower and tests the freshly-built branch code rather than the exact preview deploy, but it sidesteps the gate entirely.
