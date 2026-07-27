// Card-data validator — catches authoring/engine drift that the type system
// can't: an ability's `type` (the human authoring category — "Trigger",
// "Aura", ...) and its `dsl` (what the engine actually executes) are two
// independent fields, filled in separately, and nothing enforces they agree.
// Three real shipped bugs motivated this: a `dsl: null` ability that silently
// does nothing, a Hero card carrying 5 abilities against a 3-ability design
// rule, and abilities typed [Trigger] that the engine treats as event-driven
// (not activated) — so the printed cost is never charged.
//
// Pure + data-driven: never reads card JSON itself, never touches sim-data.

export type Severity = 'error' | 'warn';

export interface Finding {
  readonly severity: Severity;
  readonly cardId: number;
  readonly cardName: string;
  readonly abilityIndex?: number;
  readonly path?: string;
  readonly rule: string;
  readonly message: string;
}

/** Rule identifiers, one per numbered check in the spec. */
export const RULES = {
  CARD_SCHEMA: 'card-schema',
  CHARACTER_BASE_HP: 'character-base-hp',
  UNIQUE_DEFINITION_ID: 'unique-definition-id',
  UNIQUE_STABLE_SLUG: 'unique-stable-slug',
  RESOURCE_TYPE: 'resource-type',
  X_COST_TYPE: 'x-cost-type',
  REFERENCE: 'reference',
  UNKNOWN_DSL_NODE: 'unknown-dsl-node',
  CHOOSE_ONE_REACHABILITY: 'choose-one-reachability',
  TARGET_REACHABILITY: 'target-reachability',
  TAG_POPULATION: 'tag-population',
  DURATION_COMPATIBILITY: 'duration-compatibility',
  CONDITION_SEMANTICS: 'condition-semantics',
  DYNAMIC_STAT_AXIS: 'dynamic-stat-axis',
  TEXT_DSL_HINT: 'text-dsl-hint',
  EXCEPTION_REGISTER: 'exception-register',
  DSL_NULL: 'dsl-null',
  HERO_ABILITY_COUNT: 'hero-ability-count',
  TRANSFORMED_ABILITY_COUNT: 'transformed-ability-count',
  ACTIVATED_MISMATCH: 'activated-mismatch',
  REACT_ON_HERO: 'react-on-hero',
  REACT_FLAG_MISMATCH: 'react-flag-mismatch',
  EVENT_DRIVEN_COST: 'event-driven-cost',
  REACT_ON_EQUIPMENT: 'react-on-equipment',
  ABILITY_COUNT_REGRESSION: 'ability-count-regression',
} as const;

export interface ValidatorAbilityCost {
  readonly mana?: number;
  readonly energy?: number;
  readonly flexible?: boolean;
  readonly xMana?: boolean;
  readonly xEnergy?: boolean;
}

export interface ValidatorAbilityDsl {
  readonly type?: string;
  readonly trigger?: { readonly type?: string } | null;
  readonly react?: boolean;
  readonly effects?: readonly unknown[];
  readonly xCostResource?: string;
}

export interface ValidatorAbility {
  readonly type: string;
  readonly cost?: ValidatorAbilityCost | null;
  readonly dsl: ValidatorAbilityDsl | null;
  readonly effect?: string;
}

export interface ValidatorCard {
  readonly id: number;
  readonly cardCode?: string;
  readonly name: string;
  readonly cardType: string;
  readonly resourceType?: string;
  readonly resourceTypes?: readonly string[];
  readonly alignment?: readonly string[];
  readonly tags?: readonly string[];
  readonly traits?: readonly string[];
  readonly cost?: {
    readonly mana?: number;
    readonly energy?: number;
    readonly flexible?: number;
  } | null;
  readonly stats?: {
    readonly hp?: number;
    readonly atk?: number;
    readonly arm?: number;
  } | null;
  readonly abilities: readonly ValidatorAbility[];
  readonly transformationId?: number | null;
  readonly originalHeroId?: number | null;
}

export interface SemanticException {
  readonly cardId: number;
  readonly abilityIndex: number;
  readonly rule: string;
  readonly owner: string;
  readonly rationale: string;
  readonly expectedSemantics: string;
  readonly scenarioId: string;
}

export interface ValidateCardDataOptions {
  /** A previous export, keyed by card id, to compare ability counts against. */
  readonly previousCards?: readonly ValidatorCard[];
  readonly exceptions?: readonly SemanticException[];
}

