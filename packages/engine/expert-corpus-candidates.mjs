#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalHash,
  computeBotImplementationHash,
  computeEngineBuildHash,
  computeHarnessBuildHash,
  runSim,
} from './sim-runner.mjs';

const engineDir = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = resolve(engineDir, '../..');
const template = JSON.parse(
  readFileSync(
    new URL('./sim-data/expert-policy-corpus-template.json', import.meta.url),
    'utf8',
  ),
);
const rules = JSON.parse(
  readFileSync(new URL('./sim-data/ruleset-current.json', import.meta.url), 'utf8'),
);
const cardDefinitions = new Map(
  JSON.parse(
    readFileSync(
      new URL('./sim-data/aetherion-cards.json', import.meta.url),
      'utf8',
    ),
  ).map((card) => [card.id, card]),
);
const rulesSemanticHash = canonicalHash({ ...rules, status: undefined });

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function actionFamily(row) {
  if (row.family === 'reaction' || row.family === 'choice') return row.family;
  const kinds = new Set(
    row.candidates
      .map(({ action }) => action?.type)
      .filter((kind) => typeof kind === 'string'),
  );
  if (kinds.has('declare_transform')) return 'transform';
  if (kinds.has('declare_attack')) return 'combat';
  if (
    kinds.has('attach_equipment') ||
    kinds.has('remove_equipment') ||
    kinds.has('transfer_equipment')
  ) return 'equipment';
  if (kinds.has('activate_ability')) return 'ability';
  if (kinds.has('move')) return 'movement';
  if (kinds.has('tap_reserve') || kinds.has('discard_for_energy')) {
    return 'resource';
  }
  return 'development';
}

function runPanel(overrides) {
  return runSim({
    rulesProfile: 'current',
    botPolicy: 'rollout',
    matchups: {
      factions: ['Onyx', 'Radiant'],
      includeMirrors: false,
    },
    decks: { Onyx: 'Onyx', Radiant: 'Radiant' },
    gamesPerPairing: 8,
    turnCap: 40,
    seedBase: 0x45585054,
    rollouts: 1,
    rolloutDepth: 1,
    maxCandidates: 8,
    candidateGen: 'full',
    playoutBackend: 'snapshot',
    rolloutPlayout: 'heuristic',
    collectDecisionLog: true,
    collectDecisionStates: true,
    rolloutInteractions: true,
    ...overrides,
  });
}

function allCards(player) {
  return [
    ...player.zones.reserve,
    ...player.zones.frontline,
    ...player.zones.highGround,
  ].filter((card) => card !== null);
}

function isImmediateLethal(row) {
  const state = row.state;
  if (state === undefined) return false;
  const opponent = state.players[row.mover === 0 ? 1 : 0];
  const player = state.players[row.mover];
  return row.candidates.some(({ action }) => {
    if (
      action?.type !== 'declare_attack' ||
      action.targetId !== 'hero'
    ) return false;
    const attacker = allCards(player).find(
      ({ instanceId }) => instanceId === action.attackerInstanceId,
    );
    return (
      attacker !== undefined &&
      Math.max(0, attacker.currentAtk - opponent.hero.currentArm) >=
        opponent.hero.currentLp
    );
  });
}

function defensivePressure(row) {
  const state = row.state;
  if (state === undefined) return -Infinity;
  const player = state.players[row.mover];
  const opponent = state.players[row.mover === 0 ? 1 : 0];
  const enemyAttack = allCards(opponent).reduce(
    (total, card) => total + Math.max(0, card.currentAtk),
    0,
  );
  return enemyAttack - player.hero.currentLp;
}

function pickDistinct(rows, predicate, used) {
  const row = rows.find(
    (candidate) =>
      !used.has(candidate) &&
      candidate.candidates.length >= 2 &&
      candidate.state !== undefined &&
      predicate(candidate),
  );
  if (row !== undefined) used.add(row);
  return row;
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
}

function cardView(card) {
  if (card == null) return null;
  const definition = cardDefinitions.get(card.cardDefId);
  return {
    instanceId: card.instanceId,
    cardDefId: card.cardDefId,
    name: card.name,
    cardType: card.cardType,
    cost: card.cost,
    stats: {
      atk: card.currentAtk,
      hp: card.currentHp,
      arm: card.currentArm,
    },
    exhausted: card.exhausted,
    summoningSick: card.summoningSick,
    movedThisTurn: card.movedThisTurn,
    attackedThisTurn: card.attackedThisTurn,
    traits: card.traits,
    grantedTraits: card.grantedTraits,
    tags: card.tags,
    statusEffects: card.statusEffects,
    abilities: card.abilities,
    printedEffects:
      definition?.abilities
        ?.map(({ effect }) => effect)
        .filter((effect) => typeof effect === 'string' && effect.length > 0) ??
      [],
    equipment: card.equipment == null ? null : cardView(card.equipment),
    xPaid: card.xPaid,
  };
}

