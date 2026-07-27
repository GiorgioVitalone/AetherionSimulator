export const REQUIRED_GATE_INVOCATIONS = Object.freeze({
  root_build: Object.freeze({
    command: 'pnpm build',
    args: Object.freeze(['build']),
  }),
  root_lint: Object.freeze({
    command: 'pnpm lint',
    args: Object.freeze(['lint']),
  }),
  engine_all_tests: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine test',
    args: Object.freeze(['--filter', '@aetherion-sim/engine', 'test']),
  }),
  engine_current_coverage: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine test:coverage',
    args: Object.freeze([
      '--filter',
      '@aetherion-sim/engine',
      'test:coverage',
    ]),
  }),
  engine_changed_coverage: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine coverage:changed',
    args: Object.freeze([
      '--filter',
      '@aetherion-sim/engine',
      'coverage:changed',
    ]),
  }),
  card_semantic_validator: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine validate',
    args: Object.freeze(['--filter', '@aetherion-sim/engine', 'validate']),
  }),
  finding_audit: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine audit:findings:closed',
    args: Object.freeze([
      '--filter',
      '@aetherion-sim/engine',
      'audit:findings:closed',
    ]),
  }),
  performance_budgets: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine benchmark:verify',
    args: Object.freeze([
      '--filter',
      '@aetherion-sim/engine',
      'benchmark:verify',
    ]),
  }),
  policy_calibration: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine calibrate:policy',
    args: Object.freeze([
      '--filter',
      '@aetherion-sim/engine',
      'calibrate:policy',
    ]),
  }),
  certification_campaigns: Object.freeze({
    command: 'pnpm --filter @aetherion-sim/engine certify:campaigns:full',
    args: Object.freeze([
      '--filter',
      '@aetherion-sim/engine',
      'certify:campaigns:full',
    ]),
  }),
});

export const REQUIRED_GATE_COMMANDS = Object.freeze(
  Object.fromEntries(
    Object.entries(REQUIRED_GATE_INVOCATIONS).map(([id, invocation]) => [
      id,
      invocation.command,
    ]),
  ),
);