// ── Ability-level rules ────────────────────────────────────────────────────

function checkDslNull(card: ValidatorCard, ability: ValidatorAbility, i: number): Finding | null {
  if (ability.dsl != null) return null;
  return {
    severity: 'error',
    cardId: card.id,
    cardName: card.name,
    abilityIndex: i,
    rule: RULES.DSL_NULL,
    message: `Ability ${String(i)} (${ability.type}) has dsl: null — prose-only, the engine executes nothing.`,
  };
}

function checkActivatedMismatch(
  card: ValidatorCard,
  ability: ValidatorAbility,
  i: number,
): Finding | null {
  if (ability.type !== 'Trigger' && ability.type !== 'Ultimate') return null;
  if (ability.dsl == null) return null; // already flagged by DSL_NULL
  if (ability.dsl.trigger?.type === 'activated') return null;
  return {
    severity: 'error',
    cardId: card.id,
    cardName: card.name,
    abilityIndex: i,
    rule: RULES.ACTIVATED_MISMATCH,
    message: `Ability ${String(i)} is typed [${ability.type}] (an ACTIVATED ability per the Rulebook) but dsl.trigger.type is '${String(ability.dsl.trigger?.type)}', not 'activated' — this fires on an event, not on activation.`,
  };
}

function checkReactOnHero(
  card: ValidatorCard,
  ability: ValidatorAbility,
  i: number,
): Finding | null {
  if (ability.type !== 'React') return null;
  if (card.cardType !== 'H' && card.cardType !== 'T') return null;
  return {
    severity: 'error',
    cardId: card.id,
    cardName: card.name,
    abilityIndex: i,
    rule: RULES.REACT_ON_HERO,
    message: `Ability ${String(i)} is typed [React] on a ${card.cardType === 'H' ? 'Hero' : 'Transformed'} card — no React on heroes.`,
  };
}

function checkReactFlagMismatch(
  card: ValidatorCard,
  ability: ValidatorAbility,
  i: number,
): Finding | null {
  const typedReact = ability.type === 'React';
  const dslReact = ability.dsl?.react === true;
  if (typedReact === dslReact) return null;
  return {
    severity: 'error',
    cardId: card.id,
    cardName: card.name,
    abilityIndex: i,
    rule: RULES.REACT_FLAG_MISMATCH,
    message: typedReact
      ? `Ability ${String(i)} is typed [React] but dsl.react is not true — the engine won't treat it as a React.`
      : `Ability ${String(i)} has dsl.react === true but is typed [${ability.type}], not [React].`,
  };
}

function checkEventDrivenCost(
  card: ValidatorCard,
  ability: ValidatorAbility,
  i: number,
): Finding | null {
  if (ability.dsl == null) return null; // already flagged by DSL_NULL
  const cost = (ability.cost?.mana ?? 0) + (ability.cost?.energy ?? 0);
  if (cost <= 0) return null;
  if (ability.dsl.trigger?.type === 'activated') return null;
  return {
    severity: 'error',
    cardId: card.id,
    cardName: card.name,
    abilityIndex: i,
    rule: RULES.EVENT_DRIVEN_COST,
    message: `Ability ${String(i)} (${ability.type}) has a nonzero printed cost (${String(cost)}) but is event-driven (dsl.trigger.type '${String(ability.dsl.trigger?.type)}') — the engine never charges it.`,
  };
}

function checkReactOnEquipment(
  card: ValidatorCard,
  ability: ValidatorAbility,
  i: number,
): Finding | null {
  if (ability.type !== 'React' || card.cardType !== 'E') return null;
  return {
    severity: 'warn',
    cardId: card.id,
    cardName: card.name,
    abilityIndex: i,
    rule: RULES.REACT_ON_EQUIPMENT,
    message: `Ability ${String(i)} is typed [React] on Equipment — owner ruling pending on whether this exhausts the wearer.`,
  };
}

const ABILITY_RULES = [
  checkDslNull,
  checkActivatedMismatch,
  checkReactOnHero,
  checkReactFlagMismatch,
  checkEventDrivenCost,
  checkReactOnEquipment,
];

// ── Card-level rules ────────────────────────────────────────────────────────

function countByType(abilities: readonly ValidatorAbility[], type: string): number {
  return abilities.filter((a) => a.type === type).length;
}

