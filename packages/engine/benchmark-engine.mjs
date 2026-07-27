#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CURRENT_GAME_CONFIG,
  dispatchTriggers,
  recomputeAuras,
} from './dist/index.js';
import { finalizeResults, runSim } from './sim-runner.mjs';

const budgets = JSON.parse(
  readFileSync(new URL('./sim-data/performance-budgets.json', import.meta.url)),
);

function card(instanceId, abilities = [], registeredTriggers = []) {
  return {
    instanceId,
    cardDefId: 1,
    name: instanceId,
    cardType: 'C',
    currentHp: 3,
    currentAtk: 2,
    currentArm: 0,
    baseHp: 3,
    baseAtk: 2,
    baseArm: 0,
    exhausted: false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
    traits: [],
    grantedTraits: [],
    abilities,
    registeredTriggers,
    modifiers: [],
    statusEffects: [],
    equipment: null,
    isToken: false,
    tags: [],
    cost: { mana: 1, energy: 0, flexible: 0 },
    alignment: ['Onyx'],
    owner: 0,
  };
}

function player(zones) {
  return {
    hero: {
      cardDefId: 133,
      name: 'Benchmark Hero',
      currentArm: 0,
      currentLp: 25,
      maxLp: 25,
      transformed: false,
      canTransformThisGame: true,
      transformedThisTurn: false,
      abilities: [],
      registeredTriggers: [],
    },
    zones,
    hand: [],
    mainDeck: [],
    resourceDeck: [],
    resourceBank: [],
    discardPile: [],
    exile: [],
    temporaryResources: [],
    turnCounters: {
      spellsCast: 0,
      equipmentPlayed: 0,
      charactersDeployed: 0,
      abilitiesActivated: 0,
    },
  };
}

function benchmarkState() {
  const aura = {
    type: 'aura',
    effects: [
      {
        type: 'modify_stats',
        target: { type: 'all_characters', side: 'allied' },
        modifier: { atk: 1 },
        duration: { type: 'while_in_play' },
      },
    ],
  };
  const trigger = {
    id: 'benchmark-trigger',
    sourceInstanceId: 'trigger-source',
    ownerPlayerId: 0,
    trigger: { type: 'on_turn_start' },
    effects: [],
    abilityIndex: 0,
  };
  return {
    players: [
      player({
        reserve: [card('aura-source', [aura]), null, null],
        frontline: [card('trigger-source', [], [trigger]), null, null],
        highGround: [null, null],
      }),
      player({
        reserve: [null, null, null],
        frontline: [null, null, null],
        highGround: [null, null],
      }),
    ],
    activePlayerIndex: 0,
    turnNumber: 1,
    phase: 'action',
    stack: [],
    pendingChoice: null,
    log: [],
    winner: null,
    rng: { seed: 1, counter: 0 },
    eventSequence: 0,
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
    config: CURRENT_GAME_CONFIG,
  };
}

function rate(iterations, operation) {
  const started = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  const milliseconds = performance.now() - started;
  return (1000 * iterations) / Math.max(milliseconds, 0.001);
}

export function runBenchmarks() {
  const state = benchmarkState();
  const stabilized = recomputeAuras(state);
  const auraRecomputesPerSecond = rate(250, () => recomputeAuras(stabilized));
  const triggerDispatchesPerSecond = rate(250, () =>
    dispatchTriggers(stabilized, [
      { type: 'TURN_START', playerId: 0, turnNumber: 1 },
    ]),
  );

  const simConfig = {
    rulesProfile: 'current',
    botPolicy: 'heuristic',
    gamesPerPairing: 4,
    matchups: ['Onyx'],
    decks: { Onyx: 'Onyx' },
    turnCap: 4,
    seedBase: 0x50455246,
    collectReplay: true,
  };
  const simStarted = performance.now();
  const baseline = runSim(simConfig);
  const simulationMillisecondsPerGame =
    (performance.now() - simStarted) / baseline.games;
  const observed = runSim({
    ...simConfig,
    observation: { finalState: true, actions: true },
  });
  const observedTraceBytesPerGame =
    Buffer.byteLength(JSON.stringify(observed.observations)) / observed.games;

  const planStarted = performance.now();
  const study = finalizeResults(
    {
      rulesProfile: 'current',
      studyPopulation: true,
      gamesPerPairing: 4,
    },
    [],
  );
  const studyPlanBuildMilliseconds = performance.now() - planStarted;
  const baselineReplayHashes = baseline.replays.map((record) => [
    record.eventHash,
    record.finalStateHash,
    record.traceHash,
  ]);
  const observedReplayHashes = observed.replays.map((record) => [
    record.eventHash,
    record.finalStateHash,
    record.traceHash,
  ]);

  return {
    profile: budgets.profile,
    measurements: {
      auraRecomputesPerSecond,
      triggerDispatchesPerSecond,
      simulationMillisecondsPerGame,
      observedTraceBytesPerGame,
      studyPlanBuildMilliseconds,
    },
    semanticGates: {
      observerRunHashEquivalent: observed.runHash === baseline.runHash,
      observerReplayHashesEquivalent:
        JSON.stringify(observedReplayHashes) ===
        JSON.stringify(baselineReplayHashes),
      studyPairingCount: study.deckLabels.length,
    },
  };
}

export function verifyBenchmarks(report) {
  const errors = [];
  for (const [metric, budget] of Object.entries(budgets.budgets)) {
    const value = report.measurements[metric.replace(/(?:Min|Max)$/u, '')];
    if (metric.endsWith('Min') && value < budget) {
      errors.push(`${metric}: ${String(value)} < ${String(budget)}`);
    }
    if (metric.endsWith('Max') && value > budget) {
      errors.push(`${metric}: ${String(value)} > ${String(budget)}`);
    }
  }
  for (const [gate, expected] of Object.entries(budgets.semanticGates)) {
    if (report.semanticGates[gate] !== expected) {
      errors.push(
        `${gate}: ${String(report.semanticGates[gate])} !== ${String(expected)}`,
      );
    }
  }
  return errors;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const report = runBenchmarks();
  const errors = verifyBenchmarks(report);
  console.log(JSON.stringify({ ...report, errors }));
  if (process.argv.includes('--verify') && errors.length > 0) process.exitCode = 1;
}
