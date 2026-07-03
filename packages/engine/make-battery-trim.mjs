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
