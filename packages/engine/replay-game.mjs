// replay-game.mjs — deterministic command/event replay verification.
//
// Usage:
//   node replay-game.mjs replay.json
//
// The record is self-contained at the engine boundary: it carries the exact
// initial GameState, every submitted machine command, semantic provenance, and
// the expected event/final-state/full-trace hashes.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createActor } from 'xstate';
import { gameMachine } from './dist/index.js';
import { canonicalHash } from './sim-runner.mjs';

export function replayGame(record) {
  if (
    record === null ||
    typeof record !== 'object' ||
    record.schemaVersion !== 1 ||
    record.initialState === undefined ||
    !Array.isArray(record.commands)
  ) {
    const error = new Error('Replay record is malformed or uses an unsupported schema');
    error.code = 'invalid_replay';
    throw error;
  }

  const initialStateHash = canonicalHash(record.initialState);
  if (initialStateHash !== record.initialStateHash) {
    const error = new Error('Replay initial-state hash does not match its payload');
    error.code = 'replay_initial_state_mismatch';
    throw error;
  }

  const actor = createActor(gameMachine, {
    input: { gameState: record.initialState },
  });
  actor.start();
  for (const command of record.commands) actor.send(command);

  const snapshot = actor.getSnapshot();
  if (snapshot.status === 'error') {
    const error = new Error(
      `Replay engine failed: ${String(snapshot.error ?? 'unknown actor error')}`,
    );
    error.code = 'replay_engine_exception';
    throw error;
  }
  const finalState = snapshot.context.gameState;
  const eventHash = canonicalHash(finalState.log);
  const finalStateHash = canonicalHash(finalState);
  const traceCore = {
    schemaVersion: record.schemaVersion,
    provenance: record.provenance,
    initialStateHash,
    commands: record.commands,
    eventHash,
    finalStateHash,
    terminalReason: record.terminalReason,
  };
  const traceHash = canonicalHash(traceCore);
  return {
    matches:
      eventHash === record.eventHash &&
      finalStateHash === record.finalStateHash &&
      traceHash === record.traceHash,
    eventHash,
    finalStateHash,
    traceHash,
    expected: {
      eventHash: record.eventHash,
      finalStateHash: record.finalStateHash,
      traceHash: record.traceHash,
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node replay-game.mjs replay.json');
    process.exitCode = 2;
  } else {
    try {
      const result = replayGame(JSON.parse(readFileSync(path, 'utf8')));
      console.log(JSON.stringify(result, null, 2));
      if (!result.matches) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
