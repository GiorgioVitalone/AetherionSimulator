import manifestJson from '../../sim-data/ruleset-current.json' with { type: 'json' };
import type { GameConfig } from '../types/game-state.js';

export type ArtifactStatus = 'legacy' | 'diagnostic' | 'candidate' | 'ratified';

export interface RulesManifest {
  readonly formatVersion: 1;
  readonly profileId: 'current';
  readonly semanticVersion: string;
  readonly status: ArtifactStatus;
  readonly rulebook: {
    readonly path: string;
    readonly revision: string;
    readonly sha256: string;
  };
  readonly compatibility: {
    readonly engineSchema: string;
    readonly cardSchema: string;
    readonly replaySchema: string;
  };
  readonly rules: {
    readonly setup: {
      readonly resourceDeckSize: number;
      readonly firstPlayerSelection: 'random_winner_chooses';
      readonly secondPlayerOpeningCard: 'after_mulligans';
      readonly firstPlayerMainDeckDraw: 'skip';
      readonly firstPlayerAttack: 'forbidden';
    };
    readonly actions: {
      readonly executionValidation: 'authoritative';
      readonly activatedAbilityLimit: 'once_per_turn_unless_printed';
      readonly flashTiming: 'any_time';
      readonly responseWindows: 'all_declarations';
      readonly transformTiming: 'start_of_turn_after_upkeep_before_strategy';
      readonly ultimateOnTransformTurn: 'forbidden';
    };
    readonly effects: {
      readonly allResolution: 'simultaneous_snapshot';
      readonly allUsesTargetProtection: false;
      readonly drawFromEmptyMainDeck: 'immediate_loss';
      readonly choiceResolution: 'explicit_continuation';
      readonly stateBasedDeath: 'after_each_atomic_transition';
    };
    readonly timing: {
      readonly triggerOrder: 'apnap_owner_choice';
      readonly castObservedAt: 'declaration';
      readonly attackExhaustionAt: 'declaration';
      readonly equipmentCommitAt: 'resolution';
      readonly reserveGenerationTiming: 'upkeep_step_4';
      readonly guardExhaustion: 'engine_failure';
    };
    readonly statuses: {
      readonly persistentApplication: 'replace_with_higher';
      readonly regenerationApplication: 'replace_with_higher';
      readonly persistentDamagePipeline: 'ordinary_effect_damage';
      readonly stunTick: 'controllers_upkeep_once';
      readonly combatTraitExpiry: 'after_combat';
      readonly instantTraitExpiry: 'after_atomic_transition';
    };
    readonly zones: {
      readonly discardForEnergyDestination: 'exile';
      readonly exileRepresentation: 'durable_zone';
      readonly equipmentRemovalDestination: 'discard';
      readonly equipmentRemovalEvent: 'equipment_removed';
    };
    readonly economy: {
      readonly costFloor: 1;
      readonly xCostTyping: 'printed_component';
      readonly flexiblePayment: 'player_choice';
      readonly reserveGeneration: 'optional_strain';
      readonly resourceTypeSource: 'schema';
    };
  };
  readonly engineConfig: GameConfig;
  readonly constraints: readonly {
    readonly kind: 'mutually_exclusive';
    readonly fields: readonly string[];
  }[];
  readonly evidence: {
    readonly review: string;
    readonly plan: string;
    readonly decisionRegister: string;
    readonly baseline: string;
  };
}

const TOP_LEVEL_KEYS = [
  'formatVersion',
  'profileId',
  'semanticVersion',
  'status',
  'rulebook',
  'compatibility',
  'rules',
  'engineConfig',
  'constraints',
  'evidence',
] as const;

const RULE_GROUP_KEYS = [
  'setup',
  'actions',
  'effects',
  'timing',
  'statuses',
  'zones',
  'economy',
] as const;

