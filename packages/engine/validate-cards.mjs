// validate-cards.mjs — CLI runner for the card-data validator
// (src/sim/card-data-validator.ts). Report mode by default: prints a grouped
// findings report and exits nonzero on any semantic error. Certification is
// fail-closed; --report-only is reserved for local diagnosis.
//
// Usage:
//   node validate-cards.mjs [path] [--report-only] [--previous <path>]
//     path              card-data JSON to validate (default sim-data/aetherion-cards.json)
//     --report-only     print errors without a nonzero exit
//     --previous <path> previous export to diff ability counts against (rule 9)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateCardData } from './dist/sim/card-data-validator.js';

function parseArgs(argv) {
  const args = { path: null, strict: true, previous: null, exceptions: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') args.strict = true;
    else if (arg === '--report-only') args.strict = false;
    else if (arg === '--previous') args.previous = argv[++i];
    else if (arg === '--exceptions') args.exceptions = argv[++i];
    else if (!args.path) args.path = arg;
  }
  return args;
}

function loadCards(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printReport(findings, path) {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  console.log(`Card-data validation — ${path}`);
  console.log(`  ${String(errors.length)} error(s), ${String(warnings.length)} warning(s)\n`);

  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  for (const [rule, group] of [...byRule.entries()].sort()) {
    const severity = group[0].severity.toUpperCase();
    console.log(`[${severity}] ${rule} (${String(group.length)})`);
    for (const f of group) {
      const loc = f.abilityIndex != null ? ` ability ${String(f.abilityIndex)}` : '';
      console.log(`  card ${String(f.cardId)} ${f.cardName}${loc} — ${f.message}`);
    }
    console.log('');
  }
  return errors.length;
}

export function runCli(argv) {
  const args = parseArgs(argv);
  const path = args.path ?? new URL('./sim-data/aetherion-cards.json', import.meta.url);
  const cards = loadCards(path);
  const previousCards = args.previous ? loadCards(args.previous) : undefined;
  const exceptionPath =
    args.exceptions ??
    new URL('./sim-data/card-semantic-exceptions.json', import.meta.url);
  const exceptions = loadCards(exceptionPath);
  const findings = validateCardData(cards, { previousCards, exceptions });
  const errorCount = printReport(findings, path);
  if (args.strict && errorCount > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2));
}