function checkAbilityCounts(card: ValidatorCard): Finding[] {
  const required =
    card.cardType === 'H'
      ? ['Aura', 'Trigger']
      : card.cardType === 'T'
        ? ['Aura', 'Trigger', 'Ultimate']
        : null;
  if (required == null) return [];
  const rule = card.cardType === 'H' ? RULES.HERO_ABILITY_COUNT : RULES.TRANSFORMED_ABILITY_COUNT;
  const findings: Finding[] = [];
  for (const type of required) {
    const n = countByType(card.abilities, type);
    if (n !== 1) {
      findings.push({
        severity: 'error',
        cardId: card.id,
        cardName: card.name,
        rule,
        message: `${card.cardType === 'H' ? 'Hero' : 'Transformed'} card has ${String(n)} [${type}] abilities, expected exactly 1.`,
      });
    }
  }
  return findings;
}

function checkAbilityCountRegression(
  card: ValidatorCard,
  previousById: ReadonlyMap<number, ValidatorCard>,
): Finding | null {
  const previous = previousById.get(card.id);
  if (previous == null) return null;
  if (card.abilities.length >= previous.abilities.length) return null;
  return {
    severity: 'warn',
    cardId: card.id,
    cardName: card.name,
    rule: RULES.ABILITY_COUNT_REGRESSION,
    message: `Ability count dropped from ${String(previous.abilities.length)} to ${String(card.abilities.length)} vs the previous export.`,
  };
}

// ── Strict schema + semantic lint ───────────────────────────────────────────

type UnknownRecord = Readonly<Record<string, unknown>>;

const CARD_TYPES = new Set(['C', 'S', 'E', 'H', 'T', 'R']);
const ABILITY_TYPES = new Set([
  'Aura',
  'Cast',
  'Counter',
  'Deploy',
  'Flash',
  'Last Breath',
  'React',
  'Resource',
  'Trigger',
  'Ultimate',
]);
const DSL_TYPES = new Set(['triggered', 'aura', 'stat_grant']);
const EFFECT_TYPES = new Set([
  'deal_damage',
  'heal',
  'modify_stats',
  'draw_cards',
  'scry',
  'deploy_token',
  'destroy',
  'sacrifice',
  'bounce',
  'exile',
  'discard',
  'return_from_discard',
  'counter_spell',
  'gain_resource',
  'cost_reduction',
  'grant_trait',
  'grant_ability',
  'move',
  'apply_status',
  'cleanse',
  'search_deck',
  'shuffle_into_deck',
  'copy_card',
  'deploy_from_deck',
  'attach_as_equipment',
  'choose_one',
  'conditional',
  'composite',
  'replacement',
  'scheduled',
]);
const TARGET_TYPES_REQUIRING_SIDE = new Set([
  'hero',
  'target_character',
  'target_equipment',
  'all_characters',
  'all_characters_in_zone',
  'up_to',
  'target_card_in_discard',
  'random',
  'player',
]);
const DURATION_TYPES = new Set([
  'instant',
  'until_end_of_turn',
  'for_combat',
  'until_next_upkeep',
  'while_in_play',
  'permanent',
]);

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function semanticFinding(
  card: ValidatorCard,
  abilityIndex: number | undefined,
  path: string,
  rule: string,
  message: string,
  severity: Severity = 'error',
): Finding {
  return {
    severity,
    cardId: card.id,
    cardName: card.name,
    ...(abilityIndex === undefined ? {} : { abilityIndex }),
    path,
    rule,
    message,
  };
}

