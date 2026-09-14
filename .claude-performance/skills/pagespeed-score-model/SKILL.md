---
name: pagespeed-score-model
description: "Use when acting on a PageSpeed Insights or Lighthouse score rather than on one metric — deciding which of LCP, TBT, CLS, FCP or Speed Index is actually worth the next change, building a byte budget for LCP, explaining why a fix that improved one metric lowered the score, judging whether a target score is reachable at all, or telling a real win apart from machine noise. Covers the mobile score weights, the Lantern simulation model that makes LCP predictable from bytes, the attribution procedure that separates first-party from third-party cost, and the dead ends that were measured and rejected."
---

# The PageSpeed score model

A score is a weighted sum, and a lab score is a **simulation**, not a
measurement. Both facts change which work is worth doing. This skill is for
acting on the score; the per-metric skills do the fixing.

## What the score is made of

Mobile weights, Lighthouse 12:

| Metric | Weight |
|---|---|
| TBT | 30% |
| LCP | 25% |
| CLS | 25% |
| FCP | 10% |
| Speed Index | 10% |

So a 90 needs roughly **LCP ≤ 2.5 s and TBT ≤ 300 ms**, with CLS at 0. Two
consequences worth internalising before touching anything:

- **A change that improves FCP and worsens LCP is usually a net loss** — 10%
  against 25%. See the inlined-CSS case below, which is exactly that trade.
- **CLS is a quarter of the score and is usually free to fix.** If it is not 0,
  it is the cheapest 25 points on the page.

## Step 1 — attribute before changing anything

Never act on a raw score. Block at the network layer and re-measure; the deltas
say who owns the problem. A real storefront home page, mobile:

| Configuration | Score | FCP | LCP | TBT | CLS |
|---|---:|---:|---:|---:|---:|
| production, as found | **57** | 1,693 ms | 4,738 ms | 1,277 ms | 0 |
| + third-party tags blocked | 70 | 1,683 ms | 5,114 ms | 386 ms | 0 |
| + all own JS chunks blocked too | 88 | 1,598 ms | 3,455 ms | 190 ms | 0 |

Read it as: the whole TBT problem was third-party (1,277 → 386 ms), and LCP was
**ours** and survived even with every byte of our own JavaScript removed. Those
are two different work streams, and doing them in the wrong order wastes weeks.

Run the same split on desktop before concluding anything about it. Desktop uses
a 10 Mbps Lantern link and 1× CPU, so the same page's bytes cost almost nothing:
the same site sat at 77 with tags and **98** without — never an LCP problem at
all, entirely the container.

## Step 2 — the Lantern model makes LCP predictable

Lighthouse's default throttling is **simulated**. Lantern builds a pessimistic
dependency graph of everything that loaded before the **observed** LCP, then
replays it over a 1.6 Mbps (~200 KB/s) / 150 ms-RTT link with a 4× CPU
multiplier. On a page whose real LCP is fast, effectively the whole page is
inside that graph.

Which gives a model accurate to ~10% in practice:

```
LCP ≈ TTFB + (bytes before observed LCP) / 200 KB/s
```

So **LCP is a byte budget**. A 90 needs LCP ≤ 2.5 s, i.e. **≤ 377 KB before the
LCP paints**.

Build the budget by category from the trace, not by guessing:

```
requests before observed LCP: 63 of 64      total 771 KB
  document 93 KB   images 281 KB   scripts 282 KB   fonts 51 KB   other 63 KB
```