function playerView(player) {
  return {
    hero: player.hero,
    zones: {
      reserve: player.zones.reserve.map(cardView),
      frontline: player.zones.frontline.map(cardView),
      highGround: player.zones.highGround.map(cardView),
    },
    hand: player.hand.map(cardView),
    mainDeck: {
      count: player.mainDeck.length,
      contentHash: canonicalHash(
        player.mainDeck.map(({ instanceId, cardDefId }) => ({
          instanceId,
          cardDefId,
        })),
      ),
    },
    resourceDeck: player.resourceDeck,
    resourceBank: player.resourceBank,
    discardPile: player.discardPile.map(cardView),
    exile: player.exile.map(cardView),
    temporaryResources: player.temporaryResources,
    costReductions: player.costReductions,
    turnCounters: player.turnCounters,
  };
}

function tacticalStateView(state) {
  let turnStart = 0;
  for (let index = state.log.length - 1; index >= 0; index--) {
    if (state.log[index]?.type === 'TURN_START') {
      turnStart = index;
      break;
    }
  }
  return {
    activePlayerIndex: state.activePlayerIndex,
    turnNumber: state.turnNumber,
    phase: state.phase,
    winner: state.winner,
    players: state.players.map(playerView),
    stack: state.stack,
    pendingChoice: state.pendingChoice,
    pendingPriority: state.pendingPriority,
    turnState: state.turnState,
    scheduledEffects: state.scheduledEffects,
    currentTurnLog: state.log.slice(turnStart),
  };
}

