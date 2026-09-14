---
name: client-js-budget
description: "Use when a storefront scores badly on Total Blocking Time or INP, when an interaction (opening filters, adding to cart, switching a tab, opening the menu) feels slow, when deciding whether a component needs JavaScript at all, or when a third-party tag (GTM, pixels, chat, anti-fraud) is suspected of eating the main thread. Covers how to attribute blocking time before changing anything, the CSS-first ladder that removes JS instead of deferring it, and the gating patterns that move a script off the critical path without losing the data it collects."
---

# Client JS budget — TBT and INP

TBT and INP are main-thread problems. Neither is fixed by making a file smaller;
both are fixed by **running less JavaScript at the moment the user is waiting**.
This skill is about which JavaScript, and when.

Out of scope here: layout stability (CLS), image weight (`image-optimizer`),
HTML payload (`html-size-optimizer`), caching (`cache`).

**Before this skill:** if you are acting on a whole PageSpeed score rather than
on the main thread specifically, read `pagespeed-score-model` first — it says
which metric is worth the next change, and TBT is only 30% of the answer.

## Attribute before you touch anything

A score is not a diagnosis. Block things at the network layer and re-measure —
the deltas tell you which side owns the problem.

A real storefront, mobile:

| Configuration | Score | TBT |
|---|---|---|
| production, as found | 57 | 1,277 ms |
| third-party tags blocked | 70 | 386 ms |
| + all first-party JS chunks blocked | 88 | 190 ms |

Read that as: ~900 ms of the blocking time was third-party, ~200 ms was ours.
Work the larger one first. The same measurement on another site found a single
anti-fraud script accounting for **93%** of TBT — one 935 ms long task.

For INP, measure the interaction, not the page. Throttle the CPU 4×, tap the real
control, and record with and without tags:

| Interaction | With tags | Tags blocked |
|---|---|---|
| PLP — open filters | 992 ms | 176 ms |
| PDP — add to cart | 392 ms | 144 ms |
| PDP — select size | 344 ms | 152 ms |

**One run is not a result.** Repeating an identical configuration on ordinary
hardware produced TBT anywhere from 297 ms to 1,751 ms and scores from 40 to 76.
Byte counts, request counts and "did this request happen at all" are stable;
timings are indicative. Prefer an assertion you can state in bytes or in
"this request no longer fires" over one stated in milliseconds.

Second-order cost worth knowing: a session-recording tag that re-processes DOM
mutations makes every re-render your storefront performs get paid for twice,
inside that vendor's script.

## The ladder — delete JS before deferring it

Work down. Stop at the first rung that holds.

**1. Does the behaviour need JS at all?** A large share of storefront
interactivity is native:

| Behaviour | No-JS implementation |
|---|---|
| Carousel scrolling, snapping, swipe | `overflow-x: auto` + `scroll-snap-type: x mandatory` + `scroll-smooth`, `scroll-px-*` so snap points clear the padding |
| Accordion / FAQ | `<details>` / `<summary>` |
| Drawer, filter panel, mobile menu open state | hidden checkbox + sibling/`peer` selectors |
| Hover effects, card lift, image swap, mega-menu flyout | `group-hover:` — gate it at `md:`/`lg:` so it never fires on touch |
| Tooltips, popovers | the `popover` attribute |
| Conditional layout from a sibling's state | `:has()` |
| Marquee, entrance animation, spinner | `@keyframes`; scroll-driven ones via `animation-timeline: view()` |

**2. If it needs JS, does it need to be an island?** Keep the markup server-rendered
and hydrate only the leaf that actually listens. The pattern that scales: the
server component emits plain HTML carrying data attributes (`data-slider`,
`data-slide="next"`, `data-dot={i}`), and one small island queries the DOM and
attaches behaviour. Arrow state and dots hydrate; the slides do not.

**3. If it must hydrate, when?** Four distinct gates, each with a different
release signal. Picking the wrong one is why an obvious fix measures worse:

| Gate | Releases on | Use for |
|---|---|---|
| near-viewport | `IntersectionObserver`, ~400 px margin | below-the-fold sections |
| after-LCP | first `largest-contentful-paint` entry + 2 rAF, or a fallback timer | images and work that must not compete with the hero paint |
| first engagement | pointerdown / pointermove / touchstart / keydown / scroll, or a long fallback | analytics and other tags no one is waiting for |
| idle prefetch | `load` **and** `requestIdleCallback({ timeout })` | a chunk needed by the *next* interaction |

Two gotchas that cost real time to find:

- A near-viewport gate is the wrong tool for "keep this out of the pre-LCP
  window". Tightening its margin below the browser's own threshold makes a
  shopper on a slow connection wait *longer*. Move the trigger later in the
  page's lifecycle, not closer to the viewport.
