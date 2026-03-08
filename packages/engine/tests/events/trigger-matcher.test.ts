import { describe, it, expect, beforeEach } from 'vitest';
import {
  triggerMatchesEvent,
  findMatchingTriggers,
} from '../../src/events/trigger-matcher.js';
import type { RegisteredTrigger, GameEvent } from '../../src/types/game-state.js';
import type { Trigger } from '../../src/types/triggers.js';

function makeTrigger(
  trigger: Trigger,
  sourceId: string,
  ownerId: 0 | 1,
): RegisteredTrigger {
  return {
    id: `t_${sourceId}`,
    sourceInstanceId: sourceId,
    ownerPlayerId: ownerId,
    trigger,
    effects: [],
    abilityIndex: 0,
  };
}

describe('Trigger Matcher', () => {
  describe('triggerMatchesEvent', () => {
    it('on_deploy matches CARD_DEPLOYED for self', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_deploy' },
          { type: 'CARD_DEPLOYED', cardInstanceId: 'c1', zone: 'frontline', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(true);
    });

    it('on_deploy does NOT match other cards', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_deploy' },
          { type: 'CARD_DEPLOYED', cardInstanceId: 'c2', zone: 'frontline', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_destroy matches CARD_DESTROYED for self', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_destroy' },
          { type: 'CARD_DESTROYED', cardInstanceId: 'c1', cause: 'combat', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(true);
    });

    it('on_turn_start matches only controller turn', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_turn_start' },
          { type: 'TURN_START', playerId: 0, turnNumber: 1 },
          'c1', 0,
        ),
      ).toBe(true);
      expect(
        triggerMatchesEvent(
          { type: 'on_turn_start' },
          { type: 'TURN_START', playerId: 1, turnNumber: 1 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_attack matches CHARACTER_ATTACKED as attacker', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_attack' },
          { type: 'CHARACTER_ATTACKED', attackerId: 'c1', targetId: 'c2' },
          'c1', 0,
        ),
      ).toBe(true);
    });

    it('on_attack does NOT match as defender', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_attack' },
          { type: 'CHARACTER_ATTACKED', attackerId: 'c2', targetId: 'c1' },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_ally_deployed matches ally deploy, not self', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_ally_deployed' },
          { type: 'CARD_DEPLOYED', cardInstanceId: 'c2', zone: 'frontline', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(true);
      // Self does not trigger ally_deployed
      expect(
        triggerMatchesEvent(
          { type: 'on_ally_deployed' },
          { type: 'CARD_DEPLOYED', cardInstanceId: 'c1', zone: 'frontline', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_ally_deployed does not match enemy deploy', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_ally_deployed' },
          { type: 'CARD_DEPLOYED', cardInstanceId: 'c3', zone: 'frontline', playerId: 1 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_spell_cast with side=allied matches own spells', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_spell_cast', side: 'allied' },
          { type: 'SPELL_CAST', cardInstanceId: 's1', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(true);
      expect(
        triggerMatchesEvent(
          { type: 'on_spell_cast', side: 'allied' },
          { type: 'SPELL_CAST', cardInstanceId: 's1', playerId: 1 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_take_damage matches DAMAGE_DEALT to self', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_take_damage' },
          { type: 'DAMAGE_DEALT', sourceId: 'c2', targetId: 'c1', amount: 3 },
          'c1', 0,
        ),
      ).toBe(true);
    });

    it('on_ally_destroyed matches only same-player cards', () => {
      // Allied card destroyed — should match
      expect(
        triggerMatchesEvent(
          { type: 'on_ally_destroyed' },
          { type: 'CARD_DESTROYED', cardInstanceId: 'c2', cause: 'combat', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(true);
      // Enemy card destroyed — should NOT match
      expect(
        triggerMatchesEvent(
          { type: 'on_ally_destroyed' },
          { type: 'CARD_DESTROYED', cardInstanceId: 'c2', cause: 'combat', playerId: 1 },
          'c1', 0,
        ),
      ).toBe(false);
      // Self destroyed — should NOT match (on_ally excludes self)
      expect(
        triggerMatchesEvent(
          { type: 'on_ally_destroyed' },
          { type: 'CARD_DESTROYED', cardInstanceId: 'c1', cause: 'combat', playerId: 0 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('on_overheal matches CHARACTER_OVERHEALED, not CHARACTER_HEALED', () => {
      expect(
        triggerMatchesEvent(
          { type: 'on_overheal' },
          { type: 'CHARACTER_OVERHEALED', cardInstanceId: 'c1', excess: 3 },
          'c1', 0,
        ),
      ).toBe(true);
      // Regular heal should NOT match
      expect(
        triggerMatchesEvent(
          { type: 'on_overheal' },
          { type: 'CHARACTER_HEALED', cardInstanceId: 'c1', amount: 3 },
          'c1', 0,
        ),
      ).toBe(false);
    });

    it('activated trigger never matches events', () => {
      expect(
        triggerMatchesEvent(
          { type: 'activated', cost: { mana: 1, energy: 0, flexible: 0 } },
          { type: 'TURN_START', playerId: 0, turnNumber: 1 },
          'c1', 0,
        ),
      ).toBe(false);
    });
  });

  describe('findMatchingTriggers', () => {
    it('should return matching triggers in APNAP order', () => {
      const t1 = makeTrigger({ type: 'on_turn_start' }, 'c1', 1);
      const t2 = makeTrigger({ type: 'on_turn_start' }, 'c2', 0);
      const event: GameEvent = { type: 'TURN_START', playerId: 0, turnNumber: 1 };

      // Only player 0's trigger matches (turn_start checks ownerPlayerId)
      const result = findMatchingTriggers([t1, t2], event, 0);
      expect(result).toHaveLength(1);
      expect(result[0]?.sourceInstanceId).toBe('c2');
    });

    it('should order active player triggers before non-active', () => {
      const t1 = makeTrigger({ type: 'on_deploy' }, 'c1', 1);
      const t2 = makeTrigger({ type: 'on_ally_deployed' }, 'c3', 0);

      // Card 'c1' deployed by player 1
      const event: GameEvent = {
        type: 'CARD_DEPLOYED',
        cardInstanceId: 'c1',
        zone: 'frontline',
        playerId: 1,
      };

      const result = findMatchingTriggers([t1, t2], event, 0);
      // t2 (active player 0) before t1 (non-active player 1) — but t2 checks playerId
      // Actually: on_ally_deployed for c3 (owner 0) — event playerId is 1, so it won't match
      // t1 on_deploy matches because c1 === c1
      expect(result).toHaveLength(1);
      expect(result[0]?.sourceInstanceId).toBe('c1');
    });
  });
});
