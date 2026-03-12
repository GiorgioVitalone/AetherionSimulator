import { useGameStore } from '@/stores/game-store';
import { GameSetupScreen } from '@/features/game-setup/GameSetupScreen';
import { GameScreen } from '@/features/game-layout/GameScreen';
import { ErrorBoundary } from '@/features/shared/ErrorBoundary';
import { QaFaultTrigger } from '@/testing/qa-faults';

export function App() {
  const isStarted = useGameStore((s) => s.isStarted);
  const reset = useGameStore((s) => s._reset);

  return (
    <ErrorBoundary onReset={reset}>
      <QaFaultTrigger />
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        {isStarted ? <GameScreen /> : <GameSetupScreen />}
      </div>
    </ErrorBoundary>
  );
}
