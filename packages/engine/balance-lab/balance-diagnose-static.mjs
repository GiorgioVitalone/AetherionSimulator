// balance-diagnose-static.mjs — static structural profile of the 4 starter decks.
// Joins decks -> cards and reports, per faction: hero LP/abilities, type mix, cost
// curve, raw stat totals + stat-for-cost, and keyword/effect density. Read-only.
import { readFileSync } from 'node:fs';
const cards = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
const decks = JSON.parse(readFileSync(new URL('./sim-data/aetherion-decks.json', import.meta.url)));
const byId = new Map(cards.map(c => [c.id, c]));
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const costOf = c => { const o = c.cost || {}; return (o.mana || 0) + (o.energy || 0) + (o.flexible || 0); };
const text = c => (c.abilities || []).map(a => `${a.effect || ''} ${JSON.stringify(a.dsl || {})}`).join(' ').toLowerCase() + ' ' + (c.traits || []).join(' ').toLowerCase() + ' ' + (c.tags || []).join(' ').toLowerCase();
const KW = {
  defender: /defender/, flying: /flying/, haste: /haste/, sniper: /sniper/, elite: /elite/,
  stealth: /stealth/, swift: /swift/, volatile: /volatile/, firstStrike: /first.?strike/,
  regen: /regenerat/, shield: /would take damage|reduce.*damage|shield|ward/, bulwark: /bulwark/,
  armBuff: /"arm"\s*:\s*[1-9]|\+\d*\s*arm|armor/, heal: /heal/, draw: /draw/, destroy: /destroy/,
  counter: /counter|"type"\s*:\s*"counter"/, recursion: /return_from_discard|return .*discard|from your discard/,
  damageSpell: /deal_damage|deal \d+ damage/,
};

for (const f of FACTIONS) {
  const deck = decks.find(d => d.faction === f);
  const hero = cards.find(c => c.cardType === 'H' && (c.alignment || []).includes(f));
  const list = (deck.mainDeckDefIds || []).map(id => byId.get(id)).filter(Boolean);
  const chars = list.filter(c => c.cardType === 'C');
  const sumAtk = chars.reduce((a, c) => a + (c.stats?.atk || 0), 0);
  const sumHp = chars.reduce((a, c) => a + (c.stats?.hp || 0), 0);
  const sumArm = chars.reduce((a, c) => a + (c.stats?.arm || 0), 0);
  const sumCost = chars.reduce((a, c) => a + costOf(c), 0);
  const curve = {}; for (const c of list) { const k = Math.min(costOf(c), 7); curve[k] = (curve[k] || 0) + 1; }
  const kwc = {}; for (const k of Object.keys(KW)) kwc[k] = list.filter(c => KW[k].test(text(c))).length;
  const types = { C: 0, S: 0, E: 0 }; for (const c of list) if (types[c.cardType] != null) types[c.cardType]++;

  console.log(`\n══ ${f} ══  Hero: ${hero?.name} — LP ${hero?.stats?.hp}`);
  if (hero) for (const a of hero.abilities || []) console.log(`   hero ability [${a.type}]: ${(a.effect || '').slice(0, 110)}`);
  console.log(`  Deck ${list.length} cards — C:${types.C} S:${types.S} E:${types.E}`);
  console.log(`  Curve (cost:count): ${Object.keys(curve).sort().map(k => `${k}:${curve[k]}`).join('  ')}`);
  console.log(`  Char bodies: ${chars.length} copies | ATK ${sumAtk} HP ${sumHp} ARM ${sumArm} | stat/cost ${(sumCost ? (sumAtk + sumHp + sumArm) / sumCost : 0).toFixed(2)} | ARM/body ${(sumArm / chars.length).toFixed(2)}`);
  console.log(`  Keywords/effects (deck copies): ${Object.entries(kwc).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join('  ')}`);
}
