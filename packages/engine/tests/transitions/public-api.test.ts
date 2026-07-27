import { describe, expect, it } from 'vitest';
import * as engine from '../../src/index.js';

describe('authoritative public transition surface', () => {
  it('offers the typed transition boundary without low-level mutation entry points', () => {
    const publicApi = engine as Record<string, unknown>;

    expect(publicApi.transition).toBeTypeOf('function');
    expect(publicApi.createCurrentGame).toBeTypeOf('function');
    expect(publicApi.executePlayerAction).toBeUndefined();
    expect(publicApi.executeReactiveResponse).toBeUndefined();
    expect(publicApi.executeEffect).toBeUndefined();
    expect(publicApi.runAbilityEffects).toBeUndefined();
  });
});
