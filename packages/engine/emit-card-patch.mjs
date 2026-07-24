// emit-card-patch.mjs (Part B) — produce the card-balance SQL + fixture patch from the
// confirmed balanced pool, against the RAW baseline. Absolute target stats/cost (never
// deltas — the DB is raw and baselines can differ). Fixture is serialized with Python's
// json.dump(indent=0) to byte-match the committed fixture so the patch is a clean
// per-card diff, not a whole-file replace.
//
// Usage: node emit-card-patch.mjs <confirmedPool.json> [outDir=../docs/patches]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENGINE = fileURLToPath(new URL('.', import.meta.url));
const poolPath = process.argv[2];
if (!poolPath) { console.error('usage: node emit-card-patch.mjs <confirmedPool.json> [outDir]'); process.exit(1); }
const outDir = process.argv[3] || new URL('../../docs/patches/', import.meta.url).pathname;
const FIXTURE = ENGINE + 'sim-data/aetherion-cards.json';
const baseline = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const pool = JSON.parse(readFileSync(poolPath, 'utf8'));

const byId = new Map(baseline.map((c) => [c.id, c]));
const num = (v) => (v == null ? 0 : v);
const FIELDS = [['stats', 'hp'], ['stats', 'atk'], ['stats', 'arm'], ['cost', 'mana'], ['cost', 'energy'], ['cost', 'flexible']];

const edits = [];
for (const p of pool) {
  const b = byId.get(p.id);
  if (!b) continue;
  const changes = [];
  for (const [col, key] of FIELDS) {
    const bv = num(b[col]?.[key]);
    const pv = num(p[col]?.[key]);
    if (bv !== pv) changes.push({ col, key, from: bv, to: pv });
  }
  if (changes.length) edits.push({ id: p.id, name: p.name, faction: (p.alignment || [])[0] || '?', changes });
}
edits.sort((a, b) => a.id - b.id);

// ── B1: SQL ─────────────────────────────────────────────────────────────
const sql = [
  `-- cards-balance-v2.sql — Aetherion starter-deck rebalance (skill-aware method)`,
  `-- Baseline: RAW "Cards" table (live DB export == sim-data/aetherion-cards.json).`,
  `-- Ruleset: ruleset-v1 (all 9 locked rules). Measured at the validated r8d3 rung via`,
  `-- paired comparison (common random numbers). Stats/cost are ABSOLUTE targets (idempotent).`,
  `-- ${edits.length} cards changed.`,
  ``,
  `BEGIN;`,
  ``,
];
for (const e of edits) {
  sql.push(`-- ${e.name} (id ${e.id}) [${e.faction}]: ${e.changes.map((c) => `${c.key} ${c.from}->${c.to}`).join(', ')}`);
  for (const c of e.changes) sql.push(`UPDATE "Cards" SET ${c.col} = jsonb_set(${c.col}, '{${c.key}}', '${c.to}') WHERE id = ${e.id};`);
  sql.push(``);
}
sql.push(`COMMIT;`, ``);

mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + 'cards-balance-v2.sql', sql.join('\n'));

// ── B2: fixture patch — patch the baseline in Python with json.dump(indent=0) so the
// output byte-matches the committed fixture's serialization, then git diff it. ──
const pyScript = `
import json, sys
base = json.load(open(${JSON.stringify(FIXTURE)}))
edits = json.load(sys.stdin)
byId = {c["id"]: c for c in base}
for e in edits:
    t = byId.get(e["id"])
    if t is None: continue
    for ch in e["changes"]:
        t.setdefault(ch["col"], {})[ch["key"]] = ch["to"]
json.dump(base, open(sys.argv[1], "w"), indent=0)
open(sys.argv[1], "a").write("\\n")
`;
const patchedPath = outDir + '.fixture-patched.json';
execFileSync('python3', ['-c', pyScript, patchedPath], { input: JSON.stringify(edits) });

let fixturePatch = '';
try {
  execFileSync('git', ['diff', '--no-index', '--no-color', '--src-prefix=a/packages/engine/', '--dst-prefix=b/packages/engine/', '--', 'sim-data/aetherion-cards.json', patchedPath], { cwd: ENGINE, encoding: 'utf8' });
} catch (err) { fixturePatch = err.stdout || ''; }
// git diff --no-index labels the temp file with its real path; rewrite the b/ header to the fixture path.
fixturePatch = fixturePatch
  .replace(new RegExp('diff --git a/packages/engine/sim-data/aetherion-cards.json b/packages/engine/' + patchedPath.replace(/[/.]/g, (m) => '\\' + m).replace(/\\/g, '')), '')
  .replace(new RegExp('b/packages/engine' + patchedPath.replace(/\//g, '/').replace(/[.[\]{}()*+?^$|]/g, '\\$&'), 'g'), 'b/packages/engine/sim-data/aetherion-cards.json')
  .replace(/\+\+\+ b\/.*/m, '+++ b/packages/engine/sim-data/aetherion-cards.json');
writeFileSync(outDir + 'aetherion-cards.fixture.patch', fixturePatch);

// ── Cross-check: patched fixture == pool on the stat/cost fields ──
const patched = JSON.parse(readFileSync(patchedPath, 'utf8'));
const poolById = new Map(pool.map((c) => [c.id, c]));
const mismatches = [];
for (const p of patched) {
  const q = poolById.get(p.id);
  if (!q) continue;
  for (const [col, key] of FIELDS) if (num(p[col]?.[key]) !== num(q[col]?.[key])) mismatches.push({ id: p.id, name: p.name, key, fixtureVal: p[col]?.[key], poolVal: q[col]?.[key] });
}
writeFileSync(outDir + 'cards-balance-v2.report.json', JSON.stringify({
  cardsChanged: edits.length,
  edits: edits.map((e) => `${e.name}(id ${e.id}): ${e.changes.map((c) => `${c.key} ${c.from}->${c.to}`).join(', ')}`),
  crossCheckMismatches: mismatches,
}, null, 1));

console.log(`cards changed: ${edits.length}`);
for (const e of edits) console.log(`  ${e.name} (id ${e.id}) [${e.faction}]: ${e.changes.map((c) => `${c.key} ${c.from}->${c.to}`).join(', ')}`);
console.log(`\ncross-check (patched fixture vs pool): ${mismatches.length} mismatches`);
if (mismatches.length) { console.log(JSON.stringify(mismatches.slice(0, 10), null, 1)); process.exitCode = 2; }
else console.log('OK — SQL + fixture agree exactly with the confirmed pool.');
console.log(`wrote ${outDir}cards-balance-v2.sql, aetherion-cards.fixture.patch, cards-balance-v2.report.json`);
