// make-verdant-trim.mjs — §13q take 5: the formula-aligned R-v-V fix, Verdant side.
//
// The compensated ratification panel failed ONE pre-registered criterion —
// pooled spread 10.6 vs ≤10 — and the entire overshoot is the Radiant v Verdant
// cell (32.9/67.1); Verdant is the top faction at 55.0. Takes 1–4 were all
// gate-rejected, and takes 3–4 taught the same lesson from both sides: under
// the 12-card income cap, a ±1 COST edit on a top-end card is QUANTIZED — the
// card drops out of (or into) the game's castability window entirely, swinging
// the Onyx (attrition) matchup ~15pp wholesale (take 3: Radiant buffs fixed
// R-v-V but collapsed R-v-O to 30; take 4: Guardian Spirit 6E→7E fixed V-v-R
// but collapsed V-v-O to 32). STAT power is continuous where cost windows are
// cliffs — so take 5 trims the same over-budget card by stats instead:
//   - Guardian Spirit MK-III (113) 5/5/0 → 4/5/0 (−1 ATK): power 20.0 → 19.0,
//     inside the tolerance ceiling 19.2; deploy timing and cast windows
//     untouched. (Pricer flag: the pool's only Verdant over-budget card and
//     the synergy hub behind two audit cap-notes.)
// Card-STAT edit only (printed ATK — data). Gate: FOCUS=Verdant.
export function applyVerdantTrim(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const c = raw.find((x) => x.name === 'Guardian Spirit MK-III');
  if (!c) throw new Error('verdant trim: Guardian Spirit MK-III not found');
  if (c.stats.atk !== 5 || c.stats.hp !== 5 || c.cost.energy !== 6) {
    throw new Error(`verdant trim: Guardian Spirit MK-III changed upstream (${JSON.stringify(c.stats)} ${JSON.stringify(c.cost)})`);
  }
  c.stats.atk = 4;
  return { raw, changed: ['Guardian Spirit MK-III — ATK 5 → 4 (5/5/0 → 4/5/0)'] };
}