function strictCardSchema(card: ValidatorCard): Finding[] {
  const out: Finding[] = [];
  const fail = (path: string, message: string, rule: string = RULES.CARD_SCHEMA): void => {
    out.push(semanticFinding(card, undefined, path, rule, message));
  };
  if (!Number.isSafeInteger(card.id) || card.id <= 0) fail('id', 'Definition ID must be a positive safe integer.');
  if (typeof card.name !== 'string' || card.name.trim().length === 0) {
    fail('name', 'Card name must be non-empty.');
  }
  if (
    typeof card.cardCode !== 'string' ||
    !/^CORE\d+-[A-Z]-[A-Z]-\d{3}$/.test(card.cardCode)
  ) {
    fail('cardCode', 'Stable cardCode is required and must match CORE<set>-<type>-<alignment>-<number>.');
  }
  if (!CARD_TYPES.has(card.cardType)) fail('cardType', `Unsupported card type '${card.cardType}'.`);
  if (!Array.isArray(card.abilities)) fail('abilities', 'abilities must be an array.');
  if (!Array.isArray(card.alignment) || card.alignment.length === 0) {
    fail('alignment', 'At least one explicit alignment is required.');
  }
  if (!Array.isArray(card.tags) || !Array.isArray(card.traits)) {
    fail('tags/traits', 'tags and traits must both be explicit arrays.');
  }
  const cost = record(card.cost);
  if (cost === null) {
    fail('cost', 'Card cost must be an explicit object.');
  } else {
    for (const component of ['mana', 'energy', 'flexible'] as const) {
      const value = cost[component];
      if (!Number.isSafeInteger(value) || Number(value) < 0) {
        fail(`cost.${component}`, `${component} cost must be a non-negative safe integer.`);
      }
    }
  }
  if (card.stats !== null && card.stats !== undefined) {
    const stats = record(card.stats);
    if (stats === null) fail('stats', 'stats must be null or an object.');
    else {
      for (const stat of ['hp', 'atk', 'arm'] as const) {
        const value = stats[stat];
        if (!Number.isSafeInteger(value) || Number(value) < 0) {
          fail(`stats.${stat}`, `${stat} must be a non-negative safe integer.`);
        }
      }
      if (
        card.cardType === 'C' &&
        Number.isSafeInteger(stats.hp) &&
        Number(stats.hp) <= 0
      ) {
        fail(
          'stats.hp',
          'Character definitions require positive base HP so a legal deployment cannot create an already-dead battlefield card.',
          RULES.CHARACTER_BASE_HP,
        );
      }
    }
  }
  if (card.cardType === 'R') {
    if (card.resourceType !== 'mana' && card.resourceType !== 'energy') {
      fail('resourceType', 'Resource definitions require explicit mana or energy type.', RULES.RESOURCE_TYPE);
    }
  } else if (card.resourceType !== undefined) {
    fail('resourceType', 'Only Resource definitions may declare resourceType.', RULES.RESOURCE_TYPE);
  }
  if (card.resourceTypes !== undefined) {
    if (card.cardType !== 'H') {
      fail(
        'resourceTypes',
        'Only Hero definitions may declare resourceTypes.',
        RULES.RESOURCE_TYPE,
      );
    } else if (
      !Array.isArray(card.resourceTypes) ||
      card.resourceTypes.length === 0 ||
      new Set(card.resourceTypes).size !== card.resourceTypes.length ||
      card.resourceTypes.some(
        (resourceType) =>
          resourceType !== 'mana' && resourceType !== 'energy',
      )
    ) {
      fail(
        'resourceTypes',
        'Hero resourceTypes must be a non-empty unique list of mana and/or energy.',
        RULES.RESOURCE_TYPE,
      );
    }
  }
  return out;
}

function validateAbilitySchema(
  card: ValidatorCard,
  ability: ValidatorAbility,
  abilityIndex: number,
): Finding[] {
  const out: Finding[] = [];
  const base = `abilities[${String(abilityIndex)}]`;
  if (!ABILITY_TYPES.has(ability.type)) {
    out.push(semanticFinding(card, abilityIndex, `${base}.type`, RULES.CARD_SCHEMA, `Unsupported printed ability type '${ability.type}'.`));
  }
  if (ability.dsl === null) return out;
  if (ability.dsl.type === undefined || !DSL_TYPES.has(ability.dsl.type)) {
    out.push(semanticFinding(card, abilityIndex, `${base}.dsl.type`, RULES.UNKNOWN_DSL_NODE, `Unsupported ability DSL type '${String(ability.dsl.type)}'.`));
  }
  const xMana = ability.cost?.xMana === true;
  const xEnergy = ability.cost?.xEnergy === true;
  if (xMana && xEnergy) {
    out.push(semanticFinding(card, abilityIndex, `${base}.cost`, RULES.X_COST_TYPE, 'An ability cannot declare both xMana and xEnergy.'));
  }
  const expectedX = xMana ? 'mana' : xEnergy ? 'energy' : undefined;
  if (
    (expectedX !== undefined && ability.dsl.xCostResource !== expectedX) ||
    (expectedX === undefined && ability.dsl.xCostResource !== undefined)
  ) {
    out.push(semanticFinding(
      card,
      abilityIndex,
      `${base}.dsl.xCostResource`,
      RULES.X_COST_TYPE,
      `Printed X component and hydrated xCostResource disagree (expected ${String(expectedX)}).`,
    ));
  }
  return out;
}

