#!/bin/zsh
# Step 1 mirror-FP probe chain (rule-lock). Sequential to keep machine load bounded.
set -e
cd "$(dirname "$0")/.."
POOL=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json
run_probe() { # label rollouts rd_env
  local label=$1 rollouts=$2 rd=$3
  local out="balance-runs/runs/tmp-${label}.json"
  echo "\n──── ${label} ────"
  if [ -n "$rd" ]; then
    ROLLOUTS=$rollouts RESOURCE_DECK=$rd GPP=1000 WORKERS=8 AETHERION_CARDS=$POOL GAUGE_OUT=$out node balance-fp-probe.mjs
  else
    ROLLOUTS=$rollouts GPP=1000 WORKERS=8 AETHERION_CARDS=$POOL GAUGE_OUT=$out node balance-fp-probe.mjs
  fi
  node -e "import('./balance-ledger.mjs').then(m => { const e = m.appendRun({kind:'fp-probe', label:'${label}', resultPath:'${out}', env:{ROLLOUTS:'${rollouts}', GPP:'1000', RESOURCE_DECK:'${rd:-15}'}}); console.log('ledger:', e.id); })"
}
run_probe fp-r12-rd12 12 12   # E1 verdict rung — the RD12 gate read
run_probe fp-r8-rd12   8 12   # E1 dose-response
run_probe fp-r4-rd12   4 12   # E1 dose-response
run_probe fp-r8-rd15   8 ""   # E2 attribution control (RD15)
echo "\nFP probe chain complete."
