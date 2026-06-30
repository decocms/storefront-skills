---
name: bot-rendering-audit
description: Use when doing a quick SEO check to verify whether crawlers receive LD+JSON and og:tags on a deco storefront. Not a definitive WAF audit — use as a first-pass signal to identify obvious misconfigurations in bot rendering or CDN blocking.
---

This skill covers a **quick SEO-oriented verification** of bot rendering on deco storefronts. It is not a definitive CDN/WAF audit — the curl-based checks have inherent limitations (see below). Use this to surface obvious problems fast; for conclusive WAF analysis, use the Cloudflare Security Events dashboard.

Bot access on a deco storefront has two independent layers that must both work:

1. **CDN/WAF layer** (Cloudflare) — does the bot reach the server at all?
2. **deco isBot layer** — once it reaches the server, does it get full SSR?

A bot blocked at layer 1 never triggers `isBot`. A bot that passes layer 1 but isn't detected at layer 2 gets the deferred shell. Both cases result in missing LD+JSON.

---

## Layer 1 — WAF access check

Test HTTP status for each crawler UA. A `403` from Cloudflare means the bot is being blocked.

```bash
STORE="https://www.store.com"

for BOT in \
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" \
  "GPTBot/1.0" \
  "ClaudeBot" \
  "PerplexityBot/1.0"
do
  STATUS=$(curl -so /dev/null -w "%{http_code}" -A "$BOT" "$STORE/")
  echo "$STATUS  $BOT"
done
```

**What a `403` tells you:** the WAF has a rule matching that UA — the real crawler is almost certainly blocked too, since UA-based rules apply regardless of origin IP.

**What a `200` does NOT guarantee:** the real bot may still be blocked by IP reputation, ASN rules, or bot score analysis that curl cannot trigger. A `200` from curl is a good sign, not a proof.

### Limitations of UA-based testing

| Cloudflare mechanism | curl detects? | Notes |
|---|---|---|
| WAF rule by User-Agent | ✅ yes | Most common block type; curl is reliable here |
| IP/ASN block | ❌ no | Real bot comes from Microsoft/Google datacenter IPs |
| Bot Score (behavioral) | ❌ no | Cloudflare analyzes request patterns curl doesn't reproduce |
| JS Challenge | ❌ no | curl cannot execute JavaScript challenges |
| Verified Bot allowlist | ⚠️ inverse | Real bot from verified IP may bypass a rule that blocks curl |

**For conclusive WAF analysis:** Cloudflare dashboard → Security → Events, filtered by the bot's ASN (e.g., AS8075 for Microsoft/Bing). This shows real bot traffic, which rule fired, and whether Verified Bot IPs are being allowed or blocked.

---

## Layer 2 — isBot / SSR rendering check

For bots that pass layer 1, verify they receive full SSR (LD+JSON present in initial HTML):

```bash
PDP="https://www.store.com/product-slug/p"

for BOT in \
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  "GPTBot/1.0" \
  "ClaudeBot" \
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
do
  COUNT=$(curl -s -A "$BOT" "$PDP" | grep -c "application/ld+json")
  echo "$COUNT LD+JSON  →  $BOT"
done
```

Expected: bot UAs return `≥1`, user UA returns `0`.

**Baseline control:** `?__decoFBT=0` forces full SSR — shows the maximum LD+JSON any bot should see:
```bash
curl -s "$PDP?__decoFBT=0" | grep -c "application/ld+json"
```

If a bot UA returns `0` but `__decoFBT=0` returns `≥1`, the bot UA is not being detected by `isBot`.

---

## How deco's isBot works

`isBot` (`deco/utils/userAgent.ts`) checks three paths in order:

| Path | Mechanism |
|---|---|
| `cf-verified-bot: true` header | Cloudflare injects for real bots coming from verified IP ranges (Business/Enterprise plan) |
| `KNOWN_BOTS` list | Hardcoded list, e.g. `["Google-InspectionTool"]` |
| UA parser | `ua-parser-js` Bots extension — covers Googlebot, Bingbot, GPTBot, etc. |

If none match, `isBot = false` and the page is served as a deferred shell with no LD+JSON.

---

## Interpreting results

| WAF | isBot | LD+JSON | Root cause |
|---|---|---|---|
| ✅ 200 | ✅ detected | ✅ present | Working correctly |
| ❌ 403 | — | ❌ absent | WAF rule blocking that UA — fix in Cloudflare dashboard |
| ✅ 200 | ❌ not detected | ❌ absent | UA not recognized by ua-parser-js or KNOWN_BOTS |
| ✅ 200 | ✅ detected | ❌ absent | SEO section misconfigured — see `pdp-seo-sections` skill |

---

## Google Search Console — end-to-end validation

URL Inspection → "Test Live URL" uses real Googlebot from Google's verified IP range. If the rendered page shows product name, price, and structured data — both layers work end-to-end.

This is the only way to validate the `cf-verified-bot` path, since that header is only set for traffic coming from verified bot IP ranges — something curl cannot reproduce.