function collectEffects(dsl: ValidatorAbilityDsl): readonly unknown[] {
  return Array.isArray(dsl.effects) ? dsl.effects : [];
}

function walkCondition(
  card: ValidatorCard,
  abilityIndex: number,
  value: unknown,
  path: string,
  out: Finding[],
): void {
  const condition = record(value);
  if (condition === null) {
    out.push(semanticFinding(card, abilityIndex, path, RULES.CONDITION_SEMANTICS, 'Condition must be an object.'));
    return;
  }
  if (condition.type === 'triggering_card_cost') {
    if (!Number.isSafeInteger(condition.value) || Number(condition.value) < 0) {
      out.push(semanticFinding(card, abilityIndex, path, RULES.CONDITION_SEMANTICS, 'triggering_card_cost requires an authored non-negative numeric value; self-comparison is forbidden.'));
    }
  }
  if (condition.type === 'and' || condition.type === 'or') {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
      out.push(semanticFinding(card, abilityIndex, `${path}.conditions`, RULES.CONDITION_SEMANTICS, `${condition.type} requires at least one child condition.`));
    } else {
      condition.conditions.forEach((child, index) => {
        walkCondition(card, abilityIndex, child, `${path}.conditions[${String(index)}]`, out);
      });
    }
  } else if (condition.type === 'not') {
    walkCondition(card, abilityIndex, condition.condition, `${path}.condition`, out);
  }
}

function lintTarget(
  card: ValidatorCard,
  abilityIndex: number,
  value: unknown,
  path: string,
  referencedTags: Set<string>,
  out: Finding[],
): void {
  const target = record(value);
  if (target === null || typeof target.type !== 'string') {
    out.push(semanticFinding(card, abilityIndex, path, RULES.TARGET_REACHABILITY, 'Target must have a supported type.'));
    return;
  }
  if (
    TARGET_TYPES_REQUIRING_SIDE.has(target.type) &&
    target.side !== 'allied' &&
    target.side !== 'enemy' &&
    target.side !== 'any'
  ) {
    out.push(semanticFinding(card, abilityIndex, `${path}.side`, RULES.TARGET_REACHABILITY, `${target.type} requires explicit allied, enemy, or any side.`));
  }
  if (target.type === 'up_to') {
    const count = record(target.count);
    if (
      !(Number.isSafeInteger(target.count) && Number(target.count) >= 0) &&
      count === null
    ) {
      out.push(semanticFinding(card, abilityIndex, `${path}.count`, RULES.TARGET_REACHABILITY, 'up_to requires a non-negative integer or Amount expression.'));
    }
  }
  const filter = record(target.filter);
  if (typeof filter?.tag === 'string') referencedTags.add(filter.tag);
  if (target.type === 'copy_of') lintTarget(card, abilityIndex, target.base, `${path}.base`, referencedTags, out);
}

