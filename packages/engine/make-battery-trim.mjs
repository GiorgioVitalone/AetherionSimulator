// make-battery-trim.mjs — §13i: the Verdant tap-loop feeder trim (deck-side, data-only).
//
// §13h verdict: the hero axis is spent; the remaining +17–19pp is the tap loop.
// This trims its two cheapest ignition feeders:
//   - Bio-Seedling (104) 0E → 1E: the turn-1 FREE Reserve tapper, ×3 copies —
//     the one battery piece the corrected formula flags over (+0.7 at the 0 line).
//   - Sprout (116) 2E → 3E: battery payback 2 → 3 turns. Formula-fair at 2E, so
//     this is a documented measurement-driven outlier (the Echoes precedent).
// Pure: deep-clone in, {raw, changed} out. Guards pin the expected pre-state.
export function applyBatteryTrim(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changed = [];
  const bump = (id, name, fromE, toE) => {
    const c = byId.get(id);
    if (!c || c.name !== name) throw new Error(`battery trim: card ${id} is not ${name}`);
    if (c.cost.energy !== fromE || c.cost.mana !== 0) {
      throw new Error(`battery trim: ${name} cost changed upstream (expected ${fromE}E, got ${JSON.stringify(c.cost)})`);
    }
    c.cost.energy = toE;
    changed.push(`${name} — cost ${fromE}E → ${toE}E`);
  };
  bump(104, 'Bio-Seedling', 0, 1);
  bump(116, 'Sprout', 2, 3);
  return { raw, changed };
}

// §13j round 2 — the LAST cheap-fodder holes (threshold escalation cancelled:
// engine recon showed Reserve taps never set Harvest's condition flag, so the
// battery is the flat 2-slot tap annuity + cheap Reserve bodies, not a Harvest
// loop; see §13j):
//   - Grovekeeper 3000 (142) 0E+X → 1E+X: the bot deploys X-cost cards at
//     X = spare (chooseXValue), so at 0E printed it is a FREE 1/1 Reserve tapper
//     exactly when resources are tight — the same hole Bio-Seedling 0E→1E closed.
//   - Biomass Surge (122) 3E → 4E: two tappers for 3E was the strongest remaining
//     battery rate (payback 1.5 turns → 2). Formula-under at 4E — documented
//     measurement-driven outlier (Echoes precedent).
export function applyBatteryTrim2(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changed = [];

  const grove = byId.get(142);
  if (!grove || grove.name !== 'Grovekeeper 3000') throw new Error('battery trim 2: card 142 is not Grovekeeper 3000');
  // Card-level cost is the plain shape; the X half lives on the ability cost
  // (xEnergy) and the bot's X detection on the 'x_cost' tag (chooseXValue pays
  // card base + X). Raising the printed base to 1E makes X=0 deploys cost 1E.
  if (grove.cost.energy !== 0 || grove.cost.mana !== 0 || !grove.tags.includes('x_cost')) {
    throw new Error(`battery trim 2: Grovekeeper shape changed upstream (${JSON.stringify(grove.cost)}, tags ${JSON.stringify(grove.tags)})`);
  }
  grove.cost.energy = 1;
  changed.push('Grovekeeper 3000 — cost 0E+X → 1E+X');

  const biomass = byId.get(122);
  if (!biomass || biomass.name !== 'Biomass Surge') throw new Error('battery trim 2: card 122 is not Biomass Surge');
  if (biomass.cost.energy !== 3 || biomass.cost.mana !== 0) {
    throw new Error(`battery trim 2: Biomass Surge cost changed upstream (${JSON.stringify(biomass.cost)})`);
  }
  biomass.cost.energy = 4;
  changed.push('Biomass Surge — cost 3E → 4E');

  return { raw, changed };
}
