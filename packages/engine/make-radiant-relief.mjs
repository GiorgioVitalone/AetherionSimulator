// make-radiant-relief.mjs — §13q: formula-aligned Radiant relief, take 2.
//
// At the verdict layer Radiant sits at ~43 and its ENTIRE deficit is the
// Radiant-v-Verdant cell (34/66, §13p). The §13p queue's original prescription
// (1-cost cuts on the OVER-budget top-end: Shieldbearer/Protector/Faithkeeper)
// was VETOED by the card gate's static stage — those cards are +3.5/+6.0/+2.6
// over budget already and cutting cost pushes them further over (gate run
// 2026-07-10, FAIL static). The framework-consistent relief is the pricer's own
// BUFF arm: Radiant's two under-budget cards, brought toward budget by cost.
//   - Symphonic Banner (71) 4M → 3M: power 3.1 vs expected 5.4 (below the
//     tolerance floor 3.9) — the go-wide aura equipment. Lands "under by 0.8"
//     (FLAG/SIM-NEEDED on a synergy-cap note — Stage B's job).
//   - Archon of Order, Uriel (54) +1 HP (4/3/0 → 4/4/0): power 19.6 vs
//     expected 20.1 — in band. (A 7M→6M cost cut overshoots: the character
//     budget slope is ~4.8/cost, landing +3.3 OVER — gate-vetoed take 2.)
// Data-only edits (a printed cost, a printed stat line). First real client of
// the card gate (balance-card-gate.mjs, FOCUS=Radiant).
export function applyRadiantRelief(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changed = [];

  const banner = byId.get(71);
  if (!banner || banner.name !== 'Symphonic Banner') throw new Error('radiant relief: card 71 is not Symphonic Banner');
  if (banner.cost.mana !== 4 || banner.cost.energy !== 0) {
    throw new Error(`radiant relief: Symphonic Banner cost changed upstream (${JSON.stringify(banner.cost)})`);
  }
  banner.cost.mana = 3;
  changed.push('Symphonic Banner — cost 4M → 3M');

  const uriel = byId.get(54);
  if (!uriel || uriel.name !== 'Archon of Order, Uriel') throw new Error('radiant relief: card 54 is not Uriel');
  if (uriel.stats.hp !== 3 || uriel.stats.atk !== 4 || uriel.stats.arm !== 0) {
    throw new Error(`radiant relief: Uriel stats changed upstream (${JSON.stringify(uriel.stats)})`);
  }
  uriel.stats.hp = 4;
  changed.push('Archon of Order, Uriel — HP 3 → 4 (4/3/0 → 4/4/0)');

  return { raw, changed };
}
