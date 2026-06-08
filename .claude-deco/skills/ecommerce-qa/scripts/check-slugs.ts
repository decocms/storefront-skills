#!/usr/bin/env bun
/**
 * Slug contract check for the `deco-ecommerce-qa` skill.
 *
 * The skill is the *consumer* half of the @decocms/qa `data-qa-*` contract, and
 * unlike the engine (which freezes its surface in cli.surface.test.ts) the skill
 * can silently drift. This guards the slugs the skill documents against the
 * engine's real `list-slugs` output:
 *
 *   FAIL (exit 1) — the skill documents a slug the engine doesn't know
 *                   (typo / rename / stale snapshot). The contract is a lie.
 *   WARN (exit 0) — the engine has a slug the skill doesn't document yet
 *                   (tolerable lag — the snapshot is allowed to trail, just not lie).
 *
 * Bump ENGINE_REF when you deliberately update the skill's slug snapshot to a
 * newer engine. Run from the skill dir: `bun scripts/check-slugs.ts`
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_REF = process.env.ENGINE_REF ?? "0.5.1";
const SKILL_DIR =
  process.env.SKILL_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..");

// Tokens that match the slug regex but are NOT canonical engine slugs:
const NON_SLUG_MENTIONS = new Set([
  "data-qa-conventions", // the filename references/data-qa-conventions.md
  "data-qa-pdp-variants", // a historical NEGATIVE example (the older wrong guess), kept as a teaching note
]);

const SLUG_RE = /data-qa-[a-z0-9-]+/g;
// A trailing "-" means the regex truncated a wildcard/placeholder
// ("data-qa-minicart-*", "data-qa-quantity-*", "data-qa-<slug>") — not a real slug.
const isPlaceholder = (tok: string) => tok.endsWith("-");

function documentedSlugs(): Set<string> {
  const files = [join(SKILL_DIR, "SKILL.md")];
  const refDir = join(SKILL_DIR, "references");
  for (const f of readdirSync(refDir)) if (f.endsWith(".md")) files.push(join(refDir, f));

  const found = new Set<string>();
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(SLUG_RE)) {
      const tok = m[0];
      if (!isPlaceholder(tok) && !NON_SLUG_MENTIONS.has(tok)) found.add(tok);
    }
  }
  return found;
}

function engineSlugs(): Set<string> {
  let out: string;
  try {
    out = execFileSync("bunx", [`@decocms/qa@${ENGINE_REF}`, "list-slugs"], { encoding: "utf8" });
  } catch (e) {
    console.error(`✗ could not run \`bunx @decocms/qa@${ENGINE_REF} list-slugs\` (infra error, not a contract failure):`);
    console.error(`  ${(e as Error).message ?? e}`);
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    console.error(`✗ list-slugs did not return JSON:\n${out}`);
    process.exit(2);
  }
  if (!Array.isArray(parsed)) {
    console.error(`✗ list-slugs JSON is not an array of slugs`);
    process.exit(2);
  }
  return new Set(parsed as string[]);
}

const documented = documentedSlugs();
const engine = engineSlugs();

const lies = [...documented].filter((s) => !engine.has(s)).sort();
const undocumented = [...engine].filter((s) => !documented.has(s)).sort();

console.log(`engine @${ENGINE_REF}: ${engine.size} slugs · skill documents: ${documented.size}`);

if (undocumented.length) {
  console.log(`\n⚠ engine slugs the skill doesn't document yet (tolerable lag — consider adding):`);
  for (const s of undocumented) console.log(`  - ${s}`);
}

if (lies.length) {
  console.error(`\n✗ FAIL — the skill documents slugs the engine @${ENGINE_REF} does not know:`);
  for (const s of lies) console.error(`  - ${s}`);
  console.error(`\nFix the typo, or — if you bumped the engine — update ENGINE_REF and the skill's snapshot.`);
  process.exit(1);
}

console.log(`\n✓ OK — every slug the skill documents exists in engine @${ENGINE_REF}.`);