function lintEffects(
  card: ValidatorCard,
  abilityIndex: number,
  effects: readonly unknown[],
  path: string,
  referencedTags: Set<string>,
  definedTokenTags: Set<string>,
  out: Finding[],
): void {
  effects.forEach((value, index) => {
    const effectPath = `${path}[${String(index)}]`;
    const effect = record(value);
    if (effect === null || typeof effect.type !== 'string' || !EFFECT_TYPES.has(effect.type)) {
      out.push(semanticFinding(card, abilityIndex, effectPath, RULES.UNKNOWN_DSL_NODE, `Unsupported effect type '${String(effect?.type)}'.`));
      return;
    }
    if ('target' in effect) lintTarget(card, abilityIndex, effect.target, `${effectPath}.target`, referencedTags, out);
    const duration = record(effect.duration);
    if (duration !== null && (typeof duration.type !== 'string' || !DURATION_TYPES.has(duration.type))) {
      out.push(semanticFinding(card, abilityIndex, `${effectPath}.duration`, RULES.DURATION_COMPATIBILITY, `Unsupported duration '${String(duration.type)}'.`));
    }
    if (
      duration?.type === 'instant' &&
      (effect.type === 'modify_stats' || effect.type === 'grant_trait' || effect.type === 'grant_ability')
    ) {
      out.push(semanticFinding(card, abilityIndex, `${effectPath}.duration`, RULES.DURATION_COMPATIBILITY, `instant ${effect.type} has no persistent semantic effect and is forbidden.`));
    }
    if (effect.type === 'choose_one') {
      if (!Array.isArray(effect.options) || effect.options.length < 2) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.options`, RULES.CHOOSE_ONE_REACHABILITY, 'choose_one requires at least two reachable modes.'));
      } else {
        const labels = new Set<string>();
        effect.options.forEach((optionValue, optionIndex) => {
          const option = record(optionValue);
          const optionPath = `${effectPath}.options[${String(optionIndex)}]`;
          if (option === null || typeof option.label !== 'string' || option.label.trim() === '') {
            out.push(semanticFinding(card, abilityIndex, `${optionPath}.label`, RULES.CHOOSE_ONE_REACHABILITY, 'Every mode needs a non-empty stable label.'));
          } else if (labels.has(option.label)) {
            out.push(semanticFinding(card, abilityIndex, `${optionPath}.label`, RULES.CHOOSE_ONE_REACHABILITY, `Duplicate mode label '${option.label}'.`));
          } else labels.add(option.label);
          if (!Array.isArray(option?.effects) || option.effects.length === 0) {
            out.push(semanticFinding(card, abilityIndex, `${optionPath}.effects`, RULES.CHOOSE_ONE_REACHABILITY, 'Every mode needs at least one executable effect or an explicit authored no-op.'));
          } else {
            lintEffects(card, abilityIndex, option.effects, `${optionPath}.effects`, referencedTags, definedTokenTags, out);
          }
        });
      }
    } else if (effect.type === 'conditional') {
      walkCondition(card, abilityIndex, effect.condition, `${effectPath}.condition`, out);
      if (!Array.isArray(effect.ifTrue) || effect.ifTrue.length === 0) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.ifTrue`, RULES.CONDITION_SEMANTICS, 'conditional.ifTrue must be non-empty.'));
      } else lintEffects(card, abilityIndex, effect.ifTrue, `${effectPath}.ifTrue`, referencedTags, definedTokenTags, out);
      if (Array.isArray(effect.ifFalse)) lintEffects(card, abilityIndex, effect.ifFalse, `${effectPath}.ifFalse`, referencedTags, definedTokenTags, out);
    } else if (effect.type === 'composite' || effect.type === 'scheduled') {
      if (!Array.isArray(effect.effects) || effect.effects.length === 0) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.effects`, RULES.UNKNOWN_DSL_NODE, `${effect.type} requires executable child effects.`));
      } else lintEffects(card, abilityIndex, effect.effects, `${effectPath}.effects`, referencedTags, definedTokenTags, out);
      if (effect.type === 'scheduled' && effect.condition !== undefined) {
        walkCondition(card, abilityIndex, effect.condition, `${effectPath}.condition`, out);
      }
    } else if (effect.type === 'replacement') {
      if (!Array.isArray(effect.instead)) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.instead`, RULES.UNKNOWN_DSL_NODE, 'replacement.instead must be an array.'));
      } else lintEffects(card, abilityIndex, effect.instead, `${effectPath}.instead`, referencedTags, definedTokenTags, out);
    } else if (effect.type === 'grant_ability') {
      const granted = record(effect.ability);
      if (!Array.isArray(granted?.effects)) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.ability.effects`, RULES.UNKNOWN_DSL_NODE, 'Granted ability requires executable effects.'));
      } else lintEffects(card, abilityIndex, granted.effects, `${effectPath}.ability.effects`, referencedTags, definedTokenTags, out);
      if (granted?.condition !== undefined) walkCondition(card, abilityIndex, granted.condition, `${effectPath}.ability.condition`, out);
    }
    if (effect.type === 'deploy_token') {
      const token = record(effect.token);
      if (
        token === null ||
        typeof token.name !== 'string' ||
        !Number.isSafeInteger(token.atk) ||
        Number(token.atk) < 0 ||
        !Number.isSafeInteger(token.hp) ||
        Number(token.hp) <= 0
      ) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.token`, RULES.CARD_SCHEMA, 'Token requires stable name and legal non-negative ATK / positive HP.'));
      }
      if (Array.isArray(token?.tags)) {
        token.tags.forEach((tag) => {
          if (typeof tag === 'string' && tag.length > 0) definedTokenTags.add(tag);
        });
      }
      const hasCount = Number.isSafeInteger(effect.count) && Number(effect.count) > 0;
      if (effect.inEachEmpty !== true && !hasCount) {
        out.push(semanticFinding(card, abilityIndex, `${effectPath}.count`, RULES.CARD_SCHEMA, 'deploy_token requires positive count or inEachEmpty=true.'));
      }
    }
    if (effect.type === 'modify_stats' && effect.dynamicModifier !== undefined) {
      const dynamic = record(effect.dynamicModifier);
      if (dynamic?.type === 'multiply') {
        if (
          !Array.isArray(dynamic.stats) ||
          dynamic.stats.length === 0 ||
          dynamic.stats.some((stat) => stat !== 'atk' && stat !== 'hp' && stat !== 'arm') ||
          new Set(dynamic.stats).size !== dynamic.stats.length
        ) {
          out.push(semanticFinding(card, abilityIndex, `${effectPath}.dynamicModifier.stats`, RULES.DYNAMIC_STAT_AXIS, 'multiply requires a non-empty, unique list of explicit stat axes.'));
        }
      }
    }
  });
}

