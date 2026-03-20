# Tech Stack Detection Patterns

## HTML Signature Detection (rawHtml fallback)

When analyzing `rawHtml` from Firecrawl, search for these signatures in `<script>` tags, meta tags, HTML comments, and global JS objects.

### E-commerce Platforms

| Platform | Detection Patterns |
|----------|-------------------|
| **VTEX** | `vtex` in script src, `vteximg.com.br`, `/_v/`, `vtexcommercestable`, `window.__RUNTIME__` |
| **Shopify** | `cdn.shopify.com`, `Shopify.theme`, `myshopify.com`, `shopify-section` |
| **Magento** | `mage/`, `Magento_`, `requirejs-config`, `static/version` |
| **WooCommerce** | `woocommerce`, `wc-ajax`, `wp-content`, `cart-contents` |
| **Salesforce CC** | `demandware`, `dw/shop`, `sfcc` |
| **deco.cx** | `deco-sites`, `fresh.gen.ts`, `deco.cx` |
| **VNDA** | `vnda.com.br`, `cdn.vnda.com.br` |
| **Nuvemshop** | `nuvemshop`, `tiendanube`, `d26lpennugtm8s.cloudfront.net` |
| **Tray** | `tray.com.br`, `traycorp` |
| **Linx Commerce** | `linxcommerce`, `linx.com.br` |

### Analytics & Tracking

| Tool | Detection Patterns |
|------|-------------------|
| **GA4** | `gtag.js`, `G-XXXXXXX`, `googletagmanager.com/gtag` |
| **Adobe Analytics** | `omniture`, `s_code`, `AppMeasurement` |
| **Hotjar** | `hotjar.com`, `hjSiteSettings` |
| **FullStory** | `fullstory.com`, `_fs_debug` |
| **Heap** | `heap-api`, `heapanalytics` |
| **Clarity** | `clarity.ms` |

### CRO & Personalization

| Tool | Detection Patterns |
|------|-------------------|
| **Insider** | `useinsider.com`, `ins-global` |
| **CrazyEgg** | `crazyegg.com`, `ceScript` |
| **Optimizely** | `optimizely.com`, `optimizelyEndUserId` |
| **VWO** | `visualwebsiteoptimizer` |
| **Dynamic Yield** | `dynamicyield.com`, `DY.` |

### Product Analytics

| Tool | Detection Patterns |
|------|-------------------|
| **Mixpanel** | `mixpanel.com`, `mixpanel.init` |
| **Amplitude** | `amplitude.com`, `amplitude.init` |
| **Segment** | `cdn.segment.com`, `analytics.identify` |

### Tag Management

| Tool | Detection Patterns |
|------|-------------------|
| **GTM** | `googletagmanager.com/gtm.js`, `GTM-`, `dataLayer` |
| **Tealium** | `tealium.com`, `utag.js` |

### Chat & Support

| Tool | Detection Patterns |
|------|-------------------|
| **Zendesk** | `zopim`, `zendesk.com`, `ze-snippet` |
| **Intercom** | `intercom.io`, `intercomSettings` |
| **JivoChat** | `jivosite.com`, `jivo_` |
| **Tidio** | `tidio.co` |

### Payments

| Tool | Detection Patterns |
|------|-------------------|
| **Mercado Pago** | `mercadopago.com`, `sdk.mercadopago.com` |
| **PagSeguro** | `pagseguro`, `stc.pagseguro.uol.com.br` |
| **Adyen** | `adyen.com`, `adyen-checkout` |
| **Stripe** | `js.stripe.com`, `Stripe(` |

### Search & Recommendations

| Tool | Detection Patterns |
|------|-------------------|
| **Algolia** | `algolia.com`, `algoliasearch` |
| **Linx Impulse** | `linximpulse`, `neemu`, `chaordic` |

### Advertising Pixels

