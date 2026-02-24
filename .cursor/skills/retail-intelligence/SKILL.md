---
name: retail-intelligence
description: Research and profile a retailer's business operations, digital strategy, and competitive positioning from their website URL. Use when the user provides a retailer domain/URL and wants a comprehensive intelligence report covering customer personas, geographic presence in Brazil, growth strategy, recent news, tech stack, traffic analysis, and pricing positioning. Produces an HTML landing page report.
---

# Retail Intelligence Report

Build a comprehensive retailer profile from a single URL/domain. Output is an **HTML landing page** served via `Bun.serve()`.

## Prerequisites

`.env` file in project root with:

```
APIFY_TOKEN=your_token
DATAFORSEO_LOGIN=your_login
DATAFORSEO_PASSWORD=your_password
BUILTWITH_API_KEY=your_key
SIMILARWEB_API_KEY=your_key
```

| Service | Signup | Cost | What it gives us |
|---------|--------|------|------------------|
| **Apify** | https://apify.com/sign-up | Free tier + pay per use | Social media profiles, Google Maps stores, trends, ads |
| **DataForSEO** | https://app.dataforseo.com/register | $50 min deposit, $0.01/call | Tech stack, Whois, traffic analytics |
| **BuiltWith** | https://builtwith.com/signup | Free (100 calls/mo) | Full tech profile, estimated revenue & tech spend |
| **SimilarWeb** | https://account.similarweb.com/journey/registration | Free trial / enterprise | Traffic sources, engagement, keywords, geo |

Also required:
- `mcpc` CLI: `npm install -g @apify/mcpc`
- Firecrawl MCP (already configured)

## Input

The user provides a retailer's main **site URL or domain** (e.g. `magazineluiza.com.br`). Normalize to `https://` if needed.

## Workflow

```
Retail Intelligence Progress:
- [ ] Phase 1: Site & Brand Analysis (Firecrawl)
- [ ] Phase 2: Tech Stack Detection (BuiltWith + DataForSEO + rawHtml)
- [ ] Phase 3: Traffic & Digital Analytics (SimilarWeb + DataForSEO)
- [ ] Phase 4: Social Media Presence (Apify)
- [ ] Phase 5: Physical Presence & Store Locations (Apify)
- [ ] Phase 6: Business Intelligence Research (Firecrawl Search)
- [ ] Phase 7: Competitive Positioning (Synthesis)
- [ ] Phase 8: Generate HTML Report
```

---

### Phase 1: Site & Brand Analysis

Uses **Firecrawl MCP** (already available).

**1a. Brand identity** — `firecrawl_scrape` with `branding` format on homepage.

**1b. Homepage content** — `firecrawl_scrape` with JSON format. Extract: company name, tagline, categories, value propositions, promotions, social media links, app store links, customer service channels. Set `location: {"country": "BR", "languages": ["pt-BR"]}`.

**1c. Site structure** — `firecrawl_map` with `includeSubdomains: true`, `limit: 100`. Look for subdomains (blog, marketplace, seller portal), institutional pages, investor relations.

---

### Phase 2: Tech Stack Detection

Use **all three sources** and cross-reference for confidence.

**2a. BuiltWith API** (most reliable for tech stack)

```bash
curl "https://api.builtwith.com/free1/api.json?KEY=${BUILTWITH_API_KEY}&LOOKUP=<domain>" | jq .
```

Returns: every technology detected, category, first/last detected dates, estimated tech spend, estimated sales revenue.

**2b. DataForSEO Domain Technologies** ($0.01/call)

```bash
curl -X POST "https://api.dataforseo.com/v3/domain_analytics/technologies/domain_technologies/live" \
  -H "Authorization: Basic $(echo -n "${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}" | base64)" \
  -H "Content-Type: application/json" \
  -d '[{"target": "<domain>"}]'
```

Returns: technologies grouped by category, with metadata.

**2c. DataForSEO Whois** ($0.10/call) — domain age, registrant, creation date

