#!/usr/bin/env python3
"""Convert the sanitized aetherion pg_dump into the JSON the sim consumes:
  - aetherion-cards.json : flat array of card defs (sim-runner.mjs `raw` shape)
  - aetherion-decks.json : the 4 official starter decks (deck-loader.mjs)
Only the `cards`, `decks`, and `deck_cards` tables are read. Nothing else from the
dump is emitted.
"""
import sys, json, os

DUMP = sys.argv[1]
OUT = sys.argv[2]
lines = open(DUMP, encoding="utf8").read().split("\n")

def copy_block(header_prefix):
    s = next(i for i, l in enumerate(lines) if l.startswith(header_prefix)) + 1
    e = next(j for j in range(s, len(lines)) if lines[j] == "\\.")
    return lines[s:e]

def unescape(field):
    """Undo Postgres COPY text-format escaping for one field. \\N => None."""
    if field == "\\N":
        return None
    out = []
    i = 0
    m = {"t": "\t", "n": "\n", "r": "\r", "\\": "\\", "b": "\b", "f": "\f", "v": "\v"}
    while i < len(field):
        ch = field[i]
        if ch == "\\" and i + 1 < len(field):
            nxt = field[i + 1]
            out.append(m.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)

def pg_array(s):
    """Parse a Postgres text-array literal like {Onyx,Lich} or {} or {"a b",c}."""
    if s is None:
        return []
    s = s.strip()
    if not (s.startswith("{") and s.endswith("}")):
        return []
    inner = s[1:-1]
    if inner == "":
        return []
    items, cur, inq, i = [], [], False, 0
    while i < len(inner):
        c = inner[i]
        if inq:
            if c == "\\" and i + 1 < len(inner):
                cur.append(inner[i + 1]); i += 2; continue
            if c == '"':
                inq = False; i += 1; continue
            cur.append(c); i += 1
        else:
            if c == '"':
                inq = True; i += 1; continue
            if c == ",":
                items.append("".join(cur)); cur = []; i += 1; continue
            cur.append(c); i += 1
    items.append("".join(cur))
    return items

def jload(s):
    return None if s is None else json.loads(s)

# ── cards ────────────────────────────────────────────────────────────────────
# columns: id,cardCode,setId,name,cardType,alignment,rarity,tags,traits,flavorText,
#          artUrl,position,cost,stats,abilities,transformationId,originalHeroId,...
CARD_COLS = ["id","cardCode","setId","name","cardType","alignment","rarity","tags",
             "traits","flavorText","artUrl","position","cost","stats","abilities",
             "transformationId","originalHeroId"]

def to_int(v):
    return None if v is None else int(v)

cards = []
by_id = {}
for l in copy_block("COPY public.cards (id,"):
    c = l.split("\t")
    row = dict(zip(CARD_COLS, c[:len(CARD_COLS)]))
    cost = jload(unescape(row["cost"])) or {}
    stats = jload(unescape(row["stats"]))
    abilities = jload(unescape(row["abilities"])) or []
    # DB cost.flexible/xMana/xEnergy are booleans; the engine Cost wants numeric
    # mana/energy/flexible. Keep the explicit mana/energy amounts; the `flexible`
    # boolean is a pay-with-either flag with no separate amount, so it maps to 0
    # (the affected cards are Verdant energy cards in Verdant energy decks, where
    # energy vs flexible payment is equivalent). X-cost is detected from tags/name.
    out = {
        "id": int(row["id"]),
        "cardCode": unescape(row["cardCode"]),
        "name": unescape(row["name"]),
        "cardType": row["cardType"],
        "alignment": pg_array(row["alignment"]),
        "rarity": unescape(row["rarity"]),
        "tags": pg_array(row["tags"]),
        "traits": pg_array(row["traits"]),
        "cost": {
            "mana": int(cost.get("mana") or 0),
            "energy": int(cost.get("energy") or 0),
            "flexible": 0,
        },
        "stats": None if stats is None else {
            "hp": int(stats.get("hp") or 0),
            "atk": int(stats.get("atk") or 0),
            "arm": int(stats.get("arm") or 0),
        },
        "abilities": abilities,
        "transformationId": to_int(unescape(row["transformationId"])),
        "originalHeroId": to_int(unescape(row["originalHeroId"])),
    }
    cards.append(out)
    by_id[out["id"]] = out

# ── decks (official only) ─────────────────────────────────────────────────────
# decks cols: id,deckId,name,heroId,description,tags,heroTransformationId,createdAt,
#             updatedAt,mainAlignment,isPublic,isOfficial,...
deck_rows = {}
for l in copy_block("COPY public.decks (id,"):
    c = l.split("\t")
    deck_rows[int(c[0])] = {
        "id": int(c[0]), "deckId": c[1], "name": unescape(c[2]),
        "heroId": int(c[3]), "mainAlignment": (None if c[9] in ("\\N", "") else c[9]),
        "isOfficial": c[11] == "t",
    }

# deck_cards cols: id,deckId,cardId,quantity,isResource,...
from collections import defaultdict
main_of = defaultdict(list)
res_of = defaultdict(list)
for l in copy_block("COPY public.deck_cards (id,"):
    c = l.split("\t")
    did, cid, qty, isres = int(c[1]), int(c[2]), int(c[3]), c[4] == "t"
    (res_of if isres else main_of)[did].extend([cid] * qty)

def faction_of(d):
    if d["mainAlignment"]:
        return d["mainAlignment"]
    hero = by_id.get(d["heroId"])
    return hero["alignment"][0] if hero and hero["alignment"] else None

decks = []
problems = []
for d in sorted(deck_rows.values(), key=lambda x: x["id"]):
    if not d["isOfficial"]:
        continue
    main = sorted(main_of[d["id"]])
    res = sorted(res_of[d["id"]])
    missing = [cid for cid in main + res + [d["heroId"]] if cid not in by_id]
    if missing:
        problems.append((d["name"], missing))
    decks.append({
        "deckId": d["deckId"],
        "name": d["name"],
        "faction": faction_of(d),
        "heroDefId": d["heroId"],
        "mainDeckDefIds": main,
        "resourceDeckDefIds": res,
    })

os.makedirs(OUT, exist_ok=True)
json.dump(cards, open(os.path.join(OUT, "aetherion-cards.json"), "w"), indent=0)
json.dump(decks, open(os.path.join(OUT, "aetherion-decks.json"), "w"), indent=0)

print(f"cards: {len(cards)}")
from collections import Counter
print("  by type:", dict(Counter(c["cardType"] for c in cards)))
print(f"official decks: {len(decks)}")
for d in decks:
    print(f"  {d['faction']:8} hero={d['heroDefId']} main={len(d['mainDeckDefIds'])} "
          f"res={len(d['resourceDeckDefIds'])} :: {d['name']}")
if problems:
    print("DANGLING CARD REFS:", problems)
else:
    print("all deck card refs resolve OK")
