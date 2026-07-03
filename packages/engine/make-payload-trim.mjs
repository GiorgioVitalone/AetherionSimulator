// make-payload-trim.mjs — §13k: the Verdant CONVERSION-payload trim (round 3).
//
// The §13i/§13j income thesis is measured dead: two rounds of fodder pricing
// moved the resource curve as predicted and the win rate not at all — and Onyx
// out-taps Verdant while sitting at parity. Income is not the binding
// constraint; conversion is. Verdant wins PRE-flip (winPctWhenNot 76–81 at
// rollouts) on tempo/card-advantage engines the formula is structurally quiet
// about (§12 Bucket D):
//   - Rampant Evolution (119) 3E → 4E: ×3 — destroy an ally, deploy from deck
//     at cost+1 (tutor-tempo; deploy_from_deck priced flat 4, novelty-flagged).
//   - Biotech Engineer (105) 3E → 4E: ×3 — "friendly gains stats → draw", fed
//     by every buff/X-sink in the deck (the card-advantage engine; its synergy
//     web is capped in the audit by design).
// Card-COST edits only (a spell and a character's printed cost — data). The
// aura's effect values are untouched.
export function applyPayloadTrim(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changed = [];
  const bump = (id, name, fromE, toE) => {
    const c = byId.get(id);
    if (!c || c.name !== name) throw new Error(`payload trim: card ${id} is not ${name}`);
    if (c.cost.energy !== fromE || c.cost.mana !== 0) {
      throw new Error(`payload trim: ${name} cost changed upstream (${JSON.stringify(c.cost)})`);
    }
    c.cost.energy = toE;
    changed.push(`${name} — cost ${fromE}E → ${toE}E`);
  };
  bump(119, 'Rampant Evolution', 3, 4);
  bump(105, 'Biotech Engineer', 3, 4);
  return { raw, changed };
}