const ENGINE_CONFIG_KEYS = [
  'terminationMode',
  'armFirstInstanceOnly',
  'costFloor',
  'reserveTapChoice',
  'reserveTapStrain',
  'secondPlayerOpeningCard',
  'explicitFirstPlayerChoice',
  'exileDiscardForEnergy',
  'resourceDeckSize',
  'apnapAnyOrderFix',
  'endPhaseOrderFix',
  'startOfTurnTriggerAfterReserve',
  'transformAtStartOfTurn',
  'heroAbilitiesOncePerTurn',
  'flashAtWill',
  'boardReactions',
  'responseWindowsOnAllActions',
  'registerPrintedTriggers',
  'equipmentTriggers',
  'reactAbilities',
  'heroAuras',
  'authoritativeTransitions',
  'explicitEffectChoices',
  'observableInteractions',
  'scopedTurnResets',
  'dispatchTurnBoundaryTriggers',
  'effectDrawDeckout',
  'stateBasedActions',
  'simultaneousAllEffects',
  'transactionalDeclarations',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${path}.${key} is unknown`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${path}.${key} is required`);
  }
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) {
    throw new Error(`${path} must be ${JSON.stringify(expected)}`);
  }
}

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): asserts value is T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`${path} must be one of ${choices.join(', ')}`);
  }
}

function nonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function positiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
}

function exactLiteralObject(
  value: unknown,
  expected: Readonly<Record<string, string | number | boolean>>,
  path: string,
): void {
  const object = objectAt(value, path);
  exactKeys(object, Object.keys(expected), path);
  for (const [key, expectedValue] of Object.entries(expected)) {
    literal(object[key], expectedValue, `${path}.${key}`);
  }
}

/**
 * Fail-closed validation for the canonical current-rules manifest.
 *
 * This is deliberately stricter than a permissive JSON decoder: omitted and
 * unknown fields both fail, because either can silently change game semantics.
 */
