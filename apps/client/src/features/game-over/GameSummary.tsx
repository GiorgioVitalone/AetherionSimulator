/**
 * GameSummary — computed stats from the game log.
 */
import { type ReactNode, useMemo } from 'react';
import type { GameEvent } from '@aetherion-sim/engine';

interface GameSummaryProps {
  readonly log: readonly GameEvent[];
}

interface Stats {
  readonly turnsPlayed: number;
  readonly cardsDeployed: number;
  readonly damageDealt: number;
  readonly spellsCast: number;
}

export function GameSummary({ log }: GameSummaryProps): ReactNode {
  const stats = useMemo((): Stats => {
    let turnsPlayed = 0;
    let cardsDeployed = 0;
    let damageDealt = 0;
    let spellsCast = 0;

    for (const event of log) {
      switch (event.type) {
        case 'TURN_START': turnsPlayed++; break;
        case 'CARD_DEPLOYED': cardsDeployed++; break;
        case 'DAMAGE_DEALT': damageDealt += event.amount; break;
        case 'HERO_DAMAGED': damageDealt += event.amount; break;
        case 'SPELL_CAST': spellsCast++; break;
      }
    }

    return { turnsPlayed, cardsDeployed, damageDealt, spellsCast };
  }, [log]);

  return (
    <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
      <StatItem label="Turns" value={stats.turnsPlayed} />
      <StatItem label="Deployed" value={stats.cardsDeployed} />
      <StatItem label="Damage" value={stats.damageDealt} />
      <StatItem label="Spells" value={stats.spellsCast} />
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="text-center p-2 rounded-[var(--radius-md)]" style={{ backgroundColor: 'var(--color-surface-alt)' }}>
      <div className="font-mono text-lg font-medium text-[var(--color-text)]">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold font-body">
        {label}
      </div>
    </div>
  );
}
