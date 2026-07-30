# HTML Report Template

Single-page HTML report styled with the retailer's brand colors (Phase 1). Fall back to `#1a1a2e` / `#e94560` if branding extraction fails.

## Design System

- **Font**: `Inter` from Google Fonts, fallback `system-ui, sans-serif`
- **Layout**: Max `1200px`, centered, responsive grid
- **Cards**: `border-radius: 12px`, subtle `box-shadow`, white background
- **Section headers**: Left-colored border (4px) with brand primary color
- **KPIs**: Large number + label in accent-colored cards
- **Charts**: CSS bar charts or inline SVG (no JS chart libraries)
- **Responsive**: Single column mobile, 2-3 columns desktop

## Sections

### 1. Header
- Company logo (if URL found) or styled name
- Domain + report generation date
- One-line positioning summary
- Key KPIs row: Monthly Visits | Physical Stores | Instagram Followers | Domain Age

### 2. Executive Summary
3-4 sentence synthesis. The "elevator pitch" of the entire report.

### 3. Company Overview
Table: Company Name, Founded/Site Age (from Whois), HQ, Sector, E-commerce Platform, Tagline, Estimated Revenue (from BuiltWith if available).

### 4. Customer Personas
2-3 persona cards, each with:
- Archetype name (e.g. "Mãe Digital Conectada")
- Demographics: age, income, location
- Motivations: why they shop here
- Behavior: frequency, avg ticket, channel preference
- Evidence: supporting data points

### 5. Geographic Presence (Brazil)
- SVG map of Brazil with highlighted states OR city/state list
- Total physical stores (from Google Maps)
- Regional concentration analysis
- Distribution centers (if found)

### 6. Growth Strategy
Comparison layout:
- **Physical** — store count trend, expansion/contraction
- **Digital** — e-commerce, marketplace, app, social commerce
- **Sales Force** — seller programs, marketplace partners
- **Strategic Bets** — marketplace growth, private label, fintech

### 7. Digital Ecosystem

**Tech Stack Grid** — grouped by category, with confidence level:
| Category | Tool | Confidence | Source |
|----------|------|------------|--------|

**Conversion Tools** — highlight A/B testing, personalization, search, chat

**Advertising Pixels** — which ad platforms are tracking, indicating paid strategy

### 8. Traffic Analysis
- **Monthly visits** trend (bar chart)
- **Source breakdown** — horizontal stacked bar: Direct / Organic / Paid / Social / Referral / Email
- **Top organic keywords** (table)
- **Top paid keywords** (table, if running paid search)
- **Top referral sources** (table)
- **Traffic health narrative** — assessment of source balance

### 9. Social Media Presence
Card per platform (Instagram, Facebook, TikTok, YouTube):
- Follower count
- Engagement metrics
- Posting frequency
- Content strategy summary
- Active ads detected (yes/no + count)

### 10. Competitive Positioning
Visual scales (CSS colored bars) for each axis:
- **Price**: Premium <-----> Economic
- **Purchase**: Impulse <-----> Considered
- **Market role**: Leader <-----> Follower
- **Retention**: High <-----> Low
- **Digital maturity**: Advanced <-----> Basic

### 11. Recent News
Timeline cards for last 12 months:
- Date + Headline + Summary + Source link
- Category tag: M&A | Launch | Management | Expansion | Financial

### 12. Sources
All URLs and data sources referenced, grouped by section. Include API source (BuiltWith, DataForSEO, SimilarWeb, Apify) and confidence labels.

## Serving

```typescript
import report from "./<domain-slug>-report.html";

Bun.serve({
  port: 3000,
  routes: {
    "/": report,
  },
  development: { hmr: true, console: true },
});

console.log("Report available at http://localhost:3000");
```