```bash
curl -X POST "https://api.dataforseo.com/v3/domain_analytics/whois/overview/live" \
  -H "Authorization: Basic $(echo -n "${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}" | base64)" \
  -H "Content-Type: application/json" \
  -d '[{"target": "<domain>"}]'
```

**2d. Raw HTML inspection** (fallback/validation)

Use `firecrawl_scrape` with `rawHtml` format + `waitFor: 5000`. Cross-check against detection patterns in [schemas.md](schemas.md).

**Cross-reference**: Merge results from all sources. Mark confidence as:
- **Confirmed** = detected by 2+ sources
- **Likely** = detected by 1 API source
- **Inferred** = detected only via HTML patterns

---

### Phase 3: Traffic & Digital Analytics

**3a. SimilarWeb API** (best traffic source breakdown)

```bash
curl -H "api-key: ${SIMILARWEB_API_KEY}" \
  "https://api.similarweb.com/v1/website/<domain>/total-traffic-and-engagement/visits?api_key=${SIMILARWEB_API_KEY}&start_date=2025-01&end_date=2025-12&country=br&granularity=monthly&main_domain_only=false"
```

Key endpoints to call:
- `/total-traffic-and-engagement/visits` — monthly visits
- `/total-traffic-and-engagement/pages-per-visit` — engagement
- `/total-traffic-and-engagement/average-visit-duration`
- `/total-traffic-and-engagement/bounce-rate`
- `/traffic-sources/overview` — direct/search/social/referral/mail/display split
- `/traffic-sources/search-organic` — top organic keywords
- `/traffic-sources/search-paid` — top paid keywords
- `/traffic-sources/social` — social traffic breakdown
- `/traffic-sources/referrals` — top referring domains
- `/geo/traffic-by-country` — geographic distribution

**3b. DataForSEO Traffic Analytics** (alternative/complement)

```bash
curl -X POST "https://api.dataforseo.com/v3/traffic_analytics/get/live" \
  -H "Authorization: Basic $(echo -n "${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}" | base64)" \
  -H "Content-Type: application/json" \
  -d '[{"target": "<domain>", "date_from": "2025-01", "date_to": "2025-12"}]'
```

**3c. Google Trends** (via Apify) — search interest over time

```bash
SKILL_PATH=.agents/skills/apify-trend-analysis
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "apify/google-trends-scraper" \
  --input '{"searchTerms": ["<company name>", "<competitor 1>", "<competitor 2>"], "geo": "BR", "timeRange": "past12Months"}'
```

---

### Phase 4: Social Media Presence

Uses **Apify actors** via `run_actor.js`. Run these in parallel where possible.

**4a. Instagram profile**

```bash
SKILL_PATH=.agents/skills/apify-competitor-intelligence
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "apify/instagram-profile-scraper" \
  --input '{"usernames": ["<instagram_handle>"]}'
```

Get: followers, following, posts count, bio, engagement rate, recent posts.

**4b. Facebook page**

```bash
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "apify/facebook-pages-scraper" \
  --input '{"startUrls": [{"url": "https://www.facebook.com/<page_name>"}]}'
```

Get: likes, followers, rating, about, contact info.

**4c. TikTok profile**

```bash
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "clockworks/tiktok-profile-scraper" \
  --input '{"profiles": ["<tiktok_handle>"]}'
```

**4d. YouTube channel**

```bash
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "streamers/youtube-channel-scraper" \
  --input '{"channelUrls": ["https://www.youtube.com/@<handle>"]}'
```

**4e. Facebook/Instagram Ads** (competitor ad monitoring)

```bash
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "apify/facebook-ads-scraper" \
  --input '{"searchQuery": "<company name>", "countryCode": "BR", "maxResults": 20}'
```

**Finding social handles**: Extract from Phase 1b social links. If not found, search:
```
firecrawl_search: "<company name>" instagram.com OR facebook.com OR tiktok.com site:instagram.com OR site:facebook.com
```

