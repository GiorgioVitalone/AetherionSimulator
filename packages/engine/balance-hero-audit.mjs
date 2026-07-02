// balance-hero-audit.mjs — §13b static hero-kit audit: every hero side's
// abilities with activation COST, COOLDOWN, once-per-game flag, trigger type,
// and the §13-corrected abilityContribution value. The affordability context:
// heroes flip at measured turn ~29–33 (§12c), when the Resource Deck has been
// empty for ~15 turns and income is Reserve taps + temporaries — an expensive
// transformed active may be strong on paper and unpayable in practice.
//
// Pure static read (no sims). Usage:
//   AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json node balance-hero-audit.mjs
import { readFileSync } from 'node:fs';
import { indexFromRaw, toStatic } from './balance-data.mjs';
import { abilityContribution } from './dist/balance/index.js';

const SRC = process.env.AETHERION_CARDS;
if (!SRC) {
  console.error('AETHERION_CARDS required (no silent default) — e.g. AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const byId = new Map(raw.map((c) => [c.id, c]));

const heroes = raw.filter((c) => c.cardType === 'H');
const transformOf = (hero) => raw.find((c) => c.cardType === 'T' && c.originalHeroId === hero.id);

function abilityRow(ab, i) {
  const dsl = ab.dsl || {};
  const trig = dsl.trigger || {};
  const kind = dsl.type === 'aura' ? 'aura' : trig.type || dsl.type || '?';
  const cost = trig.cost || ab.cost || {};
  const costTotal = (cost.mana || 0) + (cost.energy || 0) + (cost.flexible || 0);
  const cd = trig.cooldown ?? ab.cooldown ?? null;
  const once = trig.oncePerGame === true;
  const value = dsl.effects || dsl.type ? +abilityContribution(dsl).toFixed(2) : 0;
  return { i, name: (ab.effect || '').split(':')[0], kind, costTotal, cd, once, value };
}

function printSide(label, card) {
  console.log(`  ${label}: ${card.name}`);
  const sc = toStatic(card);
  void sc;
  (card.abilities || []).forEach((ab, i) => {
    const r = abilityRow(ab, i);
    const bits = [
      `#${r.i}`,
      r.kind.padEnd(14),
      r.costTotal ? `cost ${r.costTotal}` : 'free  ',
      r.cd != null ? `cd ${r.cd}` : '     ',
      r.once ? 'ONCE/GAME' : '         ',
      `value ${String(r.value).padStart(6)}`,
    ];
    console.log(`    ${bits.join('  ')}  ${r.name.slice(0, 58)}`);
  });
}

console.log(`Hero-kit audit (§13b) — pool: ${SRC}`);
console.log('value = §13-corrected abilityContribution (effect sum × recurrence; activation cost NOT netted — flagged instead)\n');
for (const h of heroes) {
  console.log(`${h.alignment.join('/')} — ${h.name}`);
  printSide('base', h);
  const t = transformOf(h);
  if (t) printSide('TRANSFORMED', t);
  console.log();
}
void indexFromRaw;
void byId;
