import { spawnSync } from 'node:child_process';

const commands = [
  'pnpm --filter @aetherion-sim/engine build',
  'pnpm --filter @aetherion-sim/engine test',
  'pnpm --filter @aetherion-sim/client build',
  'pnpm --filter @aetherion-sim/client test',
  'pnpm --filter @aetherion-sim/client e2e',
];

for (const command of commands) {
  run(command);
}

console.log('\nRelease gate passed. Update qa/release-scorecard.md with evidence before sign-off.');

function run(command) {
  console.log(`\n> ${command}`);
  const result = spawnSync(command, [], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
