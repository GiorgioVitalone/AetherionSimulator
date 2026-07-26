// trace-game.mjs — play ONE game of a matchup and print a readable, event-level
// play-by-play, so a human can verify that cards and interactions actually resolve.
//
// Unlike the action-type counters, this dumps the GAME LOG delta each turn with card
// names resolved, so you see which card did what to whom — the level of detail needed
// to spot "this ability never fires" or "this interaction resolves wrongly".
//
// Usage: node trace-game.mjs <FactionA> <FactionB> [seed=12345] [ruleset=v3]
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const ENGINE = new URL('.', import.meta.url).pathname;
const [, , FA = 'Onyx', FB = 'Sapphire', seedArg, rulesetArg] = process.argv;
const SEED = +(seedArg || 12345);
const RULESET = rulesetArg || 'v3';

process.env.AETHERION_CARDS =
  process.env.AETHERION_CARDS || ENGINE + 'sim-data/pools/aetherion-BALANCED-v2-frozen.json';
const { runSim } = await import(pathToFileURL(ENGINE + 'sim-runner.mjs').href);

const pool = JSON.parse(readFileSync(process.env.AETHERION_CARDS, 'utf8'));
const nameOfDef = new Map(pool.map((c) => [c.id, c.name]));

// instanceId -> name, learned by scanning state each turn (instances appear as they enter play).
const instName = new Map();
function learnNames(gs) {
  for (const p of gs.players) {
    for (const zone of [p.zones.reserve, p.zones.frontline, p.zones.highGround]) {
      for (const c of zone) {
        if (c === null) continue;
        instName.set(c.instanceId, nameOfDef.get(c.cardDefId) ?? `#${c.cardDefId}`);
        if (c.equipment) {
          instName.set(c.equipment.instanceId, nameOfDef.get(c.equipment.cardDefId) ?? '?equip');
        }
      }
    }
    for (const c of p.hand) instName.set(c.instanceId, nameOfDef.get(c.cardDefId) ?? `#${c.cardDefId}`);
    instName.set(`hero_${String(p.hero.cardDefId)}`, `${p.hero.name} (HERO)`);
  }
}
const nm = (id) => (id == null ? '?' : (instName.get(id) ?? id));

// Render one game event compactly. Unknown event types still print their type + fields
// so nothing is silently hidden — the point of this tool is to catch the unexpected.
function render(e) {
  const t = e.type;
  switch (t) {
    case 'CARD_DEPLOYED': return `deploy ${nm(e.cardInstanceId)} -> ${e.zone}`;
    case 'SPELL_CAST': return `cast ${nm(e.cardInstanceId)}`;
    case 'DAMAGE_DEALT': return `damage ${e.amount} -> ${nm(e.targetId ?? e.cardInstanceId)}`;
    case 'HERO_DAMAGED': return `HERO DMG ${e.amount} -> P${e.playerId}`;
    case 'HERO_HEALED': return `hero heal ${e.amount} -> P${e.playerId}`;
    case 'CARD_DESTROYED': return `DESTROYED ${nm(e.cardInstanceId)}`;
    case 'ABILITY_ACTIVATED': return `ability! ${nm(e.cardInstanceId)} [#${e.abilityIndex}]`;
    case 'TRIGGER_FIRED': return `TRIGGER ${nm(e.sourceInstanceId ?? e.cardInstanceId)}`;
    case 'CHARACTER_ATTACKED': return `attack ${nm(e.attackerId)} -> ${nm(e.targetId)}`;
    case 'CARD_DRAWN': return `draw P${e.playerId}`;
    case 'RESOURCE_GAINED': return `+${e.amount} ${e.resourceType} P${e.playerId}`;
    case 'CARD_MOVED': return `move ${nm(e.cardInstanceId)} -> ${e.toZone ?? e.zone}`;
    case 'CARD_BOUNCED': return `BOUNCE ${nm(e.cardInstanceId)}`;
    case 'SPELL_COUNTERED': return `COUNTERED ${nm(e.cardInstanceId)}`;
    case 'STAT_MODIFIED': return `stats ${nm(e.cardInstanceId)} ${JSON.stringify(e.modifier ?? {})}`;
    case 'TURN_START': case 'TURN_END': return null; // structural noise
    default: {
      const { type, ...rest } = e;
      return `${type} ${JSON.stringify(rest).slice(0, 90)}`;
    }
  }
}

const manifest = JSON.parse(readFileSync(ENGINE + `sim-data/ruleset-${RULESET}.json`, 'utf8'));
const RULES = {
  rulesProfile: `legacy-${RULESET}`,
  reachDiscard: true, termination: 'tiebreak', firstPlayer: 'alternating',
  seatAlternation: false, fixHandSizeStall: true, turnCap: 80, ...manifest.rules,
};

let lastLogLen = 0;
const out = [];
const trace = {
  onTurn: (gs) => {
    learnNames(gs);
    // Flush the log delta produced since the previous turn boundary.
    for (let i = lastLogLen; i < gs.log.length; i++) {
      const line = render(gs.log[i]);
      if (line) out.push(`        ${line}`);
    }
    lastLogLen = gs.log.length;
    const side = (p) => {
      const b = [...p.zones.reserve, ...p.zones.frontline, ...p.zones.highGround].filter(Boolean);
      const body = b.map((c) => `${nm(c.instanceId)}(${c.currentAtk}/${c.currentHp})`).join(' ');
      const bank = p.resourceBank ?? [];
      const avail = bank.filter((r) => !r.exhausted).length;
      const temp = (p.temporaryResources ?? []).reduce((s2, t) => s2 + t.amount, 0);
      return `lp${String(p.hero.currentLp).padStart(2)} hand${p.hand.length} deck${p.mainDeck.length} res${avail}/${bank.length}${temp ? `+${temp}t` : ''} | ${body || '(empty board)'}`;
    };
    out.push(`\nT${String(gs.turnNumber).padStart(2)} P${gs.activePlayerIndex}${gs.players[gs.activePlayerIndex].hero.transformed ? ' [TRANSFORMED]' : ''}`);
    out.push(`   ${FA.padEnd(8)} ${side(gs.players[0])}`);
    out.push(`   ${FB.padEnd(8)} ${side(gs.players[1])}`);
  },
  onAction: () => {},
};

const res = runSim({
  decks: { [FA]: FA, [FB]: FB }, matchups: { factions: [FA, FB], includeMirrors: false }, ...RULES,
  botPolicy: 'rollout', rollouts: 8, rolloutDepth: 3, maxCandidates: 8,
  candidateGen: 'full', playoutBackend: 'snapshot', rolloutPlayout: 'heuristic',
  gamesPerPairing: 1, seedBase: SEED, __trace: trace,
});

console.log(`=== ${FA} vs ${FB} (seed ${SEED}, ruleset ${RULESET}) ===`);
console.log(out.join('\n'));
console.log(`\nRESULT: ${JSON.stringify(res.factionWinPct)}`);
