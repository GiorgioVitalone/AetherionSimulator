import { describe, it } from 'vitest';

const probe = process.env.AETHERION_UNHANDLED_PROBE === '1' ? describe : describe.skip;

probe('intentional unhandled rejection fixture', () => {
  it('injects an unhandled rejection for the meta-gate', async () => {
    void Promise.reject(new Error('intentional-unhandled-rejection-probe'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});
