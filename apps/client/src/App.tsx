import { useGameStore } from '@/stores/game-store';
import { GameSetupScreen } from '@/features/game-setup/GameSetupScreen';
import { GameScreen } from '@/features/game-layout/GameScreen';
import { ErrorBoundary } from '@/features/shared/ErrorBoundary';

export function App() {
  const isStarted = useGameStore((s) => s.isStarted);
  const reset = useGameStore((s) => s._reset);

  return (
    <ErrorBoundary onReset={reset}>
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        {isStarted ? <GameScreen /> : <GameSetupScreen />}
      </div>
    </ErrorBoundary>
  );
}
