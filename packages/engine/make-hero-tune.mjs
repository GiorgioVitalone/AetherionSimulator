// make-hero-tune.mjs — §13e: the hero three-window tune + the Grovekeeper data fix.
//
// applyHeroTune: cost/cooldown KNOBS ONLY (every one engine-enforced — activated
// costs/cooldowns via available-actions' onCooldown + the activation payment
// path; passive-trigger wrapper cooldowns via trigger-registry rate limits).
// No effect redesigns. Targets the three §13e windows on the frozen CURRENT:
//   W1 normal ±25% | W2 transform ±25% + impact floor ≥10 | W3 composite
//   (0.66·base + 0.33·transform) ±10%, all four heroes PASS.
//
// applyGrovekeeperFix: hand-fix for the id-142 data stub (0E 0/0/0 no-ability —
// 3 dead copies in the Verdant deck since the fixture was cut). Restored as the
// intended X-cost construct, mirroring Steel-Root Armor's engine-real x_cost
// dynamic and the bot's x_cost tag detection: 1/1 base, "gains +X/+X where X is
// the Energy spent" (two on_deploy modify_stats with x_cost dynamics).
//
// Both pure: deep-clone in, {raw, changed} out.
const cost = (mana, energy = 0) => ({ mana, energy, flexible: 0 });

// AURA CONTRACT: abilities whose card-level type is 'Aura' are always-on
// engines — they NEVER take cooldowns or costs (a cooldown breaks aura logic).
// Their EFFECT VALUES are tunable (token stats, amounts, thresholds — a design
// edit, not a knob); only their scheduling is off-limits. assertKnobable
// enforces the scheduling half; effect-value aura tunes would be explicit
// patch entries like the Grovekeeper fix below.
const HERO_KNOBS = [
  // Verdant RIA-09: base kit over-window (the always-on battery §12c measured).
  // Harvest is an Aura (no cd/cost; its effect values stay as printed in this
  // pass) — the governor routes through Bloom Assembly.
  { id: 136, i: 0, why: 'Bloom Assembly cd 2→6, gains cost 2E', patch: (ab) => { ab.dsl.trigger.cooldown = 6; ab.cooldown = 6; ab.dsl.trigger.cost = cost(0, 2); } },
  // Verdant Vanguard: transform under-window AND below impact floor.
  { id: 103, i: 0, why: 'Overgrowth Protocol cost 5E→2E', patch: (ab) => { ab.dsl.trigger.cost = cost(0, 2); } },
  { id: 103, i: 2, why: 'Synthetic Evolution cost 10E→3E', patch: (ab) => { ab.dsl.trigger.cost = cost(0, 3); } },
  // Onyx Lich King: transform over-window (composite over). Horde is an Aura
  // (no cd/cost; effect values kept as printed this pass) — the trim routes
  // through Resurgence + Plague instead.
  { id: 3, i: 0, why: 'Deathly Resurgence cd 1→2', patch: (ab) => { ab.dsl.trigger.cooldown = 2; ab.cooldown = 2; } },
  { id: 3, i: 2, why: 'Plague of Shadows cost 7→9', patch: (ab) => { ab.dsl.trigger.cost = cost(9); } },
  // Radiant Seraphina: base under-window (negative-net Bulwark).
  { id: 134, i: 0, why: "Protector's Bulwark cost 3→1, cd 3→1", patch: (ab) => { ab.dsl.trigger.cost = cost(1); ab.dsl.trigger.cooldown = 1; ab.cooldown = 1; } },
  // Radiant Valkyrie: transform over-window.
  { id: 41, i: 2, why: "Valkyrie's cry gains cost 3M", patch: (ab) => { ab.dsl.trigger.cost = cost(3); } },
  // Sapphire Lyria Supreme: transform below impact floor; starved button (§13d:
  // 0.6–0.8 presses/game — the only flip measured to actually help).
  { id: 74, i: 4, why: 'Arcane Singularity cost 5→1, cd 3→2', patch: (ab) => { ab.dsl.trigger.cost = cost(1); ab.dsl.trigger.cooldown = 2; } },
  { id: 74, i: 2, why: 'Arcane Convergence cooldown removed', patch: (ab) => { ab.dsl.cooldown = null; ab.cooldown = null; } },
];

function assertKnobable(card, ab, why) {
  if (ab.type === 'Aura') {
    throw new Error(`hero tune: "${why}" targets an Aura ability on ${card.name} — Auras are always-on and never take costs/cooldowns`);
  }
}

