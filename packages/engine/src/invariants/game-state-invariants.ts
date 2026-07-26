import type { CardInstance, GameState } from '../types/game-state.js';
import { buildAuraDerivationState } from '../runtime/aura-derivation.js';

export interface StateInvariantViolation {
  readonly code:
    | 'duplicate_instance'
    | 'owner_mismatch'
    | 'attachment_mismatch'
    | 'attachment_type'
    | 'nested_attachment'
    | 'nonpositive_battlefield_hp'
    | 'exile_record_mismatch'
    | 'aura_derivation_missing'
    | 'aura_derivation_mismatch';
  readonly path: string;
  readonly message: string;
}

interface SeenCard {
  readonly card: CardInstance;
  readonly path: string;
  readonly playerId: 0 | 1;
  readonly attachedTo?: string;
}

/** Check physical-card conservation and the bidirectional equipment relation. */
export function validateGameStateInvariants(
  state: GameState,
): readonly StateInvariantViolation[] {
  const violations: StateInvariantViolation[] = [];
  const seen = new Map<string, string>();
  const cards: SeenCard[] = [];

  const add = (
    card: CardInstance,
    path: string,
    playerId: 0 | 1,
    attachedTo?: string,
  ): void => {
    const prior = seen.get(card.instanceId);
    if (prior !== undefined) {
      violations.push({
        code: 'duplicate_instance',
        path,
        message: `${card.instanceId} also exists at ${prior}`,
      });
    } else {
      seen.set(card.instanceId, path);
    }
    cards.push({ card, path, playerId, ...(attachedTo !== undefined ? { attachedTo } : {}) });
  };

  for (const playerId of [0, 1] as const) {
    const player = state.players[playerId];
    const topLevel: readonly [string, readonly CardInstance[]][] = [
      ['mainDeck', player.mainDeck],
      ['hand', player.hand],
      ['discardPile', player.discardPile],
    ];
    for (const [zone, entries] of topLevel) {
      entries.forEach((card, index) => {
        add(card, `players.${String(playerId)}.${zone}.${String(index)}`, playerId);
      });
    }
    player.exile.forEach((record, index) => {
      const path = `players.${String(playerId)}.exile.${String(index)}`;
      add(record.card, `${path}.card`, playerId);
      if (
        record.instanceId !== record.card.instanceId ||
        record.ownerPlayerId !== playerId
      ) {
        violations.push({
          code: 'exile_record_mismatch',
          path,
          message:
            'Exile ledger instance/owner fields must match the contained card and player',
        });
      }
    });
    const battlefield: readonly [string, readonly (CardInstance | null)[]][] = [
      ['reserve', player.zones.reserve],
      ['frontline', player.zones.frontline],
      ['highGround', player.zones.highGround],
    ];
    for (const [zone, entries] of battlefield) {
      entries.forEach((card, index) => {
        if (card === null) return;
        const path = `players.${String(playerId)}.zones.${zone}.${String(index)}`;
        add(card, path, playerId);
        if (card.currentHp <= 0) {
          violations.push({
            code: 'nonpositive_battlefield_hp',
            path: `${path}.currentHp`,
            message: 'A stabilized battlefield card must have positive HP',
          });
        }
        if (card.equipment !== null) {
          add(card.equipment, `${path}.equipment`, playerId, card.instanceId);
        }
      });
    }

    for (const [zone, entries] of [
      ['resourceDeck', player.resourceDeck],
      ['resourceBank', player.resourceBank],
    ] as const) {
      entries.forEach((resource, index) => {
        const path = `players.${String(playerId)}.${zone}.${String(index)}`;
        const prior = seen.get(resource.instanceId);
        if (prior !== undefined) {
          violations.push({
            code: 'duplicate_instance',
            path,
            message: `Resource ${resource.instanceId} also exists at ${prior}`,
          });
        } else {
          seen.set(resource.instanceId, path);
        }
      });
    }
  }

  for (const entry of cards) {
    const { card, path, playerId, attachedTo } = entry;
    if (card.owner !== playerId) {
      violations.push({
        code: 'owner_mismatch',
        path: `${path}.owner`,
        message: `Card owner ${String(card.owner)} does not match containing player ${String(playerId)}`,
      });
    }
    if (attachedTo === undefined) {
      if (card.holderInstanceId !== undefined) {
        violations.push({
          code: 'attachment_mismatch',
          path: `${path}.holderInstanceId`,
          message: 'An unattached card cannot name an equipment holder',
        });
      }
      continue;
    }
    if (card.cardType !== 'E') {
      violations.push({
        code: 'attachment_type',
        path: `${path}.cardType`,
        message: 'Only an Equipment instance may occupy an equipment attachment',
      });
    }
    if (card.holderInstanceId !== attachedTo) {
      violations.push({
        code: 'attachment_mismatch',
        path: `${path}.holderInstanceId`,
        message: `Attached equipment must point back to holder ${attachedTo}`,
      });
    }
    if (card.equipment !== null) {
      violations.push({
        code: 'nested_attachment',
        path: `${path}.equipment`,
        message: 'Equipment cannot itself hold equipment',
      });
    }
  }
  const expectedAuraDerivation = buildAuraDerivationState(state);
  if (
    state.config?.authoritativeTransitions === true &&
    state.auraDerivation === undefined
  ) {
    violations.push({
      code: 'aura_derivation_missing',
      path: 'auraDerivation',
      message: 'Current authoritative states must identify their derived aura graph',
    });
  } else if (
    state.auraDerivation !== undefined &&
    state.pendingChoice === null &&
    state.pendingPriority == null &&
    JSON.stringify(state.auraDerivation) !==
      JSON.stringify(expectedAuraDerivation)
  ) {
    violations.push({
      code: 'aura_derivation_mismatch',
      path: 'auraDerivation',
      message: `Aura source/contribution metadata does not match live derived state (recorded ${JSON.stringify(state.auraDerivation)}, expected ${JSON.stringify(expectedAuraDerivation)})`,
    });
  }
  return violations;
}

export function assertGameStateInvariants(state: GameState): void {
  const violations = validateGameStateInvariants(state);
  if (violations.length > 0) {
    throw new Error(
      violations
        .map((violation) => `${violation.code}@${violation.path}: ${violation.message}`)
        .join('; '),
    );
  }
}
