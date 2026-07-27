import { describe, expect, it } from 'vitest';
import {
  buildCurrentStudyDeckPopulation,
  canonicalHash,
  computeLeaderSnapshot,
  enumerateChoiceResponses,
  finalizeResults,
  gameDiagnostics,
  runSim,
  runSimQueue,
  summarizeActionLifecycle,
} from '../../sim-runner.mjs';
import { replayGame } from '../../replay-game.mjs';
import { CURRENT_GAME_CONFIG } from '../../src/rules/index.js';

const DECKS = {
  Onyx: 'Onyx',
  Radiant: 'Radiant',
};

function queue(config: Record<string, unknown>) {
  return runSimQueue(config, new SharedArrayBuffer(4)) as readonly {
    readonly fA: string;
    readonly fB: string;
    readonly seed: number;
    readonly matchupId: string;
    readonly scheduleBlockId: number;
    readonly terminalReason: string;
    readonly failure?: unknown;
  }[];
}

describe('current simulation validity contract', () => {
  it('starts through the canonical current constructor and completes mulligans', () => {
    const result = runSim({
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 1,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 1,
    });

    expect(result.infrastructureFailureCount).toBe(0);
    expect(result.terminalReasons).toEqual({ turn_cap_draw: 1 });
    expect(result.timeoutPct).toBe(100);
  });

  it('rejects incoherent semantic overrides of the canonical current profile', () => {
    expect(() =>
      runSim({
        rulesProfile: 'current',
        responseWindowsOnAllActions: false,
        gamesPerPairing: 1,
        matchups: ['Onyx'],
        decks: DECKS,
      }),
    ).toThrow(/responseWindowsOnAllActions is locked/);
  });

  it('covers every allowed current semantic-setting pair with the singleton manifest configuration', () => {
    const result = runSim({
      rulesProfile: 'current',
      gamesPerPairing: 1,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 0,
    });
    const settings = Object.entries(CURRENT_GAME_CONFIG);

    for (const [field, expected] of settings) {
      expect(result.config[field]).toBe(expected);
    }
    for (let left = 0; left < settings.length; left++) {
      for (let right = left + 1; right < settings.length; right++) {
        const [leftField, leftValue] = settings[left]!;
        const [rightField, rightValue] = settings[right]!;
        expect([
          result.config[leftField],
          result.config[rightField],
        ]).toEqual([leftValue, rightValue]);
      }
    }
  });

  it('keys an existing matchup seed stream independently of panel order/expansion', () => {
    const base = {
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 2,
      decks: DECKS,
      turnCap: 0,
      seedBase: 991,
    };
    const onlyOnyx = queue({ ...base, matchups: ['Onyx'] });
    const expanded = queue({ ...base, matchups: ['Radiant', 'Onyx'] });
    const expandedOnyx = expanded.filter(
      (game) => game.fA === 'Onyx' && game.fB === 'Onyx',
    );

    expect(onlyOnyx.map((game) => game.seed)).toEqual(
      expandedOnyx.map((game) => game.seed),
    );
  });

  it('keeps logical matchup cluster identity stable across physical seat swaps', () => {
    const games = queue({
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 4,
      matchups: ['Onyx', 'Radiant'],
      decks: DECKS,
      turnCap: 0,
      seedBase: 228,
      seatAlternation: true,
    }).filter((game) => game.fA === 'Onyx' && game.fB === 'Radiant');

    expect(games).toHaveLength(4);
    expect(new Set(games.map((game) => game.matchupId)).size).toBe(1);
    expect(new Set(games.map((game) => game.scheduleBlockId)).size).toBe(1);
  });

  it('runs the predeclared five-archetype deck population through the current harness', () => {
    const population = buildCurrentStudyDeckPopulation();
    expect(population).toHaveLength(20);
    for (const faction of ['Onyx', 'Radiant', 'Sapphire', 'Verdant']) {
      const decks = population.filter((deck) => deck.faction === faction);
      expect(decks).toHaveLength(5);
      expect(new Set(decks.map((deck) => deck.deckKey)).size).toBe(5);
      expect(new Set(decks.map((deck) => deck.archetype))).toEqual(
        new Set(['Aggro', 'Midrange', 'Control', 'Tempo', 'Ramp']),
      );
    }

    const result = finalizeResults({
      rulesProfile: 'current',
      studyPopulation: true,
      gamesPerPairing: 4,
    }, []);
    expect(result.deckLabels).toHaveLength(210);
    expect(result.config.studyPopulation).toBe(true);
    expect(result.config).toMatchObject({
      botPolicy: 'heuristic',
      firstPlayer: 'alternating',
      seatAlternation: true,
      seedBase: 20260726,
      turnCap: 80,
      termination: 'none',
    });
    expect(result.studyBindings.deckContentHashes).toHaveLength(20);
    for (const binding of [
      result.studyBindings.rulesManifestHash,
      result.studyBindings.studyManifestHash,
      result.studyBindings.cardPoolHash,
      result.studyBindings.engineBuildHash,
      result.studyBindings.harnessBuildHash,
      result.studyBindings.botImplementationHash,
      result.studyBindings.policyConfigHash,
      result.studyBindings.policyCalibrationManifestHash,
    ]) {
      expect(binding).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(result.infrastructureFailureCount).toBe(0);
  });

  it('rejects incomplete or post-hoc changes to the primary study design', () => {
    expect(() =>
      runSim({
        rulesProfile: 'current',
        studyPopulation: true,
        gamesPerPairing: 2,
      }),
    ).toThrow(/positive multiple of 4/);
    expect(() =>
      runSim({
        rulesProfile: 'current',
        studyPopulation: true,
        gamesPerPairing: 4,
        botPolicy: 'random',
      }),
    ).toThrow(/diagnostic override botPolicy/);
    expect(() =>
      runSim({
        rulesProfile: 'current',
        studyPopulation: true,
        gamesPerPairing: 4,
        turnCap: 1,
      }),
    ).toThrow(/diagnostic override turnCap/);
  });

  it('replays a sampled current trace to identical event, state, and trace hashes', () => {
    const config = {
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 1,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 1,
      seedBase: 441,
    };
    const withoutReplay = runSim(config);
    const withReplay = runSim({ ...config, collectReplay: true });
    const record = withReplay.replays?.[0];

    expect(record).toBeDefined();
    expect(withReplay.runHash).toBe(withoutReplay.runHash);
    expect(record?.provenance).toMatchObject({
      artifactStatus: 'diagnostic',
      rulesProfile: 'current',
      studyManifestId: 'aetherion-current-four-faction-v1',
      studyArtifactStatus: 'diagnostic',
      rng: {
        scheduleVersion: 'semantic-key-v1',
        engineAlgorithm: 'xorshift32-v1',
        policyAlgorithm: 'mulberry32-v1',
      },
    });
    expect(record?.provenance.rulesManifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.provenance.studyManifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.provenance.cardPoolHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.provenance.engine.buildHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.provenance.engine.harnessBuildHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(record?.provenance.decks.player0.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(record?.provenance.bot.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.provenance.bot.implementationHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(record?.eventHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.finalStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.traceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(replayGame(record)).toMatchObject({ matches: true });

    const tampered = structuredClone(record);
    tampered.commands = tampered.commands.slice(0, -1);
    expect(replayGame(tampered).matches).toBe(false);

    const provenanceTampered = structuredClone(record);
    provenanceTampered.provenance.rulesManifestHash = '0'.repeat(64);
    expect(replayGame(provenanceTampered).matches).toBe(false);
  });

  it('content-addresses interaction search in rollout policy provenance', () => {
    const config = {
      rulesProfile: 'current',
      botPolicy: 'rollout',
      gamesPerPairing: 1,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 0,
      seedBase: 447,
      rollouts: 1,
      rolloutDepth: 1,
      maxCandidates: 2,
      candidateGen: 'full',
      collectReplay: true,
    };
    const proactiveOnly = runSim(config).replays?.[0];
    const allInteractions = runSim({
      ...config,
      rolloutInteractions: true,
    }).replays?.[0];

    expect(proactiveOnly?.provenance.bot.implementationHash).toBe(
      allInteractions?.provenance.bot.implementationHash,
    );
    expect(proactiveOnly?.provenance.bot.configHash).not.toBe(
      allInteractions?.provenance.bot.configHash,
    );
  });

  it('observes current games through detached immutable snapshots without changing behavior', () => {
    const config = {
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 1,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 2,
      seedBase: 449,
      collectReplay: true,
    };
    const baseline = runSim(config);
    const observed = runSim({
      ...config,
      observation: {
        finalState: true,
        turnStates: true,
        actions: true,
      },
    });
    const row = observed.observations[0];

    expect(observed.runHash).toBe(baseline.runHash);
    expect(observed.replays[0].eventHash).toBe(baseline.replays[0].eventHash);
    expect(observed.replays[0].finalStateHash).toBe(
      baseline.replays[0].finalStateHash,
    );
    expect(observed.replays[0].traceHash).toBe(
      baseline.replays[0].traceHash,
    );
    expect(canonicalHash(row.observation.finalState)).toBe(
      observed.replays[0].finalStateHash,
    );
    expect(Object.isFrozen(observed.observations)).toBe(true);
    expect(Object.isFrozen(row.observation.finalState)).toBe(true);
    expect(row.observation.turnStates.length).toBeGreaterThan(0);
    expect(() =>
      runSim({
        ...config,
        __trace: { onTurn: () => undefined },
      }),
    ).toThrow(/mutable __diag\/__trace hooks are legacy-only/);
  });

  it('invalidates an artifact as soon as a bound semantic hash becomes stale', () => {
    expect(() =>
      runSim({
        rulesProfile: 'current',
        gamesPerPairing: 1,
        matchups: ['Onyx'],
        decks: DECKS,
        artifactExpectations: {
          rulesManifestHash: '0'.repeat(64),
        },
      }),
    ).toThrow(/Stale artifact: expected rulesManifestHash/);
  });

  it('fails closed on an explicit illegal deck instead of substituting an auto deck', () => {
    expect(() =>
      runSim({
        rulesProfile: 'current',
        gamesPerPairing: 1,
        matchups: ['Onyx'],
        decks: {
          Onyx: {
            heroDefId: 133,
            mainDeckDefIds: [1],
            resourceDeckDefIds: [],
            faction: 'Onyx',
          },
        },
      }),
    ).toThrow(/Invalid current-rules deck/);
  });

  it('maintains state invariants throughout a deterministic multi-seed legal trace sample', () => {
    const result = runSim({
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 8,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 8,
      seedBase: 701,
      certification: true,
    });

    expect(result.infrastructureFailureCount).toBe(0);
    expect(result.validGameplayGames).toBe(8);
  });

  it('meets the predeclared legal-action property campaign budget', () => {
    const result = runSim({
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 64,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 12,
      seedBase: 0x50524f50,
      certification: true,
    });
    const lifecycle = result.actionLifecycle.overall;

    expect(result.validGameplayGames).toBe(64);
    expect(result.infrastructureFailureCount).toBe(0);
    expect(lifecycle.attempted).toBeGreaterThanOrEqual(128);
    expect(lifecycle.rejected).toBe(0);
    expect(lifecycle.failed).toBe(0);
    expect(Object.keys(result.actionLifecycle.byKind).length).toBeGreaterThanOrEqual(4);
  });

  it('makes every legal optional cardinality reachable to the uniform policy', () => {
    const responses = enumerateChoiceResponses({
      options: [{ id: 'a' }, { id: 'b' }],
      minSelections: 0,
      maxSelections: 2,
    });
    expect(responses).toEqual([
      [],
      ['a'],
      ['b'],
      ['a', 'b'],
    ]);
  });

  it('separates declared action outcomes and reconciles every attempt', () => {
    const lifecycle = summarizeActionLifecycle(
      [
        { kind: 'cast_spell', outcome: 'pending', stackItemId: 'stack-1', interactionId: null },
        { kind: 'cast_spell', outcome: 'pending', stackItemId: 'stack-2', interactionId: null },
        { kind: 'attack', outcome: 'pending', stackItemId: 'stack-3', interactionId: null },
        { kind: 'move', outcome: 'rejected', stackItemId: null, interactionId: null },
        { kind: 'activate_ability', outcome: 'failed', stackItemId: null, interactionId: null },
      ],
      [
        { type: 'STACK_ITEM_RESOLVED', stackItemId: 'stack-1' },
        { type: 'STACK_ITEM_COUNTERED', stackItemId: 'stack-2' },
        { type: 'STACK_ITEM_FIZZLED', stackItemId: 'stack-3' },
      ],
    );

    expect(lifecycle.overall).toEqual({
      attempted: 5,
      declared: 3,
      resolved: 1,
      countered: 1,
      fizzled: 1,
      rejected: 1,
      failed: 1,
      pending: 0,
    });
    expect(
      lifecycle.overall.resolved +
        lifecycle.overall.countered +
        lifecycle.overall.fizzled +
        lifecycle.overall.rejected +
        lifecycle.overall.failed +
        lifecycle.overall.pending,
    ).toBe(lifecycle.overall.attempted);
  });

  it('reports reconciled lifecycle telemetry for actual current games', () => {
    const result = runSim({
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 2,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 2,
      seedBase: 147,
    });
    const lifecycle = result.actionLifecycle.overall;

    expect(lifecycle.attempted).toBeGreaterThan(0);
    expect(
      lifecycle.resolved +
        lifecycle.countered +
        lifecycle.fizzled +
        lifecycle.rejected +
        lifecycle.failed +
        lifecycle.pending,
    ).toBe(lifecycle.attempted);
    expect(lifecycle.declared).toBe(
      lifecycle.resolved +
        lifecycle.countered +
        lifecycle.fizzled +
        lifecycle.pending,
    );
  });

  it('reports measured transform state and both LP deltas, including real zeros', () => {
    const diagnostics = gameDiagnostics(
      {
        turnNumber: 12,
        players: [
          { hero: { transformed: true, currentLp: 17 } },
          { hero: { transformed: false, currentLp: 22 } },
        ],
        log: [
          { type: 'TURN_START', turnNumber: 9, playerId: 0 },
          {
            type: 'HERO_TRANSFORMED',
            playerId: 0,
            fromCardDefId: 133,
            toCardDefId: 3,
            previousMaxLp: 25,
            newMaxLp: 30,
            maxLpDelta: 5,
            previousCurrentLp: 17,
            newCurrentLp: 17,
            currentLpDelta: 0,
            currentLp: 17,
          },
        ],
      },
      0,
      true,
      false,
    );

    expect(diagnostics.transformed).toEqual([true, false]);
    expect(diagnostics.lpAtFlip).toEqual([17, null]);
    expect(diagnostics.transformLpDelta).toEqual([
      { maxLp: 5, currentLp: 0 },
      null,
    ]);
  });

  it('recomputes the predeclared multicomponent leader from the turn snapshot', () => {
    const player = (
      heroLp: number,
      bodies: readonly Record<string, unknown>[],
      readyResources: number,
    ) => ({
      hero: { currentLp: heroLp, transformed: false },
      zones: {
        reserve: [],
        frontline: bodies,
        highGround: [],
      },
      hand: [],
      mainDeck: [],
      resourceDeck: [],
      resourceBank: Array.from({ length: readyResources }, (_, index) => ({
        instanceId: `resource-${String(index)}`,
        exhausted: false,
      })),
      temporaryResources: [],
    });
    const body = {
      cardType: 'C',
      currentAtk: 8,
      currentHp: 8,
      currentArm: 0,
      exhausted: false,
    };
    const state = {
      players: [
        player(16, [body, body], 3),
        player(22, [], 0),
      ],
    };

    const first = computeLeaderSnapshot(state);
    const second = computeLeaderSnapshot(structuredClone(state));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      modelId: 'multicomponent_leader_v1',
      leader: 0,
    });
    expect(first.components[0]).toMatchObject({
      heroLp: 16,
      boardPower: 32,
      availableResources: 3,
      readyFrontline: 2,
    });
  });

  it.each([
    'step_cap_loop',
    'unresolved_interaction',
    'guard_exhaustion',
    'illegal_or_stale_action',
    'bot_exception',
    'engine_exception',
  ])('classifies an injected %s fault as infrastructure failure', (reason) => {
    const result = runSim({
      rulesProfile: 'current',
      botPolicy: 'heuristic',
      gamesPerPairing: 1,
      matchups: ['Onyx'],
      decks: DECKS,
      turnCap: 1,
      __faultInjection: reason,
    });

    expect(result.validGameplayGames).toBe(0);
    expect(result.infrastructureFailureCount).toBe(1);
    expect(result.terminalReasons).toEqual({ [reason]: 1 });
    expect(result.failures[0]).toMatchObject({
      reason,
      failure: { injected: true },
    });
  });

  it('makes certification reject an injected infrastructure failure', () => {
    expect(() =>
      runSim({
        rulesProfile: 'current',
        botPolicy: 'heuristic',
        gamesPerPairing: 1,
        matchups: ['Onyx'],
        decks: DECKS,
        turnCap: 1,
        certification: true,
        __faultInjection: 'guard_exhaustion',
      }),
    ).toThrow(/Certification failed: 1 infrastructure failure/);
  });
});