export function applyHeroTune(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changed = [];
  for (const k of HERO_KNOBS) {
    const card = byId.get(k.id);
    if (!card) throw new Error(`hero tune: card id ${k.id} not found`);
    const ab = card.abilities[k.i];
    if (!ab) throw new Error(`hero tune: card ${k.id} has no ability #${k.i}`);
    assertKnobable(card, ab, k.why);
    k.patch(ab);
    changed.push(`${card.name} — ${k.why}`);
  }
  return { raw, changed };
}

// §13g v2 layer (applied ON TOP of applyHeroTune): design review after the §13f
// remeasure tightened W1 to a FIXED [3.00–4.99] window — Verdant's 5.44 base kit
// is the one hero out. Directive: nerf RIA-09's normal form into the window and
// buff the transform slightly so the W3 composite stays ≈7.07.
//   - Harvest token 1/1 → 0/1: an aura EFFECT VALUE (the sanctioned surface —
//     scheduling stays untouched). Base 5.44 → ~4.38. Bloom Assembly's activated
//     1/1 token is deliberately left stronger: it is the paid, cd-6 unit.
//   - Overgrowth Protocol cd 3→2 and Synthetic Evolution 3E→2E (both engine-
//     enforced knobs): transform 10.54 → ~12.77, composite held at ~7.10.
export function applyHeroTuneV2(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const byId = new Map(raw.map((c) => [c.id, c]));
  const changed = [];

  const ria = byId.get(136);
  if (!ria) throw new Error('hero tune v2: RIA-09 (136) not found');
  const harvest = ria.abilities[1];
  const token = harvest?.dsl?.effects?.[0]?.ifTrue?.[0]?.token;
  if (harvest?.type !== 'Aura' || !token || token.atk !== 1) {
    throw new Error('hero tune v2: Biotech Harvest shape changed — expected Aura with a 1/1 token');
  }
  token.atk = 0;
  const newText = harvest.effect.replace('a 1/1 Bio-Construct token', 'a 0/1 Bio-Construct token');
  if (newText === harvest.effect) throw new Error('hero tune v2: Harvest effect text did not contain the expected token wording');
  harvest.effect = newText;
  changed.push('RIA-09 — Biotech Harvest token 1/1 → 0/1 (aura effect value)');

  const van = byId.get(103);
  if (!van) throw new Error('hero tune v2: Verdant Vanguard (103) not found');
  const knobs = [
    { i: 0, why: 'Overgrowth Protocol cd 3→2', patch: (ab) => { ab.dsl.trigger.cooldown = 2; ab.cooldown = 2; } },
    { i: 2, why: 'Synthetic Evolution cost 3E→2E', patch: (ab) => { ab.dsl.trigger.cost = cost(0, 2); } },
  ];
  for (const k of knobs) {
    const ab = van.abilities[k.i];
    if (!ab) throw new Error(`hero tune v2: Vanguard has no ability #${k.i}`);
    assertKnobable(van, ab, k.why);
    k.patch(ab);
    changed.push(`RIA-09 Verdant Vanguard — ${k.why}`);
  }
  return { raw, changed };
}

export function applyGrovekeeperFix(rawInput) {
  const raw = JSON.parse(JSON.stringify(rawInput));
  const c = raw.find((x) => x.id === 142);
  if (!c) throw new Error('Grovekeeper fix: card id 142 not found');
  c.tags = ['Construct', 'x_cost'];
  c.stats = { hp: 1, atk: 1, arm: 0 };
  const grow = (stat) => ({
    type: 'modify_stats',
    target: { type: 'self' },
    duration: { type: 'permanent' },
    modifier: { [stat]: 0 },
    dynamicModifier: { stat, type: 'x_cost', resource: 'energy' },
  });
  c.abilities = [
    {
      dsl: { type: 'triggered', effects: [grow('atk'), grow('hp')], trigger: { type: 'on_deploy' } },
      cost: { mana: 0, xMana: false, energy: 0, xEnergy: true, flexible: false },
      type: 'Trigger',
      effect: 'Grovekeeper 3000 enters with +X/+X, where X is the Energy spent to deploy it.',
      cooldown: null,
    },
  ];
  return { raw, changed: ['Grovekeeper 3000 — restored as X-cost construct (1/1 base, +X/+X on deploy)'] };
}