function semanticLint(
  cards: readonly ValidatorCard[],
): Finding[] {
  const out: Finding[] = [];
  const referencedTags = new Set<string>();
  const definedTags = new Set<string>();
  const definedTokenTags = new Set<string>();
  for (const card of cards) {
    card.tags?.forEach((tag) => definedTags.add(tag));
    for (let i = 0; i < card.abilities.length; i++) {
      const ability = card.abilities[i]!;
      out.push(...validateAbilitySchema(card, ability, i));
      if (ability.dsl === null) continue;
      if (ability.dsl.trigger !== undefined && ability.dsl.trigger !== null) {
        const filter = record((ability.dsl.trigger as UnknownRecord).filter);
        if (typeof filter?.tag === 'string') referencedTags.add(filter.tag);
      }
      if (ability.dsl.type === 'triggered' && !Array.isArray(ability.dsl.effects)) {
        out.push(semanticFinding(card, i, `abilities[${String(i)}].dsl.effects`, RULES.UNKNOWN_DSL_NODE, 'Triggered DSL requires an effects array.'));
      }
      lintEffects(
        card,
        i,
        collectEffects(ability.dsl),
        `abilities[${String(i)}].dsl.effects`,
        referencedTags,
        definedTokenTags,
        out,
      );
      const prose = ability.effect?.toLowerCase() ?? '';
      const effectsJson = JSON.stringify(ability.dsl);
      if (
        (prose.includes('choose one:') || prose.includes('choose one of')) &&
        !effectsJson.includes('"choose_one"')
      ) {
        out.push(semanticFinding(card, i, `abilities[${String(i)}].effect`, RULES.TEXT_DSL_HINT, 'Printed “choose one” has no choose_one DSL node.'));
      }
      if (
        (prose.includes('reserve is full') || prose.includes('frontline is full')) &&
        !effectsJson.includes('"zone_full"')
      ) {
        out.push(semanticFinding(card, i, `abilities[${String(i)}].effect`, RULES.TEXT_DSL_HINT, 'Printed full-zone fallback has no zone_full branch.'));
      }
    }
  }
  for (const tag of referencedTags) {
    if (!definedTags.has(tag) && !definedTokenTags.has(tag)) {
      const first = cards[0] ?? { id: 0, name: '<pool>', cardType: '', abilities: [] };
      out.push(semanticFinding(first, undefined, 'pool.tags', RULES.TAG_POPULATION, `Referenced tag '${tag}' has no printed card or token population.`));
    }
  }
  return out;
}

