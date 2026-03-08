/**
 * Card Mappers — transforms engine CardInstance to UI CardDisplayProps.
 * Bridges the engine's runtime types to the UI package's engine-agnostic props.
 */
import type { CardInstance, AvailableActions } from '@aetherion-sim/engine';
import type { CardDisplayProps, CardDisplayMode, AbilityDisplay } from '@aetherion-sim/ui';
import { getFaction } from '@aetherion-sim/ui';
import { getAbilityMeta } from '@/stores/game-store';

interface MapOptions {
  readonly mode: CardDisplayMode;
  readonly availableActions?: AvailableActions | null;
  readonly selected?: boolean;
  readonly highlighted?: boolean;
  readonly onClick?: () => void;
  readonly onMouseEnter?: () => void;
  readonly onMouseLeave?: () => void;
}

export function mapCardToDisplay(
  card: CardInstance,
  opts: MapOptions,
): CardDisplayProps {
  const faction = getFaction(card.alignment);

  // Check if card is playable (deployable, castable, etc.) in hand mode
  let playable: boolean | undefined;
  if (opts.mode === 'hand' && opts.availableActions) {
    const actions = opts.availableActions;
    playable =
      actions.canDeploy.some((d) => d.cardInstanceId === card.instanceId) ||
      actions.canCastSpell.some((s) => s.cardInstanceId === card.instanceId) ||
      actions.canAttachEquipment.some((e) => e.cardInstanceId === card.instanceId) ||
      (actions.canDiscardForEnergy && card.cardType !== 'H');
  }

  // Map abilities to display format using metadata lookup
  const meta = getAbilityMeta(card.cardDefId);
  const abilities: AbilityDisplay[] = card.abilities.map((a, i) => ({
    name: meta[i]?.name ?? '',
    cost: null,
    effect: meta[i]?.effect ?? '',
    trigger: a.type === 'triggered' ? 'Trigger' : null,
    abilityType: a.type,
  }));

  // Check if stats are modified from base
  const hasModifiedStats =
    card.currentHp !== card.baseHp ||
    card.currentAtk !== card.baseAtk ||
    card.currentArm !== card.baseArm;

  return {
    mode: opts.mode,
    name: card.name,
    cardType: card.cardType,
    faction,
    cost: {
      mana: card.cost.mana,
      energy: card.cost.energy,
      flexible: card.cost.flexible,
    },
    stats: (card.baseHp > 0 || card.baseAtk > 0 || card.baseArm > 0)
      ? { hp: card.baseHp, atk: card.baseAtk, arm: card.baseArm }
      : null,
    modifiedStats: hasModifiedStats
      ? { hp: card.currentHp, atk: card.currentAtk, arm: card.currentArm }
      : undefined,
    equipmentName: card.equipment?.name,
    abilities,
    traits: [...card.traits, ...card.grantedTraits.map((g) => g.trait)],
    exhausted: card.exhausted,
    summoningSick: card.summoningSick,
    playable,
    selected: opts.selected,
    highlighted: opts.highlighted,
    onClick: opts.onClick,
    onMouseEnter: opts.onMouseEnter,
    onMouseLeave: opts.onMouseLeave,
  };
}