- The gate's state must start closed on the server **and** on the client.
  Seeding it from `typeof IntersectionObserver` is a guaranteed hydration
  mismatch, and React then re-creates every server-only node in that subtree —
  including inert `<script>` tags.

And release crawlers synchronously. A gated shelf that never opens for an indexer
means every product link in it is simply absent from the DOM the crawler reads.

## Third-party scripts

**`requestIdleCallback`'s `timeout` is a deadline, not a delay.** It fires as soon
as the browser goes idle, which on a page that settles quickly is about a second
— i.e. right inside the trace. Measured: a script wrapped in
`requestIdleCallback(init, { timeout: 7000 })` still produced 1,620 ms of TBT,
identical to no gate at all. Put the `setTimeout` **outside**:

```js
setTimeout(() => requestIdleCallback(init), DELAY_MS);
```

Better than a timer: release on the first real human gesture
(`pointerdown`/`touchstart`/`keydown`/`wheel`). A session that never gestures is
a bot or a bounce.

**`dataLayer.push` is a synchronous call into the container, not a queue write.**
One `add_to_cart` push can fire four tags inside the interaction that pushed it —
which is INP, directly. Defer delivery past paint with `requestAnimationFrame`
plus a nested `setTimeout`, through a single FIFO queue (order matters: analytics
attributes events to the last `page_view` it saw), with a per-job `try`/`catch` so
one broken vendor payload cannot swallow the events queued behind it. A microtask
does **not** work — microtasks drain inside the task that queued them.

**Stop writing lab-agent detection.** The emulated mobile user agent carries no
`Chrome-Lighthouse` token (removed precisely so sites cannot do this) and
`navigator.webdriver` is `false`. Nothing left in the runtime separates an audit
from a human who has not moved yet. If a gate exists only to deliver one event
for input-less sessions, deliver that event another way — send it on
`visibilitychange`/`pagehide` — and then the gate's fallback can be long.

This is not metric gaming, and the distinction matters: a real user releases the
gate on their first gesture, before anything they can perceive. But **verify the
data still arrives**. One storefront deferred its container without an exit
beacon and lost 36% of organic sessions in the reporting tool while actual
pageviews held flat.

**Evaluate proxying into a worker per script, not as policy.** One anti-fraud
vendor was left on the main thread on purpose because it reads canvas pixels for
fingerprinting — a degraded fingerprint is worse than the blocking time it costs.

**Some of the fix is not in the repo.** Duplicated container tags each pulling
their own ~150 KB copy of a vendor library, or fourteen tags on "All Pages" when
three need to be, can only be fixed in the tag manager's UI. Inventory the tags,
name the savings, and hand it to whoever owns the container.

## When the main thread is style, not script

If blocking time is dominated by style and layout rather than script evaluation,
deferring sections **moves work to the client and makes it worse** — measured, a
mobile score went 58 → 45 that way. The lever that works without touching the DOM
or the SSR response:

```css
main > div > section[data-section]:nth-of-type(n + 7) {
  content-visibility: auto;
  contain-intrinsic-size: auto 600px;
}
```

The `auto` keyword in `contain-intrinsic-size` makes the browser remember each
section's real size after its first render, which is what keeps this from costing
layout stability. Nothing leaves the DOM, the crawler sees the same HTML, and
hydration is unchanged.

## Bundle-level checks worth wiring into CI

Advisory first — a gate calibrated above the current value still catches
regressions, and can be tightened later:

```js
'resource-summary:script:size':  ['error', { maxNumericValue: 220 * 1024 }],
'resource-summary:script:count': ['warn',  { maxNumericValue: 20 }],
```

Then verify with the instrument that found the problem. Revert anything that did
not move the number it was supposed to move.

## Checklist

- [ ] Blocking time attributed first-party vs third-party by blocking and
      re-measuring — not guessed from a score.
- [ ] INP measured on the actual interaction under CPU throttling, not inferred
      from TBT.
- [ ] Every new interactive component checked against the CSS-first table before
      an island was written.
- [ ] Islands are leaves — the markup around them stays server-rendered.
- [ ] Each deferred thing uses the gate whose release signal matches why it is
      deferred; gate state starts closed on server and client alike; crawlers are
      released synchronously.
- [ ] `setTimeout` wraps `requestIdleCallback`, never the other way around.
- [ ] Analytics delivery is queued past paint, not pushed inside the handler.
- [ ] No lab-agent sniffing anywhere.
- [ ] After deferring a tag, the data it collects was confirmed still arriving.
- [ ] Result re-measured with the instrument that found it; anything that did not
      move was reverted.

## Related

`pagespeed-score-model` (score weights, the Lantern LCP byte budget, and when a
target is unreachable), `image-optimizer` and `images` (image weight and LCP candidates),
`html-size-optimizer` (first-byte HTML), `cache` and `cacheable-matchers`
(delivery), `new-section` (where interactivity is allowed to live).
