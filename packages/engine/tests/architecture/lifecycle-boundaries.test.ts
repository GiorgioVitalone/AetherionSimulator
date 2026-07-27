import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as actionFacade from '../../src/state-machine/actions.js';
import * as turnBoundary from '../../src/state-machine/turn-boundary.js';

describe('semantic lifecycle module boundaries', () => {
  it('owns turn cleanup, continuation, scheduling, and event dispatch in one module', () => {
    expect(actionFacade.executeTurnBoundary).toBe(
      turnBoundary.executeTurnBoundary,
    );
    expect(actionFacade.resumeTurnBoundary).toBe(
      turnBoundary.resumeTurnBoundary,
    );
    expect(actionFacade.runScheduledEffects).toBe(
      turnBoundary.runScheduledEffects,
    );

    const actionSource = readFileSync(
      new URL('../../src/state-machine/actions.ts', import.meta.url),
      'utf8',
    );
    const machineSource = readFileSync(
      new URL('../../src/state-machine/game-machine.ts', import.meta.url),
      'utf8',
    );
    expect(actionSource).not.toMatch(/function executeTurnBoundary/);
    expect(actionSource).not.toMatch(/function runScheduledEffects/);
    expect(machineSource).toContain("from './turn-boundary.js'");
  });
});
