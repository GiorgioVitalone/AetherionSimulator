# Neural value net (Aetherion balance pilot)

A small MLP that predicts **P(side-to-move wins)** from a 374-feature perspective-canonical
position vector. Trained on games played by the trustworthy rollout-heuristic bot; used at
inference (Stage C) to drive the fast `valueGreedy` pilot — rollout-quality verdicts at
one-ply speed.

## Pipeline

```
1. Generate data (Node, in packages/engine — a sim battery, chunked/streaming):
     pnpm --filter @aetherion-sim/engine build      # ensure dist has the featurizer
     node neural-datagen.mjs <totalGamesPerPairing> data/train.ndjson [chunkGpp=25]
   -> NDJSON: header {schemaVersion, featureLength:374, teacher} + rows {f, y, game, turn, faction}

2. Train (Python, in packages/engine/neural — uv):
     uv venv && uv pip install -r requirements.txt
     uv run python train.py data/train.ndjson --out-dir model
   -> model/value-net.json (weights + paritySamples) + model/model-meta.json (valAuc, modelSha256, ...)

3. Inference (Stage C): pilot-value.mjs loads model/value-net.json and runs a SYNCHRONOUS JS
   MLP forward pass — no ONNX / native runtime (the sim's per-decision loop is synchronous).
```

## Contract (do not drift)

- **Feature length = 374, feature schema version = 1** — the value-net.json input dim MUST match
  the TypeScript featurizer (`src/neural/featurizer.ts`, `FEATURE_LENGTH`/`FEATURE_SCHEMA_VERSION`).
  Regenerate data and retrain if the featurizer schema version bumps.
- value-net.json: `{ featureLength, featureSchemaVersion, layers: [{W:[out][in], b:[out]}, ...],
  activation:"relu-hidden-sigmoid-out", paritySamples:[{f, prob}] }`. The pilot runs it in JS and
  validates paritySamples (< 1e-4) + schema at load. Output = P(side-to-move wins) in [0,1].
- `model-meta.json` carries `modelSha256` + `featureSchemaVersion`; Stage C puts both into the
  sim's hashed config (a real rules dimension — a different net → different games).

## Why game-grouped split

Positions within one game are highly correlated. `train.py` splits by `game` id so all rows of
a game land on one side — a naive per-row split leaks and inflates val AUC. Effective sample
size ≈ number of games, not number of rows, so generate enough GAMES (not just turns).

## Success criteria

- Training: val AUC clearly > 0.5 (and the numpy-forward vs torch parity diff < 1e-4).
- **Definitive**: Stage D — does `valueGreedy` reproduce the rollout verdict on the 4 starters
  (Onyx top, Radiant bottom) at ~valuePilot speed? AUC is necessary, not sufficient.
