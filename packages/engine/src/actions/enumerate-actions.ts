/**
 * Canonical Action Enumerator — turns the legality surface reported by
 * `computeAvailableActions(state)` into concrete, sendable `PlayerAction`s.
 *
 * This is the engine-level replacement for the ad-hoc concretizers duplicated
 * across the analysis `.mjs` scripts (`pilot-rollout.mjs` `candidateActions` /
 * `concreteActions`). Those stay untouched for now — wiring them to call this
 * enumerator is a later task, gated behind `CandidateGenMode`.
 *
 * ── Coverage spec ('full' mode) — one line per PlayerAction kind ─────────────
 * - deploy: every `(cardInstanceId, zone, slotIndex)` pair across ALL
 *   `DeployOption.validSlots` groups and ALL slot indices in each group.
 * - declare_attack: every `(attackerInstanceId, targetId)` pair across ALL of
 *   `AttackOption.validTargets` (hero target -> `'hero'`; character target ->
 *   its instanceId).
 * - cast_spell: one action per castable card (`CastSpellOption`).
 *   `selectedTargetIds` is intentionally left `undefined` — target selection
 *   for spell effects flows through the engine's `pendingChoice` system after
 *   the action is sent, not through this enumeration.
 * - attach_equipment: every `(cardInstanceId, targetInstanceId)` pair across
 *   ALL of `EquipOption.validTargets`.
 * - move: every `(cardInstanceId, toZone)` pair across ALL of
 *   `MoveOption.validDestinations`.
 * - activate_ability: one action per `(cardInstanceId, abilityIndex)` in
 *   `AvailableActions.canActivateAbility`.
 * - discard_for_energy: one action per card in the active player's hand, gated
 *   by `AvailableActions.canDiscardForEnergy` (a boolean — the engine's
 *   legality check does not discriminate by card, any hand card is a legal
 *   pitch, so the hand IS the option set; see `computeCanDiscardForEnergy`).
 * - tap_reserve: one action per instanceId in `AvailableActions.canTapReserve`.
 * - declare_transform: a single action when `AvailableActions.canTransform`.
 * - xValue: full mode expands every legal value exposed by `xValues` on deploy,
 *   cast, equip, and activation options. Legacy mode preserves the historical
 *   omitted-X concretizer behavior.
 * - remove_equipment / transfer_equipment: excluded in legacy mode. Full mode
 *   enumerates the complete authoritative remove/transfer surface.
 *
 * ── 'legacy' mode ─────────────────────────────────────────────────────────────
 * Byte-for-byte reproduction of the selection behavior of the existing
 * concretizer in `pilot-rollout.mjs` `concreteActions` (lines ~97-108): deploy
 * picks the frontline slot group if present, else the first group, and only
 * `slots[0]`; equipment picks only `validTargets[0]`; move picks only
 * `validDestinations[0]`; attack picks only `validTargets[0]`; no
 * `discard_for_energy`. Same per-option iteration order as the legacy code.
 *
 * ── Ordering ──────────────────────────────────────────────────────────────────
 * Both modes return actions sorted by the same comparator the pilot uses
 * (`pilot-rollout.mjs` ~411-432): `KIND_ORDER` then a stable string key
 * (ported `keyOf`). `discard_for_energy` and `tap_reserve` — kinds the legacy
 * comparator never saw — are given KIND_ORDER slots after the kinds it does
 * cover; `remove_equipment` / `transfer_equipment` get trailing slots too
 * (never produced, but the Record must be total over `PlayerAction['type']`).
 * Two calls on the same state return identical arrays (no `Date.now`, no
 * `Math.random`, no unordered Map/Set iteration).
 */
import type { GameState } from '../types/game-state.js';
import type { PlayerAction } from '../state-machine/types.js';
import { computeAvailableActions, type AvailableActions } from './available-actions.js';

export type CandidateGenMode = 'legacy' | 'full';

export function enumerateConcretePlayerActions(
  state: GameState,
  mode: CandidateGenMode,
): readonly PlayerAction[] {
  const acts = computeAvailableActions(state);
  const actions = mode === 'legacy' ? legacyActions(acts) : fullActions(acts, state);
  return orderActions(actions);
}

// ── 'legacy' mode ─────────────────────────────────────────────────────────────

function legacyActions(acts: AvailableActions): PlayerAction[] {
  const out: PlayerAction[] = [];

  for (const d of acts.canDeploy) {
    const s = d.validSlots.find((x) => x.zone === 'frontline') ?? d.validSlots[0];
    if (s !== undefined && s.slots.length > 0) {
      out.push({
        type: 'deploy',
        cardInstanceId: d.cardInstanceId,
        zone: s.zone,
        slotIndex: s.slots[0]!,
      });
    }
  }
  for (const a of acts.canAttack) {
    out.push({
      type: 'declare_attack',
      attackerInstanceId: a.attackerInstanceId,
      targetId: firstTargetId(a.validTargets),
    });
  }
  for (const c of acts.canCastSpell) {
    out.push({ type: 'cast_spell', cardInstanceId: c.cardInstanceId });
  }
  for (const a of acts.canActivateAbility) {
    out.push({
      type: 'activate_ability',
      cardInstanceId: a.cardInstanceId,
      abilityIndex: a.abilityIndex,
    });
  }
  for (const e of acts.canAttachEquipment) {
    const t = e.validTargets[0];
    if (t !== undefined)
      out.push({ type: 'attach_equipment', cardInstanceId: e.cardInstanceId, targetInstanceId: t });
  }
  for (const m of acts.canMove) {
    const dest = m.validDestinations[0];
    if (dest !== undefined)
      out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: dest });
  }
  for (const id of acts.canTapReserve) {
    out.push({ type: 'tap_reserve', cardInstanceId: id });
  }
  if (acts.canTransform) out.push({ type: 'declare_transform' });

  return out;
}