| Tool | Detection Patterns |
|------|-------------------|
| **Facebook Pixel** | `fbq(`, `connect.facebook.net`, `fbevents.js` |
| **TikTok Pixel** | `analytics.tiktok.com`, `ttq.load` |
| **Google Ads** | `googleads.g.doubleclick.net`, `AW-` |
| **Criteo** | `criteo.com`, `criteo_q` |
| **RD Station** | `rdstation.com`, `d335luupugsy2.cloudfront.net` |

---

## API Reference

### BuiltWith (Free tier: 100 calls/month)

```
GET https://api.builtwith.com/free1/api.json?KEY={BUILTWITH_API_KEY}&LOOKUP={domain}
```

Returns: `Results[].Result.Paths[].Technologies[]` with `Name`, `Tag`, `FirstDetected`, `LastDetected`.
Also returns: `Spend` (estimated monthly tech spend), `SalesRevenue` (estimated monthly sales).

### DataForSEO Domain Technologies ($0.01/call)

```
POST https://api.dataforseo.com/v3/domain_analytics/technologies/domain_technologies/live
Authorization: Basic {base64(login:password)}
Body: [{"target": "{domain}"}]
```

Returns: `tasks[].result[].items[].technologies_data[]` grouped by category.

### DataForSEO Whois ($0.10/call)

```
POST https://api.dataforseo.com/v3/domain_analytics/whois/overview/live
Authorization: Basic {base64(login:password)}
Body: [{"target": "{domain}"}]
```

Returns: registrant, creation date, expiration date, registrar, name servers.

### SimilarWeb Traffic API

Base: `https://api.similarweb.com/v1/website/{domain}`
Auth: `?api_key={SIMILARWEB_API_KEY}` or header `api-key: {key}`

| Endpoint | Returns |
|----------|---------|
| `/total-traffic-and-engagement/visits` | Monthly visits |
| `/total-traffic-and-engagement/bounce-rate` | Bounce rate |
| `/total-traffic-and-engagement/pages-per-visit` | Pages/visit |
| `/total-traffic-and-engagement/average-visit-duration` | Avg duration |
| `/traffic-sources/overview` | Direct/search/social/referral/mail/display split |
| `/traffic-sources/search-organic` | Top organic keywords |
| `/traffic-sources/search-paid` | Top paid keywords |
| `/traffic-sources/social` | Social breakdown |
| `/traffic-sources/referrals` | Top referring sites |
| `/geo/traffic-by-country` | Country distribution |

Common params: `start_date=2025-01&end_date=2025-12&country=br&granularity=monthly`

### Apify Actors for Retail Intelligence

| Purpose | Actor ID | Key Input |
|---------|----------|-----------|
| Instagram profile | `apify/instagram-profile-scraper` | `{"usernames": ["handle"]}` |
| Facebook page | `apify/facebook-pages-scraper` | `{"startUrls": [{"url": "..."}]}` |
| TikTok profile | `clockworks/tiktok-profile-scraper` | `{"profiles": ["handle"]}` |
| YouTube channel | `streamers/youtube-channel-scraper` | `{"channelUrls": ["..."]}` |
| Facebook/IG Ads | `apify/facebook-ads-scraper` | `{"searchQuery": "name", "countryCode": "BR"}` |
| Google Maps stores | `compass/crawler-google-places` | `{"searchStringsArray": ["name"], "countryCode": "br"}` |
| Google Trends | `apify/google-trends-scraper` | `{"searchTerms": [...], "geo": "BR"}` |

Run pattern:
```bash
SKILL_PATH=.agents/skills/apify-ultimate-scraper
node --env-file=.env $SKILL_PATH/reference/scripts/run_actor.js \
  --actor "ACTOR_ID" \
  --input 'JSON_INPUT' \
  --output "data/output.json" \
  --format json
```

### Confidence Levels

- **Confirmed**: Detected by 2+ sources (BuiltWith + DataForSEO + HTML)
- **Likely**: Detected by 1 API source
- **Inferred**: Detected only via HTML patterns or estimated from indirect signals
