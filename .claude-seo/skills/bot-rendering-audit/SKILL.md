---
name: bot-rendering-audit
description: Use when validating whether crawlers (Googlebot, Bingbot, GPTBot, ClaudeBot) receive SSR content with LD+JSON and og:tags on a deco storefront. Applies when diagnosing why Bing, AI crawlers, or social previews don't index product data, or when a WAF may be blocking legitimate bots.
---

Bot access on a deco storefront has two independent layers that must both work:

1. **CDN/WAF layer** (Cloudflare) — does the bot reach the server at all?
2. **deco isBot layer** — once it reaches the server, does it get full SSR?

A bot blocked at layer 1 never triggers `isBot`. A bot that passes layer 1 but isn't detected at layer 2 gets the deferred shell. Both cases result in missing LD+JSON.

---

## Layer 1 — WAF access audit

Test HTTP status for each crawler UA. A `403` from Cloudflare means the bot never reaches deco.

```bash
STORE="https://www.store.com"

for BOT in \
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" \
  "GPTBot/1.0" \
  "ClaudeBot" \
  "PerplexityBot/1.0" \
  "Applebot/0.1"
do
  STATUS=$(curl -so /dev/null -w "%{http_code}" -A "$BOT" "$STORE/")
  echo "$STATUS  $BOT"
done
```

Expected: all `200`. A `403` with `server: cloudflare` header means the Cloudflare WAF has a rule blocking that UA.

**Important caveat:** Cloudflare distinguishes spoofed UAs (curl from a random IP) from verified bots (real Googlebot from Google's IP range). A `200` for Googlebot UA from curl doesn't guarantee real Googlebot passes — but a `403` confirms the bot is blocked regardless of origin.

---

## Layer 2 — isBot / SSR rendering audit

For bots that pass layer 1, verify they receive full SSR (LD+JSON present in initial HTML, no deferred placeholder):

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

**Baseline control:** `?__decoFBT=0` shows the maximum LD+JSON count any bot should see:
```bash
curl -s "$PDP?__decoFBT=0" | grep -c "application/ld+json"
```

If a bot UA returns `0` but `__decoFBT=0` returns `≥1`, the bot is not being detected by `isBot`.

---

## How deco's isBot works

`isBot` (`deco/utils/userAgent.ts`) checks three paths in order:

| Path | Mechanism | Controllable? |
|---|---|---|
| `cf-verified-bot: true` header | Cloudflare injects for verified bot IPs | Cloudflare plan (Business/Enterprise) |
| `KNOWN_BOTS` list | Hardcoded: `["Google-InspectionTool"]` | Code change in deco repo |
| UA parser | `ua-parser-js` Bots extension | Covers Googlebot, Bingbot, GPTBot, etc. |

If none match, `isBot = false` and the page is served as a deferred shell.

---

## Interpreting results

| WAF | isBot | LD+JSON | Root cause |
|---|---|---|---|
| ✅ 200 | ✅ detected | ✅ present | Working correctly |
| ❌ 403 | — | ❌ absent | Cloudflare WAF rule blocking UA — fix in Cloudflare dashboard |
| ✅ 200 | ❌ not detected | ❌ absent | UA not in KNOWN_BOTS and not recognized by ua-parser-js |
| ✅ 200 | ✅ detected | ❌ absent | SEO section misconfigured — see `pdp-seo-sections` skill |

---

## Common issues

**bingbot returning 403**
Cloudflare WAF has a rule blocking the bingbot UA. Real Bing crawler can't index any page. Fix: review Security → WAF rules in the Cloudflare dashboard for that zone. Check if a custom rule targets `bingbot` UA or a broad bot-blocking rule was enabled.

**GPTBot/ClaudeBot returning shell (0 LD+JSON)**
These UAs are recognized by ua-parser-js as bots, so they should pass isBot. If they don't, check that `shouldForceRender` is wired up in the page handler and that `firstByteThresholdMS` is not overriding bot detection (see `pdp-seo-sections` skill).

**Googlebot UA gets 200 + LD+JSON but Google Search Console shows missing data**
The curl test uses a spoofed UA from a random IP. Real Googlebot comes from verified Google IPs and Cloudflare adds `cf-verified-bot: true`. Use Google Search Console → URL Inspection → "Test Live URL" to confirm what the actual crawler sees.

---

## Google Search Console validation (layer 1 + layer 2 combined)

URL Inspection → "Test Live URL" uses real Googlebot from Google's verified IP range. If the rendered page shows product name, price, and structured data — both layers are working end-to-end for Google.

This is the only way to validate the `cf-verified-bot` path since that header is only set for traffic coming from verified bot IP ranges.