function globalSchema(cards: readonly ValidatorCard[]): Finding[] {
  const out = cards.flatMap(strictCardSchema);
  const byId = new Map<number, ValidatorCard>();
  const byCode = new Map<string, ValidatorCard>();
  for (const card of cards) {
    const priorId = byId.get(card.id);
    if (priorId !== undefined) {
      out.push(semanticFinding(card, undefined, 'id', RULES.UNIQUE_DEFINITION_ID, `Definition ID ${String(card.id)} duplicates ${priorId.name}.`));
    } else byId.set(card.id, card);
    if (card.cardCode !== undefined) {
      const priorCode = byCode.get(card.cardCode);
      if (priorCode !== undefined) {
        out.push(semanticFinding(card, undefined, 'cardCode', RULES.UNIQUE_STABLE_SLUG, `cardCode ${card.cardCode} duplicates ${priorCode.name}.`));
      } else byCode.set(card.cardCode, card);
    }
  }
  for (const card of cards) {
    if (card.transformationId !== null && card.transformationId !== undefined) {
      const target = byId.get(card.transformationId);
      if (card.cardType !== 'H' || target?.cardType !== 'T' || target.originalHeroId !== card.id) {
        out.push(semanticFinding(card, undefined, 'transformationId', RULES.REFERENCE, 'Hero transformationId must reference a reciprocal Transformed definition.'));
      }
    }
    if (card.originalHeroId !== null && card.originalHeroId !== undefined) {
      const target = byId.get(card.originalHeroId);
      if (card.cardType !== 'T' || target?.cardType !== 'H' || target.transformationId !== card.id) {
        out.push(semanticFinding(card, undefined, 'originalHeroId', RULES.REFERENCE, 'Transformed originalHeroId must reference a reciprocal Hero definition.'));
      }
    }
  }
  return [...out, ...semanticLint(cards)];
}

function validateExceptionRegister(
  cards: readonly ValidatorCard[],
  exceptions: readonly SemanticException[],
): Finding[] {
  const byId = new Set(cards.map((card) => card.id));
  const out: Finding[] = [];
  for (const exception of exceptions) {
    const card = cards.find((candidate) => candidate.id === exception.cardId) ??
      ({ id: exception.cardId, name: '<missing>', cardType: '', abilities: [] } satisfies ValidatorCard);
    if (
      !byId.has(exception.cardId) ||
      !Number.isSafeInteger(exception.abilityIndex) ||
      exception.abilityIndex < 0 ||
      exception.abilityIndex >= card.abilities.length ||
      !exception.rule ||
      !exception.owner.trim() ||
      !exception.rationale.trim() ||
      !exception.expectedSemantics.trim() ||
      !exception.scenarioId.trim()
    ) {
      out.push(semanticFinding(card, exception.abilityIndex, 'exceptions', RULES.EXCEPTION_REGISTER, 'Semantic exception is stale, unowned, or missing rationale/expected semantics/scenario ID.'));
    }
  }
  return out;
}

function applyOwnedExceptions(
  cards: readonly ValidatorCard[],
  findings: readonly Finding[],
  exceptions: readonly SemanticException[],
): Finding[] {
  const out = [...findings];
  for (const exception of exceptions) {
    const matchIndex = out.findIndex(
      (finding) =>
        finding.cardId === exception.cardId &&
        finding.abilityIndex === exception.abilityIndex &&
        finding.rule === exception.rule,
    );
    if (matchIndex !== -1) {
      out.splice(matchIndex, 1);
      continue;
    }
    const card = cards.find((candidate) => candidate.id === exception.cardId) ??
      ({ id: exception.cardId, name: '<missing>', cardType: '', abilities: [] } satisfies ValidatorCard);
    out.push(semanticFinding(
      card,
      exception.abilityIndex,
      'exceptions',
      RULES.EXCEPTION_REGISTER,
      `Exception for '${exception.rule}' is stale because no matching semantic finding exists.`,
    ));
  }
  return out;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Validate a full card-data export. Pure; never reads or writes files. */
export function validateCardData(
  cards: readonly ValidatorCard[],
  options: ValidateCardDataOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const previousById = new Map((options.previousCards ?? []).map((c) => [c.id, c]));

  findings.push(...globalSchema(cards));
  for (const card of cards) {
    for (let i = 0; i < card.abilities.length; i++) {
      const ability = card.abilities[i] as ValidatorAbility;
      for (const rule of ABILITY_RULES) {
        const finding = rule(card, ability, i);
        if (finding != null) findings.push(finding);
      }
    }
    findings.push(...checkAbilityCounts(card));
    const regression = checkAbilityCountRegression(card, previousById);
    if (regression != null) findings.push(regression);
  }
  const exceptions = options.exceptions ?? [];
  const registerFindings = validateExceptionRegister(cards, exceptions);
  if (registerFindings.length > 0) return [...findings, ...registerFindings];
  return applyOwnedExceptions(cards, findings, exceptions);
}
