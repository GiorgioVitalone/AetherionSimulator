import type { CardInstance, CardSnapshot } from '../types/game-state.js';
import type { Trait } from '../types/common.js';

type TraitIdentity = Pick<CardInstance, 'traits'> &
  Partial<Pick<CardInstance, 'grantedTraits'>>;
type TagIdentity = Pick<CardInstance, 'tags'>;

/** Canonical mechanical trait view used by rules, effects, combat, and policies. */
export function effectiveTraits(card: TraitIdentity): readonly Trait[] {
  return [
    ...new Set<Trait>([
      ...card.traits,
      ...(card.grantedTraits ?? []).map((grant) => grant.trait),
    ]),
  ];
}

export function hasEffectiveTrait(card: TraitIdentity, trait: Trait): boolean {
  return (
    card.traits.includes(trait) ||
    (card.grantedTraits ?? []).some((grant) => grant.trait === trait)
  );
}

export function hasEffectiveTag(card: TagIdentity, tag: string): boolean {
  return card.tags.includes(tag);
}

export function snapshotCard(card: CardInstance): CardSnapshot {
  return {
    instanceId: card.instanceId,
    cardDefId: card.cardDefId,
    cardType: card.cardType,
    traits: effectiveTraits(card),
    tags: [...card.tags],
  };
}
