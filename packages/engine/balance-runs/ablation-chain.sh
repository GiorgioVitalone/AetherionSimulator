#!/bin/zsh
# Step 3 one-flag-off ablation battery (rule-lock): each adopted rule re-earns
# its place on the current pool at RD12. Ablation preset (GPP_MATRIX=200,
# RL=300, RH=200) — rollout-weighted, graded at the pooled-rollout verdict layer.
# resourceDeckSize ablation = the same panel WITHOUT --rd (RD15).
set -e
cd "$(dirname "$0")/.."
POOL=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json
for flag in armFirstInstanceOnly terminationMode costFloor reserveTapChoice reserveTapStrain exileDiscardForEnergy; do
  echo "\n──── RULE_OFF=${flag} ────"
  WORKERS=8 node balance-cli.mjs verify --preset ablation --label "abl-${flag}" --rd 12 --pool $POOL --env RULE_OFF=$flag
done
echo "\n──── ablation: resourceDeckSize (RD15 control at matched sizes) ────"
WORKERS=8 node balance-cli.mjs verify --preset ablation --label abl-resourceDeckSize --pool $POOL
echo "\n──── reference: full ruleset at matched ablation sizes ────"
WORKERS=8 node balance-cli.mjs verify --preset ablation --label abl-reference --rd 12 --pool $POOL
echo "\nAblation battery complete."
