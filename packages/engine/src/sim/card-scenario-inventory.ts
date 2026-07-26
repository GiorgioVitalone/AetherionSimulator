import type { ValidatorCard } from './card-data-validator.js';

export type ScenarioRequirement =
  | 'trigger_or_declaration'
  | 'choose_mode'
  | 'optional_zero'
  | 'optional_max'
  | 'allied_target'
  | 'enemy_target'
  | 'any_target'
  | 'empty_zone'
  | 'full_zone'
  | 'duration_expiry';

export interface CardScenarioInventoryItem {
  readonly scenarioId: string;
  readonly cardId: number;
  readonly cardCode: string;
  readonly abilityIndex: number;
  readonly effectPath: string;
  readonly modeLabel?: string;
  readonly requirements: readonly ScenarioRequirement[];
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'mode';
}

function collectRequirements(value: unknown, out: Set<ScenarioRequirement>): void {
  const node = record(value);
  if (node === null) {
    if (Array.isArray(value)) {
      value.forEach((child) => {
        collectRequirements(child, out);
      });
    }
    return;
  }
  if (node.side === 'allied') out.add('allied_target');
  if (node.side === 'enemy') out.add('enemy_target');
  if (node.side === 'any') out.add('any_target');
  if (node.type === 'up_to') {
    out.add('optional_zero');
    out.add('optional_max');
  }
  if (node.type === 'deploy_token' || node.type === 'deploy_from_deck') {
    out.add('empty_zone');
    out.add('full_zone');
  }
  if (node.duration !== undefined) out.add('duration_expiry');
  Object.values(node).forEach((child) => {
    collectRequirements(child, out);
  });
}

function visitChooseModes(
  effects: readonly unknown[],
  path: string,
  onMode: (path: string, label: string, effects: readonly unknown[]) => void,
): number {
  let count = 0;
  effects.forEach((value, index) => {
    const effect = record(value);
    if (effect === null) return;
    const effectPath = `${path}[${String(index)}]`;
    if (effect.type === 'choose_one' && Array.isArray(effect.options)) {
      effect.options.forEach((optionValue, optionIndex) => {
        const option = record(optionValue);
        if (option === null || !Array.isArray(option.effects)) return;
        const label =
          typeof option.label === 'string'
            ? option.label
            : `option-${String(optionIndex)}`;
        const optionPath = `${effectPath}.options[${String(optionIndex)}]`;
        onMode(optionPath, label, option.effects);
        count++;
        count += visitChooseModes(option.effects, `${optionPath}.effects`, onMode);
      });
    }
    for (const childKey of ['effects', 'ifTrue', 'ifFalse', 'instead'] as const) {
      const children = effect[childKey];
      if (Array.isArray(children)) {
        count += visitChooseModes(children, `${effectPath}.${childKey}`, onMode);
      }
    }
    const granted = record(effect.ability);
    if (Array.isArray(granted?.effects)) {
      count += visitChooseModes(
        granted.effects,
        `${effectPath}.ability.effects`,
        onMode,
      );
    }
  });
  return count;
}

/**
 * Deterministically generate the certification scenario inventory. This is an
 * inventory, not a substitute for scenario execution: each item is a stable ID
 * and the state variants its test fixture must cover.
 */
export function buildCardScenarioInventory(
  cards: readonly ValidatorCard[],
): readonly CardScenarioInventoryItem[] {
  const inventory: CardScenarioInventoryItem[] = [];
  for (const card of cards) {
    const cardCode = card.cardCode ?? `card-${String(card.id)}`;
    card.abilities.forEach((ability, abilityIndex) => {
      const effects = Array.isArray(ability.dsl?.effects) ? ability.dsl.effects : [];
      const baseRequirements = new Set<ScenarioRequirement>(['trigger_or_declaration']);
      effects.forEach((effect) => {
        collectRequirements(effect, baseRequirements);
      });
      inventory.push({
        scenarioId: `${slug(cardCode)}-ability-${String(abilityIndex)}-base`,
        cardId: card.id,
        cardCode,
        abilityIndex,
        effectPath: `abilities[${String(abilityIndex)}].dsl.effects`,
        requirements: [...baseRequirements].sort(),
      });
      visitChooseModes(
        effects,
        `abilities[${String(abilityIndex)}].dsl.effects`,
        (effectPath, modeLabel, modeEffects) => {
          const requirements = new Set<ScenarioRequirement>([
            'trigger_or_declaration',
            'choose_mode',
          ]);
          modeEffects.forEach((effect) => {
            collectRequirements(effect, requirements);
          });
          inventory.push({
            scenarioId: `${slug(cardCode)}-ability-${String(abilityIndex)}-mode-${slug(modeLabel)}`,
            cardId: card.id,
            cardCode,
            abilityIndex,
            effectPath,
            modeLabel,
            requirements: [...requirements].sort(),
          });
        },
      );
    });
  }
  return inventory;
}

export function validateCardScenarioInventory(
  cards: readonly ValidatorCard[],
  inventory: readonly CardScenarioInventoryItem[],
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of inventory) {
    if (ids.has(item.scenarioId)) errors.push(`duplicate scenarioId ${item.scenarioId}`);
    ids.add(item.scenarioId);
  }
  for (const card of cards) {
    card.abilities.forEach((_, abilityIndex) => {
      if (
        !inventory.some(
          (item) => item.cardId === card.id && item.abilityIndex === abilityIndex,
        )
      ) {
        errors.push(`missing card ${String(card.id)} ability ${String(abilityIndex)}`);
      }
    });
  }
  return errors;
}