Then decide per category. On that page: images went 281 → 106 KB by holding
below-fold sources until after the LCP painted; scripts were 282 KB of
**framework** (react-dom plus the router's client runtime), not application
code — an audit of every chunk the document loads found nothing that did not
belong on the page.

## Step 3 — say out loud when the target is unreachable

This is the part teams skip, and it is the most valuable output.

Same page, after the image work, ~595 KB before LCP. The remaining levers, each
with its verdict:

| Still on the table | KB | Verdict |
|---|---:|---|
| a banner's images | 43 | its `<picture>` is layout-bearing; blanking the `src` collapses the box |
| fonts | 51 | costs a warm-cache visitor their typography (see below) |
| icon sprite split | ~20 | the header needs those icons above the fold |
| session/cart validation | ~30 | changes when prices and the cart reconcile |
| application JS | 0 | audited; nothing left to cut |

Taking **all** of them lands at ~450 KB, i.e. LCP ≈ 2.9 s — still short of 2.5,
and every one of them trades something a real shopper has for a number a lab
reports.

The three structural causes there were not defects:

1. **A full-viewport (`h-dvh`) hero.** Nothing shares the fold with the LCP
   element, so everything else is below-fold decoration — which the browser
   prefetches anyway, since its lazy-loading distance threshold reaches roughly
   1,250 px past an 823 px viewport on a fast connection.
2. **282 KB of framework JavaScript before first paint.** Not application code.
3. **615 ms of simulated TTFB** — three round trips of connection setup at
   150 ms RTT, against a 20 ms actual server response.

Conclusion delivered as: **desktop ≥ 95, mobile ~70**, and moving mobile past
that is a design question (what shares the fold with the LCP element), not a code
one. A number with a reason beats a number with a promise.

Note the TTFB point specifically: a simulated TTFB in the hundreds of
milliseconds is usually **connection setup**, not a slow server. Check the real
server response time before optimising the backend for a lab metric.

## Step 4 — the noise floor

Ordinary hardware cannot resolve small differences. Repeating the **identical**
configuration four times on one machine produced TBT between 297 ms and 1,751 ms
and scores between 40 and 76 — and every swing tracked how contended the CPU
happened to be.

So:

- **Byte counts, request counts and "did this request happen at all" are
  unaffected by noise.** Prefer an assertion in those terms. "Zero requests to
  the tag manager's host across every run" is binary and holds; "TBT improved
  200 ms" on one run does not.
- Use 5+ runs and a median for any timing claim, and run a **control on the base
  branch** — several "regressions" turn out to be pre-existing.
- A local uncompressed preview is for deltas only, never absolutes.
- The keyless PSI API is quota-limited (`429 … 'Queries per day'`); closing a
  real LCP gap needs an API key or runs against a deployed preview.

## Measured dead ends — do not re-open without new data

Each of these looks obviously right and measured worse or neutral.

**Turning off inlined CSS.** The document was 527 KB raw / 88.6 KB gzip, and
310 KB of that was the same Tailwind bundle **twice** — once as a `<style>` in
`<head>`, once as a string inside the RSC flight payload that carries the
inlined stylesheet across client navigations. gzip's 32 KB window cannot
deduplicate copies that far apart. Turning the flag off:

| | document raw | document gzip | Score | FCP | LCP | TBT |
|---|---:|---:|---:|---:|---:|---:|
| inlined | 526,758 B | 88.6 KB | **72** | 1,671 ms | **4,046 ms** | 405 ms |
| not inlined | 206,346 B | **27.2 KB** | 69 | **1,445 ms** | 4,438 ms | 502 ms |

The bytes went where they should and FCP improved ~226 ms — but the
render-blocking `<link>` it reintroduces joins the LCP graph, and LCP is worth
25% against FCP's 10%. **Net negative; the flag stays on.** Record findings like
this so the duplication is not rediscovered as if it were new.

**Deferring `@font-face` past the LCP.** With `font-display: optional` a cold
visitor already paints in the fallback, so the only visitor the deferral changes
is the one with a **warm** cache — who gets the real face on first paint today
and would start losing it. Trading a returning shopper's typography for a lab
metric is the wrong direction. (Do keep `preload: false` + `display: optional`:
a font that finishes before first paint is charged into the simulated LCP.)

**Tightening lazy-loading with an IntersectionObserver.** To pull images out of
the pre-LCP window its `rootMargin` would have to be **tighter than the
browser's own adaptive threshold**, which means a shopper on a slow connection
waits longer than today. The change that works moves the trigger **later in the
page's lifecycle**, not nearer the viewport: hold the source until the LCP has
painted, then release and let the browser's ordinary lazy rules take over — and
open the gate on first scroll or pointer input too, so a fast scroller never
waits on a paint heuristic.

**Detecting the lab agent.** There is nothing left to detect: no
`Chrome-Lighthouse` token (removed precisely so sites cannot branch on it) and
`navigator.webdriver` is `false` because the launcher does not pass
`--enable-automation`. Verified against a probe page that reports its own
runtime. Stop needing the sniff instead — if a gate exists only to deliver one
event for input-less sessions, deliver it on `visibilitychange`/`pagehide`.

## INP is not in the score, and still matters more

PSI's score is load-time. INP is a **field** metric, measured after the shopper
interacts, and a lab run leaves it empty. Measure it by driving real taps under
4× CPU throttling, with and without third-party hosts blocked:

| Interaction | With tags | Blocked | Third-party share |
|---|---:|---:|---:|
| PLP — open filters | 992 ms | 176 ms | 816 ms |
| PDP — add to cart | 392 ms | 144 ms | 248 ms |
| PDP — select size | 344 ms | 152 ms | 192 ms |
| Home — open mobile menu | 232 ms | 112 ms | 120 ms |

Two thirds to five sixths of it is third-party execution on every interaction.
And a session-recording tag that re-processes DOM mutations means **every
re-render the storefront performs is paid for a second time** inside that
vendor — so cutting mutations helps twice.

A lab run that only loads the page measures a storefront that does not exist for
an engaged shopper: if tags are gated behind a first-gesture engagement gate, the
whole tag stack is absent until input. Drive the taps.

## Procedure

1. Run the attribution split (as found → third-party blocked → own JS blocked),
   mobile and desktop.
2. Rank by weight × headroom, not by which number looks worst.
3. For LCP, build the byte budget by category and state the target in KB.
4. Fix, then re-measure with the same instrument — and revert anything that did
   not move the metric it was supposed to move.
5. If the budget says the target is out of reach, say so with the table, and name
   what a design change would have to give up to get there.

## Related

`client-js-budget` (TBT and INP — the main thread), `image-optimizer` and
`images` (the largest LCP category on most storefronts), `html-size-optimizer`
(first-byte HTML), `cache` (TTFB and delivery). CLS has its own dedicated
treatment — this skill only weighs it.
