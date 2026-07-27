/**
 * Per-faction GAMEPLANS for the heuristic pilot — a small bundle of strategic
 * weights that bias the bot toward a faction's intended archetype.
 *
 * WHY: the heuristic pilot's hardcoded scoring constants (FACE_WEIGHT=1.5 in
 * heuristic.ts / spell-eval.ts, the destroy/bounce/buff multipliers, and the gang
 * planner's KEY_DEFENDER/KEY_THREAT multipliers) bake ONE archetype (board-value /
 * grind) into every faction, overstating go-wide decks. A gameplan lets later
 * tasks (T-A6/A7/A8) read these weights instead of the constants so each faction
 * plays to its plan.
 *
 * DETERMINISM: the NEUTRAL gameplan's weights are EXACTLY the current hardcoded
 * constants, so a consumer that defaults to NEUTRAL is a semantically invariant no-op. The
 * faction gameplans are only consulted when an explicit `botGameplan` is supplied
 * on the config — absent ⇒ the engine never touches this module.
 *
 * Pure data + a pure selector. No state, no RNG.
 */

import type { Faction, Gameplan } from '../types/gameplan.js';

export type { Faction, Gameplan } from '../types/gameplan.js';

/** NEUTRAL gameplan — weights EQUAL the current hardcoded constants so a consumer
 * defaulting to NEUTRAL reproduces today's behavior byte-for-byte. Do not change
 * these values without re-anchoring the v10 runHash. */
const NEUTRAL: Gameplan = {
  faceWeight: 1.5, // FACE_WEIGHT (heuristic.ts:455, spell-eval.ts:87)
  removalWeight: 1, // destroy/sacrifice `mult = 1` (spell-eval.ts:77)
  tempoWeight: 0.6, // modify_stats buff weight (spell-eval.ts:106)
  gangAggression: 1, // neutral scalar on KEY_DEFENDER/KEY_THREAT (combat-plan.ts:38-41)
  closeBias: 1, // neutral closing bias
};

/** Onyx Abyss — control / recursion: leans on removal and grinding the opponent
 * out (recursion engine), races the face least. */
const ONYX: Gameplan = {
  faceWeight: 1.2,
  removalWeight: 1.4,
  tempoWeight: 0.5,
  gangAggression: 1,
  closeBias: 0.9,
};

/** Radiant Bastions — go-wide / grind: develops a board (tempo) and gangs walls
 * with its many bodies; closes through sustained pressure. */
const RADIANT: Gameplan = {
  faceWeight: 1.6,
  removalWeight: 0.9,
  tempoWeight: 0.8,
  gangAggression: 1.3,
  closeBias: 1.1,
};

/** Sapphire Isles — control / counter: prizes removal/counter and grinds card
 * advantage; least eager to commit bodies into gangs, races the face least. */
const SAPPHIRE: Gameplan = {
  faceWeight: 1.1,
  removalWeight: 1.3,
  tempoWeight: 0.6,
  gangAggression: 0.8,
  closeBias: 0.85,
};

/** Verdant Glades — ramp: develops bigger bodies via tempo/ramp and converts the
 * board into a closing clock once ahead. */
const VERDANT: Gameplan = {
  faceWeight: 1.4,
  removalWeight: 0.9,
  tempoWeight: 1,
  gangAggression: 1.1,
  closeBias: 1.05,
};

/** Resolve the gameplan for a faction. Unknown / 'Neutral' ⇒ the NEUTRAL plan
 * (hardcoded-constant-equivalent), so an unrecognized faction never changes
 * behavior. */
export function gameplanFor(faction: Faction): Gameplan {
  switch (faction) {
    case 'Onyx':
      return ONYX;
    case 'Radiant':
      return RADIANT;
    case 'Sapphire':
      return SAPPHIRE;
    case 'Verdant':
      return VERDANT;
    case 'Neutral':
      return NEUTRAL;
    default: {
      const _exhaustive: never = faction;
      return _exhaustive;
    }
  }
}
