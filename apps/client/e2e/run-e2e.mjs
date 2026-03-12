import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(currentDir, '..');
const repoRoot = resolve(currentDir, '..', '..', '..');

function run(command, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`Command failed with exit code ${String(code)}: ${command}`));
    });

    child.on('error', rejectRun);
  });
}

async function main() {
  await run('docker compose -f docker-compose.yml up -d --build simulator', repoRoot);

  try {
    await run('pnpm exec playwright test', clientDir);
  } finally {
    await run('docker compose -f docker-compose.yml down', repoRoot);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