// ── 'full' mode ───────────────────────────────────────────────────────────────

function fullActions(acts: AvailableActions, state: GameState): PlayerAction[] {
  const out: PlayerAction[] = [];

  for (const d of acts.canDeploy) {
    for (const group of d.validSlots) {
      for (const slotIndex of group.slots) {
        for (const xValue of candidateXValues(d.xValues)) {
          out.push({
            type: 'deploy',
            cardInstanceId: d.cardInstanceId,
            zone: group.zone,
            slotIndex,
            ...(xValue !== undefined ? { xValue } : {}),
          });
        }
      }
    }
  }
  for (const a of acts.canAttack) {
    for (const t of a.validTargets) {
      out.push({
        type: 'declare_attack',
        attackerInstanceId: a.attackerInstanceId,
        targetId: t.type === 'hero' ? 'hero' : (t.instanceId ?? 'hero'),
      });
    }
  }
  for (const c of acts.canCastSpell) {
    for (const xValue of candidateXValues(c.xValues)) {
      out.push({
        type: 'cast_spell',
        cardInstanceId: c.cardInstanceId,
        ...(xValue !== undefined ? { xValue } : {}),
      });
    }
  }
  for (const e of acts.canAttachEquipment) {
    for (const targetInstanceId of e.validTargets) {
      for (const xValue of candidateXValues(e.xValues)) {
        out.push({
          type: 'attach_equipment',
          cardInstanceId: e.cardInstanceId,
          targetInstanceId,
          ...(xValue !== undefined ? { xValue } : {}),
        });
      }
    }
  }
  for (const option of acts.canRemoveEquipment) {
    out.push({
      type: 'remove_equipment',
      equipmentInstanceId: option.equipmentInstanceId,
    });
  }
  for (const option of acts.canTransferEquipment) {
    for (const targetInstanceId of option.validTargets) {
      out.push({
        type: 'transfer_equipment',
        equipmentInstanceId: option.equipmentInstanceId,
        targetInstanceId,
      });
    }
  }
  for (const m of acts.canMove) {
    for (const toZone of m.validDestinations) {
      out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone });
    }
  }
  for (const a of acts.canActivateAbility) {
    for (const xValue of candidateXValues(a.xValues)) {
      out.push({
        type: 'activate_ability',
        cardInstanceId: a.cardInstanceId,
        abilityIndex: a.abilityIndex,
        ...(xValue !== undefined ? { xValue } : {}),
      });
    }
  }
  if (acts.canDiscardForEnergy) {
    const player = state.players[state.activePlayerIndex];
    for (const card of player.hand) {
      out.push({ type: 'discard_for_energy', cardInstanceId: card.instanceId });
    }
  }
  for (const id of acts.canTapReserve) {
    out.push({ type: 'tap_reserve', cardInstanceId: id });
  }
  if (acts.canTransform) out.push({ type: 'declare_transform' });

  return out;
}

function candidateXValues(values: readonly number[] | undefined): readonly (number | undefined)[] {
  return values ?? [undefined];
}

function firstTargetId(targets: AvailableActions['canAttack'][number]['validTargets']): string {
  const t = targets[0];
  if (t === undefined) return 'hero';
  return t.type === 'hero' ? 'hero' : (t.instanceId ?? 'hero');
}

// ── Ordering ──────────────────────────────────────────────────────────────────

const KIND_ORDER: Record<PlayerAction['type'], number> = {
  declare_attack: 0,
  cast_spell: 1,
  deploy: 2,
  move: 3,
  activate_ability: 4,
  attach_equipment: 5,
  declare_transform: 6,
  discard_for_energy: 7,
  tap_reserve: 8,
  remove_equipment: 9,
  transfer_equipment: 10,
};

/** Stable identity key for a `PlayerAction` — ported from `pilot-rollout.mjs`
 * `keyOf` (~423-433), extended for kinds it never saw. Used both for the
 * ordering comparator and (by callers/tests) for duplicate detection. */
export function keyOfPlayerAction(a: PlayerAction): string {
  const xSuffix = 'xValue' in a && a.xValue !== undefined ? `:x${String(a.xValue)}` : '';
  switch (a.type) {
    case 'declare_attack':
      return `${a.attackerInstanceId}>${a.targetId}`;
    case 'deploy':
      return `${a.cardInstanceId}@${a.zone}:${String(a.slotIndex)}${xSuffix}`;
    case 'attach_equipment':
      return `${a.cardInstanceId}->${a.targetInstanceId}${xSuffix}`;
    case 'activate_ability':
      return `${a.cardInstanceId}#${String(a.abilityIndex)}${xSuffix}`;
    case 'move':
      return `${a.cardInstanceId}->${a.toZone}`;
    case 'cast_spell':
      return `${a.cardInstanceId}${xSuffix}`;
    case 'discard_for_energy':
      return a.cardInstanceId;
    case 'tap_reserve':
      return a.cardInstanceId;
    case 'declare_transform':
      return a.type;
    case 'remove_equipment':
      return a.equipmentInstanceId;
    case 'transfer_equipment':
      return `${a.equipmentInstanceId}->${a.targetInstanceId}`;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

function orderActions(actions: readonly PlayerAction[]): readonly PlayerAction[] {
  return [...actions].sort((a, b) => {
    const ka = KIND_ORDER[a.type];
    const kb = KIND_ORDER[b.type];
    if (ka !== kb) return ka - kb;
    return keyOfPlayerAction(a).localeCompare(keyOfPlayerAction(b));
  });
}
