#!/bin/zsh
# Step 2 first-player-compensation sweep (rule-lock): mirror-only @RD12 r8,
# 4,000 mirror games per lever. play_or_draw is modeled as "card" in the engine
# (sim-runner header) — not run separately.
set -e
cd "$(dirname "$0")/.."
POOL=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json
for comp in card resource both; do
  out="balance-runs/runs/tmp-fp-comp-${comp}.json"
  echo "\n──── comp-${comp} ────"
  COMP=$comp ROLLOUTS=8 RESOURCE_DECK=12 GPP=1000 WORKERS=8 AETHERION_CARDS=$POOL GAUGE_OUT=$out node balance-fp-probe.mjs
  node -e "import('./balance-ledger.mjs').then(m => { const e = m.appendRun({kind:'fp-probe', label:'fp-comp-${comp}-r8-rd12', resultPath:'${out}', env:{ROLLOUTS:'8', GPP:'1000', RESOURCE_DECK:'12', COMP:'${comp}'}}); console.log('ledger:', e.id); })"
done
echo "\nComp sweep complete."
