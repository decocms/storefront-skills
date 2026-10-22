# Process — freeze, sync, parity, cutover

Most go-live pain was not code. It was code or content changing on the legacy
side while the candidate was being validated, or a cutover step done in the
wrong order.

---

## Code freeze and reconcile

**What happened:** on Miess the client kept shipping to the Fresh repo after the
candidate was validated; on cutover the TanStack site was "desynced". On Farm
there was no freeze for a month and 4–5 features had to be pulled from commit
history; after go-live, ports of `farmrio#2178/#2180/#2181` and a never-ported
search A/B variant (BytePlus `/buscarAB`) still trickled in.

- [ ] Agree a **freeze date** with the client in writing: from that day until go-live, no code on the legacy repo.
- [ ] Record `FREEZE_SHA` (legacy `main` at the freeze).
- [ ] Run a final reconcile from the migration cut to `FREEZE_SHA` — the **tools-reconcile-snapshot** skill (`deco-reconcile`) gives one diff per changed file. Port by hand; skip generated files (`static/tailwind.css`) and `.deco/blocks/*.json` (they arrive via content sync).
- [ ] After go-live, keep a watch on the legacy repo: anything merged there is a port ticket (`port da <repo>#<n>`).

```bash
git -C <legacy-repo> log --oneline <CUT_SHA>..origin/main -- . ':!.deco/blocks' ':!static'
```

## Content sync

The `.deco` content sync from the legacy site runs **on a schedule**, not on
publish. If it runs at 07:00 and the content team publishes at 08:00, a 09:00
go-live ships without the 08:00 edits.

- [ ] Know the schedule and trigger a manual sync right before cutover (after the content team's last publish).
- [ ] Check the sync bot token is valid (Farm's had expired).
- [ ] After every sync, run the schema check (`npm run check:schema` or equivalent) — a sync of props that no longer match the component breaks the page.
- [ ] Decide what happens to the sync after go-live. On Monte Carlo the legacy rsync kept running and **overwrote 21 blocks** edited in the new CMS. Turn it off at go-live, or make it one-way and audited.
- [ ] Fix content problems **in code at the seam** (guard, default, cap), not in `.deco/blocks` JSON — the next sync overwrites the JSON.

## Structural parity (five criteria)

AI ports have freedom to rebuild components "their way". On Farm, schemas were
changed and then the content sync broke pages, because the component worked
one way on legacy and another on TanStack. Rule: **content stays exactly the
same and components keep the same interface as production.**

1. **HTML isomorphism** — same semantic structure, landmarks, headings, `rel`/prefetch attributes, `data-*` used by tags.
2. **Section schema** — same props, same names, same types, same defaults. Diff the generated schema of each section against legacy.
3. **Wiring** — every prop actually reaches the DOM; loaders referenced by blocks are registered (a dangling `__resolveType` resolves to `null` silently — grep logs for "dangling").
4. **Behavior** — interaction and state on desktop and mobile (open/close, add to cart, filters, forms).
5. **Visual** — spacing, layout, icons, animation (pixel diff per section; see **hardcoded-to-blocks** → Verification).

```bash
# dangling resolveTypes: every __resolveType in blocks must exist in the manifest
grep -rhoE '"__resolveType":\s*"[^"]+"' .deco/blocks | sort -u > /tmp/used.txt
```

## CMS pass

Do it **before** go-live (it was done after on the first stores): one hour with
the people who edit the site. Goal is not training; it is confirming that the
props they edit are editable, the loaders they pick still exist and the preview
works. See **cms-friendly-props**.

## Inventory of what was not ported

- [ ] List integrations disabled or stubbed in the port (e.g. Dito, back-in-stock, try-on, virtual fitting room) and get the client to sign off.
- [ ] List the client's **running A/B tests** (VWO, GA, search vendors). Any variant whose code only exists on legacy (`pages-*AB` blocks, special routes) must be ported or paused before go-live.
- [ ] Grep the legacy repo for `hx-on:` handlers and inline behaviors — each one must exist in the port (Farm's empty-tag box was hidden by an unported `hx-on:click`).

---

## Cutover day

The go-live pattern is an **A/B proxy at 0%** on the production worker, not a
separate URL: traffic goes through the worker, all of it to legacy, and the
team tests the TanStack bucket on the real domain (login, checkout, GTM) with a
forced cookie. If something breaks, it breaks when the proxy is turned on, not
when the ratio goes to 1%.

1. **Deploy freeze** for the window. Each deploy changes the build hash, which empties every loader cache, and leaves old tabs with 404 chunks.
2. **KV key first, then the route.** Creating the route before the KV config exists sends traffic to a worker that doesn't know where to send it.
3. **Smoke with the bucket forced** to each side (`_deco_bucket=worker:0` / legacy): home, PLP, PDP, search, login, cart, checkout, legacy landing pages, redirects, `robots.txt`, sitemap, GTM/server-side GTM.
4. **Check proxies** the site already has (checkout, `/api`, `/_v`, media). On Casa e Vídeo the A/B routing broke existing proxies.
5. **Warm the cache** by fetching **pages** (not only loaders — loader warm-up does not warm HTML), with a mobile and a desktop UA, for the top URLs (home, top PLPs, top PDPs from analytics). First visitors on a cold site are slow and the client notices.
6. **Traffic ladder** with explicit gates between steps (1% → 10% → 50% → 100%). At each step watch: `wrangler tail` errors, `X-Cache` hit rate, 5xx vs legacy, memory, conversion per bucket in GA.
7. **Rollback** written down and rehearsed: ratio `0` in KV, or remove the route. If the A/B wrapper was removed (Farm T-ABREMOVE), rollback is a git revert + deploy — know which one you have.
8. **Content deploy**: if it is enabled on the day, re-test everything that reads content (search vendor, proxies, SEO) — enabling it exposed a latent Algolia bug on Granado. Measure how long a publish takes to show up (the worker polls; legacy was instant) and tell the client.

```bash
# warm-up: pages, both devices
while read -r path; do
  for ua in "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148" \
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/139 Safari/537.36"; do
    curl -s -o /dev/null -A "$ua" -w "%{http_code} %{time_total}s $path\n" "https://$HOST$path"
  done
done < top-urls.txt
```

## First 72 hours

- Compare every metric with the **same hour yesterday on legacy**, not with earlier the same day (traffic shape changes by hour).
- When removing an endpoint (telemetry, beacon), keep it answering for at least the **HTML cache TTL** — cached pages still call it.
- Rollout order for flags in KV: deploy the code that reads the new default first, then remove the KV key.
- Path-filter or drop CI jobs that wait on the Cloudflare build (Farm's per-PR perf job cost 3,300 min/month and was deleted).
- Keep porting legacy drift (see freeze above).
