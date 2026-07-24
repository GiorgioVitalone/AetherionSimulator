#!/bin/zsh
# Completion-sprint validation chain (audit items 3 + 5). Sequential, ledgered.
set -e
cd "$(dirname "$0")/.."

POOL=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json

# 1. Card-gate no-op validation — DONE 2026-07-11 (VERDICT: PASS, no-op short-circuit,
# ledgered). Kept here commented for reproducibility:
#   cp $POOL /tmp/gate-noop-copy.json && node balance-card-gate.mjs /tmp/gate-noop-copy.json --faction Sapphire

# 2. comp-card r12 confirmation on the RATIFIED pool (locks the Step-2 record)
out="balance-runs/runs/tmp-fp-comp-card-r12.json"
echo "\n──── comp-card confirmation @r12 ────"
ROLLOUTS=12 GPP=1000 AETHERION_CARDS=$POOL GAUGE_OUT=$out node balance-fp-probe.mjs
node -e "import('./balance-ledger.mjs').then(m => { const e = m.appendRun({kind:'fp-probe', label:'fp-comp-card-r12-rd12-final', resultPath:'${out}', env:{ROLLOUTS:'12', GPP:'1000'}}); console.log('ledger:', e.id); })"

# 3. Remaining rule ablations at matched sizes (for the record; §13q Step 3)
for flag in terminationMode costFloor reserveTapChoice reserveTapStrain exileDiscardForEnergy apnapAnyOrderFix; do
  echo "\n──── RULE_OFF=${flag} ────"
  node balance-cli.mjs verify --preset ablation --label "abl-${flag}" --pool ./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json --env RULE_OFF=$flag
done
echo "\n──── ablation: resourceDeckSize (RD15 control) ────"
node balance-cli.mjs verify --preset ablation --label abl-resourceDeckSize --pool ./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json --env RESOURCE_DECK=15
echo "\n──── reference: locked ruleset at matched ablation sizes ────"
node balance-cli.mjs verify --preset ablation --label abl-reference --pool ./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json

# 4. Card-gate historical validation: the §8 pricer-blind Sapphire redesign must FAIL.
echo "\n──── sapphire-redesign validation baseline (CURRENT pool, locked rules) ────"
node balance-cli.mjs verify --preset verdict --label sapphire-val-baseline --pool ./generated-pools/aetherion-CURRENT.json
echo "\n──── gate: sapphire-redesign must FAIL ────"
SVB_ID=$(node -e "import('./balance-ledger.mjs').then(m => console.log(m.readLedger(50).findLast(e => e.label === 'sapphire-val-baseline').id))")
if node balance-card-gate.mjs ./generated-pools/aetherion-CURRENT-plus-sapphire-redesign.json --faction Sapphire --baseline "$SVB_ID"; then
  echo 'VALIDATION FAILURE: gate PASSED the known-broken sapphire pool'; exit 1
else
  echo "gate correctly rejected sapphire-redesign (exit $?)"
fi
echo "\nCompletion chain done."
