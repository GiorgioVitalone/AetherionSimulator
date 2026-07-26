#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCurrentStudyDeckPopulation,
  canonicalHash,
  runSim,
} from './sim-runner.mjs';

const full = process.argv.includes('--full');
const smoke = process.argv.includes('--smoke');
if (full === smoke) {
  throw new Error('Select exactly one of --smoke or --full');
}

const gamesPerPairing = full ? 48 : 4;
const requiredGames = full ? 10_000 : 800;
const requiredActionAttempts = full ? 10_000 : 1_000;
const requiredFreshProcessReplays = full ? 100 : 10;

const panel = runSim({
  rulesProfile: 'current',
  studyPopulation: true,
  gamesPerPairing,
  // Inspect and report failures below so a campaign failure stays compact and
  // machine-readable instead of throwing the runner's full per-game payload.
  certification: false,
});
if (panel.games < requiredGames) {
  throw new Error(
    `Certification panel produced ${String(panel.games)} games; required ${String(requiredGames)}`,
  );
}
if (panel.infrastructureFailureCount !== 0) {
  throw new Error(
    `Certification panel recorded infrastructure failures: ${JSON.stringify(panel.terminalReasons)}`,
  );
}
if (panel.actionLifecycle.overall.attempted < requiredActionAttempts) {
  throw new Error(
    `Certification panel observed ${String(panel.actionLifecycle.overall.attempted)} action attempts; required ${String(requiredActionAttempts)}`,
  );
}
if (
  panel.actionLifecycle.overall.rejected !== 0 ||
  panel.actionLifecycle.overall.failed !== 0 ||
  panel.actionLifecycle.overall.pending !== 0
) {
  throw new Error(
    `Certification panel has unresolved lifecycle outcomes: ${JSON.stringify({
      overall: panel.actionLifecycle.overall,
      unresolved: panel.actionLifecycle.unresolved,
    })}`,
  );
}

const population = buildCurrentStudyDeckPopulation();
const replayMatchups = [];
for (let left = 0; left < population.length; left++) {
  for (let right = left; right < population.length; right++) {
    replayMatchups.push({
      p0Deck: population[left],
      p1Deck: population[right],
    });
    if (replayMatchups.length === requiredFreshProcessReplays) break;
  }
  if (replayMatchups.length === requiredFreshProcessReplays) break;
}
if (replayMatchups.length !== requiredFreshProcessReplays) {
  throw new Error('Study population cannot supply the required replay sample');
}

const replayBatch = runSim({
  rulesProfile: 'current',
  matchups: replayMatchups,
  gamesPerPairing: 1,
  collectReplay: true,
  certification: false,
  seedBase: 0x5245504c,
});
if (
  replayBatch.infrastructureFailureCount !== 0 ||
  replayBatch.replays.length !== requiredFreshProcessReplays
) {
  throw new Error(
    `Replay sample is incomplete: ${String(replayBatch.replays.length)} traces, ${String(replayBatch.infrastructureFailureCount)} infrastructure failures`,
  );
}

const engineDir = fileURLToPath(new URL('.', import.meta.url));
const replayCli = fileURLToPath(new URL('./replay-game.mjs', import.meta.url));
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), 'aetherion-certification-replays-'),
);
const replayTraceHashes = [];
try {
  for (const [index, replay] of replayBatch.replays.entries()) {
    const replayPath = join(
      temporaryDirectory,
      `replay-${String(index).padStart(3, '0')}.json`,
    );
    writeFileSync(replayPath, JSON.stringify(replay));
    const child = spawnSync(process.execPath, [replayCli, replayPath], {
      cwd: engineDir,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (child.status !== 0) {
      throw new Error(
        `Fresh-process replay ${String(index)} failed: ${child.stderr || child.stdout}`,
      );
    }
    const result = JSON.parse(child.stdout);
    if (result.matches !== true) {
      throw new Error(
        `Fresh-process replay ${String(index)} did not match: ${child.stdout}`,
      );
    }
    replayTraceHashes.push(replay.traceHash);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const report = {
  schemaVersion: 1,
  campaign: full ? 'full' : 'smoke',
  artifactStatus: panel.config.artifactStatus,
  studyArtifactStatus: panel.config.studyArtifactStatus,
  panel: {
    games: panel.games,
    validGameplayGames: panel.validGameplayGames,
    infrastructureFailures: panel.infrastructureFailureCount,
    actionLifecycle: panel.actionLifecycle.overall,
    actionKinds: Object.keys(panel.actionLifecycle.byKind).sort(),
    runHash: panel.runHash,
  },
  replay: {
    freshProcesses: requiredFreshProcessReplays,
    uniqueTraceHashes: new Set(replayTraceHashes).size,
    sampleHash: canonicalHash(replayTraceHashes),
  },
};

console.log(JSON.stringify(report, null, 2));
