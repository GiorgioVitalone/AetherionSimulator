#!/usr/bin/env python3
"""Train the Aetherion value net from an NDJSON dataset (neural-datagen.mjs output).

Predicts P(side-to-move wins) from the 374-d perspective-canonical feature vector.
Uses a GAME-GROUPED train/val split so positions from one game never straddle the
split (positions within a game are highly correlated — a naive row split leaks and
inflates val AUC). Exports raw Linear weights as value-net.json for a synchronous JS
forward pass in the sim (pilot-value.mjs) — no ONNX / native runtime needed.

Usage:
  python train.py <dataset.ndjson> [--out-dir model] [--epochs 60]
                  [--hidden 256 128 64] [--dropout 0.3] [--seed 0]

Success signal: val AUC clearly above 0.5 (coin flip). The DEFINITIVE test is Stage D
(does the valueGreedy pilot reproduce the rollout verdict?), not AUC alone.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

MODEL_SCHEMA_VERSION = 1  # bump on any arch/output-contract change


def load_ndjson(path):
    header, feats, labels, games = None, [], [], []
    with open(path) as fh:
        for i, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if header is None and "featureLength" in obj:  # header = first row carrying it
                header = obj
                continue
            feats.append(obj["f"])
            labels.append(obj["y"])
            games.append(obj["game"])
    return (
        header,
        np.asarray(feats, np.float32),
        np.asarray(labels, np.float32),
        np.asarray(games, np.int64),
    )


def game_grouped_split(games, val_frac, seed):
    uniq = np.unique(games)
    rng = np.random.default_rng(seed)
    rng.shuffle(uniq)
    n_val = max(1, int(round(len(uniq) * val_frac)))
    val_games = set(uniq[:n_val].tolist())
    val_mask = np.array([g in val_games for g in games], dtype=bool)
    return ~val_mask, val_mask


def rank_auc(y_true, y_score):
    """Mann-Whitney AUC with tie-averaged ranks (no sklearn dependency)."""
    order = np.argsort(y_score, kind="mergesort")
    ranks = np.empty(len(y_score), dtype=np.float64)
    s = y_score[order]
    i = 0
    r = 1
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        avg = (r + (r + (j - i))) / 2.0
        ranks[order[i : j + 1]] = avg
        r += j - i + 1
        i = j + 1
    pos = y_true == 1
    n_pos, n_neg = int(pos.sum()), int((~pos).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return (ranks[pos].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


class MLP(nn.Module):
    def __init__(self, in_dim, hidden, p_drop):
        super().__init__()
        layers, d = [], in_dim
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU(), nn.Dropout(p_drop)]
            d = h
        layers += [nn.Linear(d, 1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):  # returns logits
        return self.net(x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--out-dir", default="model")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--patience", type=int, default=15)  # early-stop on val-AUC plateau
    # Modest net + strong dropout: effective sample size ≈ #games (~3000), not #rows, so
    # keep capacity low to avoid overfitting (raise --hidden for a much bigger corpus).
    ap.add_argument("--hidden", type=int, nargs="+", default=[128, 64])
    ap.add_argument("--dropout", type=float, default=0.4)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device: {device}")

    header, feats, labels, games = load_ndjson(args.dataset)
    n_games = len(np.unique(games))
    print(
        f"loaded {len(feats)} rows | {n_games} games | feature_len {feats.shape[1]} "
        f"| label_mean {labels.mean():.4f}"
    )
    if header and feats.shape[1] != header.get("featureLength"):
        sys.exit(f"feature length mismatch: data {feats.shape[1]} vs header {header.get('featureLength')}")
    if n_games < 20:
        print("WARNING: <20 games — val split will be tiny/noisy; generate a bigger dataset.")

    tr, va = game_grouped_split(games, args.val_frac, args.seed)
    print(
        f"train {int(tr.sum())} rows / {len(np.unique(games[tr]))} games | "
        f"val {int(va.sum())} rows / {len(np.unique(games[va]))} games"
    )

    x_tr = torch.from_numpy(feats[tr])
    y_tr = torch.from_numpy(labels[tr]).unsqueeze(1)
    x_va = torch.from_numpy(feats[va]).to(device)
    y_va = labels[va]
    loader = DataLoader(TensorDataset(x_tr, y_tr), batch_size=args.batch, shuffle=True)

    core = MLP(feats.shape[1], args.hidden, args.dropout).to(device)
    opt = torch.optim.Adam(core.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    loss_fn = nn.BCEWithLogitsLoss()

    best_auc, best_state, since_best = -1.0, None, 0
    for ep in range(1, args.epochs + 1):
        core.train()
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(core(xb), yb)
            loss.backward()
            opt.step()
        core.eval()
        with torch.no_grad():
            logits = core(x_va).cpu().numpy().ravel()
        prob = 1.0 / (1.0 + np.exp(-logits))
        a = rank_auc(y_va, prob)
        acc = float(((prob > 0.5).astype(np.float32) == y_va).mean())
        print(f"epoch {ep:3d}  val_auc {a:.4f}  val_acc {acc:.4f}")
        if a > best_auc:
            best_auc = a
            best_state = {k: v.detach().cpu().clone() for k, v in core.state_dict().items()}
            since_best = 0
        else:
            since_best += 1
            if since_best >= args.patience:
                print(f"early stop at epoch {ep} (no val_auc gain for {args.patience} epochs)")
                break

    core.load_state_dict(best_state)
    core.eval()
    print(f"best val_auc {best_auc:.4f}  (0.5 = coin flip)")

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    core_cpu = core.to("cpu").eval()

    # Export raw Linear weights for a SYNCHRONOUS JS forward pass. The sim's per-decision
    # loop is synchronous; onnxruntime-node inference is async-only. This MLP is tiny
    # (374->hidden->1), so the pilot runs it directly in JS — faster, fully deterministic,
    # no native addon. Layers = the Linear ops in order; activation = ReLU after each
    # hidden layer, sigmoid after the last. W is [out][in], b is [out].
    layers = [
        {"W": m.weight.detach().numpy().tolist(), "b": m.bias.detach().numpy().tolist()}
        for m in core_cpu.net
        if isinstance(m, nn.Linear)
    ]
    with torch.no_grad():
        probe = feats[:8]
        probe_probs = torch.sigmoid(core_cpu(torch.from_numpy(probe))).numpy().ravel()
    parity_samples = [{"f": probe[i].tolist(), "prob": float(probe_probs[i])} for i in range(len(probe))]

    weights = {
        "modelSchemaVersion": MODEL_SCHEMA_VERSION,
        "featureSchemaVersion": header.get("schemaVersion") if header else None,
        "featureLength": int(feats.shape[1]),
        "arch": args.hidden,
        "activation": "relu-hidden-sigmoid-out",
        "layers": layers,
        "paritySamples": parity_samples,  # pilot-value.mjs must reproduce these in JS
    }
    weights_path = out / "value-net.json"
    weights_path.write_text(json.dumps(weights))
    sha = hashlib.sha256(weights_path.read_bytes()).hexdigest()
    meta = {
        "modelSchemaVersion": MODEL_SCHEMA_VERSION,
        "featureSchemaVersion": header.get("schemaVersion") if header else None,
        "featureLength": int(feats.shape[1]),
        "arch": args.hidden,
        "dropout": args.dropout,
        "teacher": header.get("teacher") if header else None,
        "trainGames": int(len(np.unique(games[tr]))),
        "valGames": int(len(np.unique(games[va]))),
        "valAuc": float(best_auc),
        "modelSha256": sha,
    }
    (out / "model-meta.json").write_text(json.dumps(meta, indent=2))

    # Sanity: a pure-numpy forward pass (the exact math the JS pilot runs) must reproduce
    # the torch probabilities on the parity samples.
    def np_forward(x):
        a = x
        for i, layer in enumerate(layers):
            a = np.asarray(layer["W"], np.float32) @ a + np.asarray(layer["b"], np.float32)
            a = np.maximum(a, 0.0) if i < len(layers) - 1 else 1.0 / (1.0 + np.exp(-a))
        return float(a[0])

    max_diff = max(abs(np_forward(np.asarray(s["f"], np.float32)) - s["prob"]) for s in parity_samples)
    print(f"numpy-forward vs torch max diff: {max_diff:.2e} (JS pilot must match paritySamples)")
    print(f"wrote {weights_path} + model-meta.json (sha {sha[:12]}, val_auc {best_auc:.4f})")


if __name__ == "__main__":
    main()