export function validateRulesManifest(value: unknown): RulesManifest {
  const manifest = objectAt(value, 'manifest');
  exactKeys(manifest, TOP_LEVEL_KEYS, 'manifest');
  literal(manifest.formatVersion, 1, 'manifest.formatVersion');
  literal(manifest.profileId, 'current', 'manifest.profileId');
  nonEmptyString(manifest.semanticVersion, 'manifest.semanticVersion');
  oneOf(
    manifest.status,
    ['legacy', 'diagnostic', 'candidate', 'ratified'] as const,
    'manifest.status',
  );

  const rulebook = objectAt(manifest.rulebook, 'manifest.rulebook');
  exactKeys(rulebook, ['path', 'revision', 'sha256'], 'manifest.rulebook');
  nonEmptyString(rulebook.path, 'manifest.rulebook.path');
  nonEmptyString(rulebook.revision, 'manifest.rulebook.revision');
  if (typeof rulebook.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(rulebook.sha256)) {
    throw new Error('manifest.rulebook.sha256 must be a lowercase SHA-256 digest');
  }

  const compatibility = objectAt(manifest.compatibility, 'manifest.compatibility');
  exactKeys(
    compatibility,
    ['engineSchema', 'cardSchema', 'replaySchema'],
    'manifest.compatibility',
  );
  for (const key of ['engineSchema', 'cardSchema', 'replaySchema'] as const) {
    nonEmptyString(compatibility[key], `manifest.compatibility.${key}`);
  }

  const rules = objectAt(manifest.rules, 'manifest.rules');
  exactKeys(rules, RULE_GROUP_KEYS, 'manifest.rules');
  exactLiteralObject(
    rules.setup,
    {
      resourceDeckSize: 12,
      firstPlayerSelection: 'random_winner_chooses',
      secondPlayerOpeningCard: 'after_mulligans',
      firstPlayerMainDeckDraw: 'skip',
      firstPlayerAttack: 'forbidden',
    },
    'manifest.rules.setup',
  );
  exactLiteralObject(
    rules.actions,
    {
      executionValidation: 'authoritative',
      activatedAbilityLimit: 'once_per_turn_unless_printed',
      flashTiming: 'any_time',
      responseWindows: 'all_declarations',
      transformTiming: 'start_of_turn_after_upkeep_before_strategy',
      ultimateOnTransformTurn: 'forbidden',
    },
    'manifest.rules.actions',
  );
  exactLiteralObject(
    rules.effects,
    {
      allResolution: 'simultaneous_snapshot',
      allUsesTargetProtection: false,
      drawFromEmptyMainDeck: 'immediate_loss',
      choiceResolution: 'explicit_continuation',
      stateBasedDeath: 'after_each_atomic_transition',
    },
    'manifest.rules.effects',
  );
  exactLiteralObject(
    rules.timing,
    {
      triggerOrder: 'apnap_owner_choice',
      castObservedAt: 'declaration',
      attackExhaustionAt: 'declaration',
      equipmentCommitAt: 'resolution',
      reserveGenerationTiming: 'upkeep_step_4',
      guardExhaustion: 'engine_failure',
    },
    'manifest.rules.timing',
  );
  exactLiteralObject(
    rules.statuses,
    {
      persistentApplication: 'replace_with_higher',
      regenerationApplication: 'replace_with_higher',
      persistentDamagePipeline: 'ordinary_effect_damage',
      stunTick: 'controllers_upkeep_once',
      combatTraitExpiry: 'after_combat',
      instantTraitExpiry: 'after_atomic_transition',
    },
    'manifest.rules.statuses',
  );
  exactLiteralObject(
    rules.zones,
    {
      discardForEnergyDestination: 'exile',
      exileRepresentation: 'durable_zone',
      equipmentRemovalDestination: 'discard',
      equipmentRemovalEvent: 'equipment_removed',
    },
    'manifest.rules.zones',
  );
  exactLiteralObject(
    rules.economy,
    {
      costFloor: 1,
      xCostTyping: 'printed_component',
      flexiblePayment: 'player_choice',
      reserveGeneration: 'optional_strain',
      resourceTypeSource: 'schema',
    },
    'manifest.rules.economy',
  );

  const engineConfig = objectAt(manifest.engineConfig, 'manifest.engineConfig');
  exactKeys(engineConfig, ENGINE_CONFIG_KEYS, 'manifest.engineConfig');
  literal(
    engineConfig.terminationMode,
    'resource_deck_empty_transform',
    'manifest.engineConfig.terminationMode',
  );
  positiveInteger(engineConfig.resourceDeckSize, 'manifest.engineConfig.resourceDeckSize');
  literal(engineConfig.resourceDeckSize, 12, 'manifest.engineConfig.resourceDeckSize');
  for (const key of ENGINE_CONFIG_KEYS) {
    if (key === 'terminationMode' || key === 'resourceDeckSize') continue;
    literal(engineConfig[key], true, `manifest.engineConfig.${key}`);
  }

  if (!Array.isArray(manifest.constraints) || manifest.constraints.length !== 1) {
    throw new Error('manifest.constraints must contain the canonical constraint set');
  }
  const constraint = objectAt(manifest.constraints[0], 'manifest.constraints[0]');
  exactKeys(constraint, ['kind', 'fields'], 'manifest.constraints[0]');
  literal(constraint.kind, 'mutually_exclusive', 'manifest.constraints[0].kind');
  if (
    !Array.isArray(constraint.fields) ||
    constraint.fields.length !== 2 ||
    constraint.fields[0] !== 'armOneTimeAbsolute' ||
    constraint.fields[1] !== 'armChargeAbsorb'
  ) {
    throw new Error('manifest.constraints[0].fields is not the canonical pair');
  }

  const evidence = objectAt(manifest.evidence, 'manifest.evidence');
  exactKeys(
    evidence,
    ['review', 'plan', 'decisionRegister', 'baseline'],
    'manifest.evidence',
  );
  for (const key of ['review', 'plan', 'decisionRegister', 'baseline'] as const) {
    nonEmptyString(evidence[key], `manifest.evidence.${key}`);
  }

  return value as RulesManifest;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const CURRENT_RULES_MANIFEST: RulesManifest = deepFreeze(
  validateRulesManifest(manifestJson),
);

export const CURRENT_GAME_CONFIG: GameConfig = CURRENT_RULES_MANIFEST.engineConfig;

/** The current profile is intentionally ineligible for certification until G12. */
export function assertRatified(manifest: RulesManifest = CURRENT_RULES_MANIFEST): void {
  if (manifest.status !== 'ratified') {
    throw new Error(
      `Rules profile ${manifest.profileId}@${manifest.semanticVersion} is ${manifest.status}, not ratified`,
    );
  }
}
