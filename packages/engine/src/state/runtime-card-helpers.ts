import type {
  CardInstance,
  HeroState,
} from '../types/game-state.js';
import type {
  AbilityDSL,
  StatusEffectType,
  Trait,
} from '../types/index.js';

export function getRuntimeCardAbilities(card: CardInstance): readonly AbilityDSL[] {
  return [
    ...card.abilities,
    ...card.grantedAbilities.map(entry => entry.ability),
  ];
}

export function getRuntimeHeroAbilities(hero: HeroState): readonly AbilityDSL[] {
  return hero.abilities;
}

export function getRuntimeCardTraits(card: CardInstance): readonly Trait[] {
  return [
    ...card.traits.filter(trait => trait !== 'stealth' || !card.stealthBroken),
    ...card.grantedTraits.map(entry => entry.trait),
  ];
}

export function cardHasActiveTrait(card: CardInstance, trait: Trait): boolean {
  return getRuntimeCardTraits(card).includes(trait);
}

export function getNumericTraitValue(
  card: CardInstance,
  trait: Extract<Trait, 'rush' | 'recycle'>,
): number {
  const tagPrefix = `${trait} `;
  for (const tag of card.tags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized === trait) {
      return 1;
    }
    if (normalized.startsWith(tagPrefix)) {
      const parsed = Number.parseInt(normalized.slice(tagPrefix.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return cardHasActiveTrait(card, trait) ? 1 : 0;
}

export function getFreeMoveAllowance(
  card: CardInstance,
  turnNumber: number,
): number {
  const swiftAllowance = cardHasActiveTrait(card, 'swift') ? 1 : 0;
  const rushAllowance = cardHasActiveTrait(card, 'rush') && card.deployedTurn === turnNumber
    ? getNumericTraitValue(card, 'rush')
    : 0;
  return swiftAllowance + rushAllowance;
}

export function getMaxMovesPerTurn(
  card: CardInstance,
  turnNumber: number,
): number {
  return 1 + getFreeMoveAllowance(card, turnNumber);
}

export function cardHasStatus(
  card: CardInstance,
  statusType: StatusEffectType,
): boolean {
  return card.statusEffects.some(status => status.statusType === statusType);
}

export function isProtectedFromEnemyTargeting(card: CardInstance): boolean {
  return cardHasActiveTrait(card, 'stealth') || cardHasStatus(card, 'hexproof');
}
