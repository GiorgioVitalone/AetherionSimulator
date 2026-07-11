#!/bin/zsh
# For-the-record chain (rule-lock §13q): comp r12 confirmation, remaining
# ablations, and the card-gate historical validation. Max workers, sequential.
# Sized per balance-targets.json presetSizes rationale — precision only where
# a decision line needs it.
set -e
cd "$(dirname "$0")/.."
POOL=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json

# 1. comp-card confirmation at the r12 verdict rung (4,000 mirrors, CI ±1.5pp)
out="balance-runs/runs/tmp-fp-comp-card-r12.json"
echo "\n──── comp-card confirmation @r12 ────"
COMP=card ROLLOUTS=12 RESOURCE_DECK=12 GPP=1000 AETHERION_CARDS=$POOL GAUGE_OUT=$out node balance-fp-probe.mjs
node -e "import('./balance-ledger.mjs').then(m => { const e = m.appendRun({kind:'fp-probe', label:'fp-comp-card-r12-rd12', resultPath:'${out}', env:{ROLLOUTS:'12', GPP:'1000', RESOURCE_DECK:'12', COMP:'card'}}); console.log('ledger:', e.id); })"

# 2. Remaining ablations (armFirstInstanceOnly already ledgered)
for flag in terminationMode costFloor reserveTapChoice reserveTapStrain exileDiscardForEnergy; do
  echo "\n──── RULE_OFF=${flag} ────"
  node balance-cli.mjs verify --preset ablation --label "abl-${flag}" --rd 12 --pool $POOL --env RULE_OFF=$flag
done
echo "\n──── ablation: resourceDeckSize (RD15 control) ────"
node balance-cli.mjs verify --preset ablation --label abl-resourceDeckSize --pool $POOL
echo "\n──── reference: full ruleset at matched ablation sizes ────"
node balance-cli.mjs verify --preset ablation --label abl-reference --rd 12 --pool $POOL

# 3. Card-gate historical validation: the §8 pricer-blind case must FAIL Stage B.
echo "\n──── sapphire-redesign validation baseline (CURRENT pool) ────"
node balance-cli.mjs verify --preset verdict --label sapphire-val-baseline --rd 12 --pool ./generated-pools/aetherion-CURRENT.json
echo "\n──── gate: sapphire-redesign must FAIL ────"
SVB_ID=$(node -e "import('./balance-ledger.mjs').then(m => console.log(m.readLedger(50).findLast(e => e.label === 'sapphire-val-baseline').id))")
node balance-card-gate.mjs ./generated-pools/aetherion-CURRENT-plus-sapphire-redesign.json --faction Sapphire --rd 12 --baseline "$SVB_ID" && { echo 'VALIDATION FAILURE: gate PASSED the known-broken sapphire pool'; exit 1; } || echo "gate correctly rejected sapphire-redesign (exit $?)"
echo "\nRecord chain complete."