---

### Phase 5: Physical Presence & Store Locations

**5a. Google Maps store search** (via Apify)

```bash
SKILL_PATH=.agents/skills/apify-market-research
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "compass/crawler-google-places" \
  --input '{"searchStringsArray": ["<company name>"], "countryCode": "br", "maxCrawledPlacesPerSearch": 200}' \
  --output "data/<domain>-stores.json" \
  --format json
```

Returns: all physical locations with addresses, ratings, hours, phone numbers, coordinates. From this data, extract:
- Total store count
- States/cities covered
- Rating distribution
- Regional concentration

**5b. Store locator page** (via Firecrawl)

Use `firecrawl_map` with `search: "lojas nossas-lojas store-locator"` to find the retailer's own store locator. If found, scrape it for official location data.

---

### Phase 6: Business Intelligence Research

Uses **Firecrawl search** for news and business context. Run searches in parallel.

**6a. Company overview & positioning**
```
"<company name>" empresa história posicionamento mercado Brasil
```

**6b. Customer personas** — infer from:
- Product categories and price ranges (Phase 1b)
- Social media audience demographics (Phase 4)
- Google Maps review sentiment (Phase 5)
- Search: `"<company name>" público-alvo perfil consumidor`

**6c. Growth strategy**
```
"<company name>" estratégia crescimento marketplace e-commerce lojas expansão 2024 2025
```
```
"<company name>" omnichannel transformação digital seller
```

**6d. Recent news — M&A, launches, C-level** (use `news` source)
```
"<company name>" aquisição fusão OR lançamento OR inauguração OR CEO OR nomeação
```

**6e. Investor relations** (if publicly traded)
Search for RI page, scrape latest earnings release or annual report summary.

**6f. Pricing strategy**
```
"<company name>" preço competitivo premium posicionamento pricing
```
Also scrape a sample product page to assess: installment options, discount patterns, comparison pricing, loyalty discounts.

---

### Phase 7: Competitive Positioning (Synthesis)

No data collection — this is analysis. Based on all collected data, assess:

| Dimension | Indicators |
|-----------|-----------|
| **Leader vs Follower** | Market share, trend-setting products, first-mover signals |
| **Premium vs Economic** | Price points, brand partnerships, store aesthetics, marketing tone |
| **Impulse vs Considered** | Flash sales, countdown timers = impulse; wishlists, comparison tools, reviews = considered |
| **Retention strength** | Loyalty program detected, email/remarketing pixels, app installs, returning visitor rate |
| **Traffic health** | Organic-heavy = SEO moat; Paid-heavy = acquisition dependent; Direct = strong brand |
| **Digital maturity** | Tech stack sophistication, # of CRO tools, personalization engines |

---

### Phase 8: Generate HTML Report

Generate a single-page HTML report styled with the retailer's brand colors (from Phase 1). Report structure defined in [report-template.md](report-template.md).

Write files to:
- `reports/<domain-slug>-report.html`
- `reports/serve-<domain-slug>.ts`

Serve with: `bun --hot reports/serve-<domain-slug>.ts`

---

## Important Guidelines

- **Language**: Portuguese (pt-BR) for Brazilian market searches; English for tech/API queries.
- **Firecrawl location**: Always set `location: {"country": "BR", "languages": ["pt-BR"]}`.
- **Apify SKILL_PATH**: Use `.agents/skills/apify-ultimate-scraper` or the specific skill directory.
- **Rate limiting**: Space out API calls. Don't fire all at once.
- **Graceful degradation**: If an API key is missing, skip that source and note it in the report. Never fail the whole report because one source is unavailable.
- **Freshness**: Prioritize data from the last 12 months.
- **Cite sources**: Include source URLs in the report for each data point.
- **Uncertainty labeling**: "Confirmed" (multi-source), "Estimated" (single source), "Inferred" (analysis-based).
