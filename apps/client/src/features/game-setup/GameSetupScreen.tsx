/**
 * GameSetupScreen — two-column hero picker with seed input and start button.
 * Each player picks a hero; the app auto-builds starter decks from the faction.
 */
import { type ReactNode, useState, useMemo, useCallback } from 'react';
import { getAllCards, buildStarterDeck } from '@/features/game-setup/deck-loader';
import { useGameStore } from '@/stores/game-store';
import { HeroPickerCard } from './HeroPickerCard';
import { SeedInput } from './components/SeedInput';
import type { SimCard } from '@aetherion-sim/cards';

export function GameSetupScreen(): ReactNode {
  const startGame = useGameStore((s) => s.startGame);

  const heroes = useMemo(
    () => getAllCards().filter((c): c is SimCard & { cardType: 'H' } => c.cardType === 'H'),
    [],
  );

  const [p1Hero, setP1Hero] = useState<SimCard | null>(null);
  const [p2Hero, setP2Hero] = useState<SimCard | null>(null);
  const [seed, setSeed] = useState('');

  const canStart = p1Hero !== null && p2Hero !== null;

  const handleStart = useCallback(() => {
    if (!p1Hero || !p2Hero) return;

    const p1Faction = p1Hero.alignment[0] ?? '';
    const p2Faction = p2Hero.alignment[0] ?? '';

    const p1Deck = buildStarterDeck(p1Faction);
    const p2Deck = buildStarterDeck(p2Faction);

    startGame({
      player1: { faction: p1Faction, deck: p1Deck },
      player2: { faction: p2Faction, deck: p2Deck },
      seed: seed ? parseInt(seed, 10) : undefined,
    });
  }, [p1Hero, p2Hero, seed, startGame]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      {/* Title */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black tracking-normal mb-2">
          Aetherion Simulator
        </h1>
        <p className="text-[var(--color-text-secondary)] text-sm font-body">
          Choose a hero for each player to begin
        </p>
      </div>

      {/* Two-column hero pickers */}
      <div className="flex gap-10 w-full max-w-5xl mb-8">
        {/* Player 1 */}
        <div className="flex-1">
          <h2 className="text-sm font-semibold font-body text-[var(--color-text-muted)] uppercase tracking-widest mb-4">
            Player 1
          </h2>
          <div className="grid gap-3">
            {heroes.map((hero) => (
              <HeroPickerCard
                key={hero.id}
                hero={hero}
                selected={p1Hero?.id === hero.id}
                disabled={p2Hero?.id === hero.id}
                onSelect={() => setP1Hero(hero)}
              />
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-[var(--color-border)] self-stretch" />

        {/* Player 2 */}
        <div className="flex-1">
          <h2 className="text-sm font-semibold font-body text-[var(--color-text-muted)] uppercase tracking-widest mb-4">
            Player 2
          </h2>
          <div className="grid gap-3">
            {heroes.map((hero) => (
              <HeroPickerCard
                key={hero.id}
                hero={hero}
                selected={p2Hero?.id === hero.id}
                disabled={p1Hero?.id === hero.id}
                onSelect={() => setP2Hero(hero)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer: seed input + start button */}
      <div className="flex items-end gap-6">
        <SeedInput value={seed} onChange={setSeed} />
        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className={`
            px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
            transition-all duration-200
            ${canStart
              ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:brightness-110 cursor-pointer'
              : 'bg-[var(--color-surface-alt)] text-[var(--color-text-faint)] cursor-not-allowed'}
          `}
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