function markdownCell(value) {
  return String(value ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

function stateCards(stateView) {
  return stateView.players.flatMap((player) => [
    ...Object.values(player.zones).flat().filter((card) => card !== null),
    ...player.hand,
    ...player.discardPile,
    ...player.exile,
  ]);
}

function namedCard(stateView, instanceId) {
  const card = stateCards(stateView).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  return card === undefined
    ? String(instanceId)
    : `${card.name} (${card.instanceId})`;
}

function actionDescription(action, stateView) {
  if (action === null) {
    return stateView.pendingPriority == null
      ? 'Pass / advance the phase'
      : 'Pass priority';
  }
  switch (action.type) {
    case 'declare_attack':
      return `Attack with ${namedCard(stateView, action.attackerInstanceId)} → ${
        action.targetId === 'hero'
          ? 'enemy Hero'
          : namedCard(stateView, action.targetId)
      }`;
    case 'deploy':
      return `Deploy ${namedCard(stateView, action.cardInstanceId)} → ${action.zone} slot ${String(action.slotIndex)}${
        action.xValue === undefined ? '' : ` (X=${String(action.xValue)})`
      }`;
    case 'cast_spell':
      return `Cast ${namedCard(stateView, action.cardInstanceId)}${
        action.xValue === undefined ? '' : ` (X=${String(action.xValue)})`
      }`;
    case 'attach_equipment':
      return `Attach ${namedCard(stateView, action.cardInstanceId)} → ${namedCard(stateView, action.targetInstanceId)}`;
    case 'remove_equipment':
      return `Remove ${namedCard(stateView, action.equipmentInstanceId)}`;
    case 'transfer_equipment':
      return `Transfer ${namedCard(stateView, action.equipmentInstanceId)} → ${namedCard(stateView, action.targetInstanceId)}`;
    case 'move':
      return `Move ${namedCard(stateView, action.cardInstanceId)} → ${action.toZone}`;
    case 'activate_ability':
      return `Activate ability ${String(action.abilityIndex)} on ${namedCard(stateView, action.cardInstanceId)}${
        action.xValue === undefined ? '' : ` (X=${String(action.xValue)})`
      }`;
    case 'discard_for_energy':
      return `Discard ${namedCard(stateView, action.cardInstanceId)} for Energy`;
    case 'tap_reserve':
      return `Tap/strain ${namedCard(stateView, action.cardInstanceId)} for Reserve Energy`;
    case 'declare_transform':
      return 'Transform the active Hero';
    case 'choice_response': {
      const labels = new Map(
        (stateView.pendingChoice?.options ?? []).map(({ id, label }) => [
          id,
          label,
        ]),
      );
      return `Choose: ${action.selectedOptionIds
        .map((id) => labels.get(id) ?? id)
        .join(' → ')}`;
    }
    case 'mulligan_decision':
      return action.keep ? 'Keep the opening hand' : 'Take a mulligan';
    default:
      return JSON.stringify(action);
  }
}

function cardSummary(card) {
  if (card === null) return 'empty';
  const flags = [
    card.exhausted ? 'exhausted' : 'ready',
    card.summoningSick ? 'summoning-sick' : null,
    card.traits.length > 0 ? card.traits.join(', ') : null,
    card.equipment === null ? null : `equipped: ${card.equipment.name}`,
  ].filter((value) => value !== null);
  return `${card.name} (${card.instanceId}) ${String(card.stats.atk)}/${String(
    card.stats.hp,
  )}/${String(card.stats.arm)} [${flags.join('; ')}]${
    card.printedEffects.length === 0
      ? ''
      : ` — ${card.printedEffects.join(' / ')}`
  }`;
}

function heroRules(hero) {
  const definition = cardDefinitions.get(hero.cardDefId);
  const effects =
    definition?.abilities
      ?.map(({ effect }) => effect)
      .filter((effect) => typeof effect === 'string' && effect.length > 0) ??
    [];
  return effects.length === 0 ? 'none printed' : effects.join(' / ');
}

function resourceSummary(player) {
  const ready = player.resourceBank.filter(({ exhausted }) => !exhausted);
  const mana = ready.filter(({ resourceType }) => resourceType === 'mana').length;
  const energy = ready.filter(
    ({ resourceType }) => resourceType === 'energy',
  ).length;
  const temporary = player.temporaryResources
    .map(({ resourceType, amount }) => `${String(amount)} ${resourceType}`)
    .join(', ');
  return `${String(mana)} ready Mana, ${String(energy)} ready Energy${
    temporary.length === 0 ? '' : `; temporary: ${temporary}`
  }`;
}

function renderReviewSheet(artifacts) {
  const lines = [
    '# Independent expert policy review',
    '',
    'Review each position without consulting the rollout value or heuristic choice. The JSON artifacts contain the complete tactical view and legal action objects. Record the full selected action key, a finite value score, and a rationale of at least 20 characters in `expert-policy-corpus-review.json`; then complete the expert identity, qualification, timestamp, and final rules/engine hashes before changing its status to `independently_approved`.',
    '',
    `- Generator source commit: \`${gitHead()}\``,
    `- Rules semantic hash: \`${rulesSemanticHash}\``,
    `- Engine build hash: \`${computeEngineBuildHash()}\``,
    `- Harness build hash: \`${computeHarnessBuildHash()}\``,
    `- Bot implementation hash: \`${computeBotImplementationHash()}\``,
    '',
  ];
  for (const artifact of artifacts) {
    const state = artifact.stateView;
    lines.push(
      `## ${artifact.scenarioId}`,
      '',
      artifact.prompt,
      '',
      `Turn ${String(state.turnNumber)}, phase \`${state.phase}\`, decision-maker seat ${String(
        artifact.provenance.mover,
      )} (${artifact.provenance.faction}). State hash: \`${artifact.stateHash}\`.`,
      '',
    );
    state.players.forEach((player, playerId) => {
      lines.push(
        `### Seat ${String(playerId)}${playerId === artifact.provenance.mover ? ' — decision maker' : ''}`,
        '',
        `Hero: ${player.hero.name}, LP ${String(player.hero.currentLp)}/${String(
          player.hero.maxLp,
        )}, ARM ${String(player.hero.currentArm)}, ${
          player.hero.transformed ? 'transformed' : 'base form'
        }.`,
        '',
        `Hero abilities: ${heroRules(player.hero)}.`,
        '',
        `Resources: ${resourceSummary(player)}. Hand: ${
          player.hand.length === 0
            ? 'empty'
            : player.hand.map(cardSummary).join(' | ')
        }. Main deck: ${String(player.mainDeck.count)} cards.`,
        '',
        `- Reserve: ${player.zones.reserve.map(cardSummary).join(' | ')}`,
        `- Frontline: ${player.zones.frontline.map(cardSummary).join(' | ')}`,
        `- High Ground: ${player.zones.highGround.map(cardSummary).join(' | ')}`,
        '',
      );
    });
    if (state.pendingPriority !== undefined && state.pendingPriority !== null) {
      lines.push(
        `Priority window: \`${state.pendingPriority.window}\`; stack types: ${
          state.stack.map(({ type }) => type).join(' → ') || 'empty'
        }.`,
        '',
      );
    }
    if (state.pendingChoice !== null) {
      lines.push(
        `Pending interaction: \`${state.pendingChoice.type}\` (${String(
          state.pendingChoice.minSelections,
        )}–${String(state.pendingChoice.maxSelections)} selections).`,
        '',
      );
    }
    lines.push(
      '| Action key | Legal action |',
      '|---|---|',
      ...artifact.legalActions.map(
        ({ key, action }) =>
          `| \`${key}\` | ${markdownCell(actionDescription(action, state))} |`,
      ),
      '',
      '- Expert action key:',
      '- Expert value:',
      '- Rationale:',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

const outputOption = optionValue('--output-dir');
if (outputOption === null) {
  console.error(
    'Usage: node expert-corpus-candidates.mjs --output-dir /outside/repo/review-packet',
  );
  process.exit(2);
}
const outputDirectory = resolve(process.cwd(), outputOption);
if (
  outputDirectory === repositoryRoot ||
  outputDirectory.startsWith(`${repositoryRoot}/`)
) {
  console.error('Expert review packets must be written outside the checkout.');
  process.exit(2);
}

const panels = [
  runPanel({}),
  runPanel({
    matchups: {
      factions: ['Sapphire', 'Onyx'],
      includeMirrors: false,
    },
    decks: { Sapphire: 'Sapphire', Onyx: 'Onyx' },
    gamesPerPairing: 12,
    turnCap: 40,
    seedBase: 0x504f4c00,
  }),
  runPanel({
    gamesPerPairing: 2,
    turnCap: 5,
    heroLpOverride: { faction: 'Onyx', lp: 10 },
  }),
];
const rows = panels.flatMap(({ decisionLog }) => decisionLog);
const used = new Set();
const lethal = pickDistinct(rows, isImmediateLethal, used);
const defenseCandidates = [...rows].sort(
  (a, b) => defensivePressure(b) - defensivePressure(a),
);
const defense = pickDistinct(
  defenseCandidates,
  (row) =>
    row.family === undefined &&
    ['strategy', 'action'].includes(row.state?.phase),
  used,
);
const selected = new Map([
  ['expert-lethal-001', lethal],
  ['expert-defense-001', defense],
]);
for (const scenario of template.scenarios) {
  if (selected.has(scenario.id)) continue;
  selected.set(
    scenario.id,
    pickDistinct(
      rows,
      (row) =>
        actionFamily(row) === scenario.family &&
        (scenario.family !== 'choice' ||
          !['mulligan', 'choose_first_player', 'hand_limit'].includes(
            row.interactionType,
          )),
      used,
    ),
  );
}
const missing = [...selected.entries()]
  .filter(([, row]) => row === undefined)
  .map(([id]) => id);
if (missing.length > 0) {
  console.error(`Could not source scenarios: ${missing.join(', ')}`);
  process.exit(1);
}

mkdirSync(outputDirectory, { recursive: true });
const finalScenarioDirectory =
  'packages/engine/sim-data/expert-policy-scenarios';
const reviewArtifacts = [];
const scenarios = template.scenarios.map((scenario) => {
  const row = selected.get(scenario.id);
  const legalActions = row.candidates.map(({ action }) => ({
    key: canonicalHash(action),
    action,
  }));
  const artifact = {
    schemaVersion: 1,
    scenarioId: scenario.id,
    family: scenario.family,
    prompt: scenario.prompt,
    provenance: {
      generatorSourceCommit: gitHead(),
      rulesSemanticHash,
      engineBuildHash: computeEngineBuildHash(),
      harnessBuildHash: computeHarnessBuildHash(),
      botImplementationHash: computeBotImplementationHash(),
      runHash: panels.find(({ decisionLog }) =>
        decisionLog.includes(row),
      )?.runHash,
      game: row.game,
      decision: row.decision,
      seed: row.seed,
      turn: row.turn,
      mover: row.mover,
      faction: row.faction,
    },
    stateHash: canonicalHash(row.state),
    stateView: tacticalStateView(row.state),
    legalActions,
  };
  const fileName = `${scenario.id}.json`;
  reviewArtifacts.push(artifact);
  writeFileSync(
    resolve(outputDirectory, fileName),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  return {
    ...scenario,
    stateArtifact: `${finalScenarioDirectory}/${fileName}`,
    legalActionKeys: legalActions.map(({ key }) => key),
  };
});
const reviewCorpus = {
  ...template,
  scenarios,
};
writeFileSync(
  resolve(outputDirectory, 'expert-policy-corpus-review.json'),
  `${JSON.stringify(reviewCorpus, null, 2)}\n`,
);
writeFileSync(
  resolve(outputDirectory, 'REVIEW.md'),
  renderReviewSheet(reviewArtifacts),
);
console.log(
  JSON.stringify(
    {
      outputDirectory,
      generatorSourceCommit: gitHead(),
      scenarios: scenarios.map(({ id, family, legalActionKeys }) => ({
        id,
        family,
        legalActions: legalActionKeys.length,
      })),
    },
    null,
    2,
  ),
);
