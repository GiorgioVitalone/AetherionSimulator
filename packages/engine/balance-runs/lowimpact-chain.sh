#!/bin/zsh
# Low-impact rule-lock chain: nice -n 19, WORKERS=3, strictly sequential.
# Prior heavier runs were killed on a loaded shared machine — this chain yields
# CPU to interactive users and other workloads.
set -e
cd "$(dirname "$0")/.."
POOL=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json

# 1. comp-card confirmation at the r12 verdict rung (gates RD12+comp adoption)
out="balance-runs/runs/tmp-fp-comp-card-r12.json"
echo "\n──── comp-card confirmation @r12 ────"
COMP=card ROLLOUTS=12 RESOURCE_DECK=12 GPP=1000 WORKERS=3 AETHERION_CARDS=$POOL GAUGE_OUT=$out nice -n 19 node balance-fp-probe.mjs
node -e "import('./balance-ledger.mjs').then(m => { const e = m.appendRun({kind:'fp-probe', label:'fp-comp-card-r12-rd12', resultPath:'${out}', env:{ROLLOUTS:'12', GPP:'1000', RESOURCE_DECK:'12', COMP:'card'}}); console.log('ledger:', e.id); })"

# 2. Remaining ablations (armFirstInstanceOnly already ledgered) + RD15 control + matched reference
for flag in terminationMode costFloor reserveTapChoice reserveTapStrain exileDiscardForEnergy; do
  echo "\n──── RULE_OFF=${flag} ────"
  WORKERS=3 nice -n 19 node balance-cli.mjs verify --preset ablation --label "abl-${flag}" --rd 12 --pool $POOL --env RULE_OFF=$flag
done
echo "\n──── ablation: resourceDeckSize (RD15 control) ────"
WORKERS=3 nice -n 19 node balance-cli.mjs verify --preset ablation --label abl-resourceDeckSize --pool $POOL
echo "\n──── reference: full ruleset at matched ablation sizes ────"
WORKERS=3 nice -n 19 node balance-cli.mjs verify --preset ablation --label abl-reference --rd 12 --pool $POOL
echo "\nLow-impact chain complete."
