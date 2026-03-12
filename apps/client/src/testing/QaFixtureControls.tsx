import type { ReactNode } from 'react';
import { useUiStore } from '@/stores/ui-store';
import { readQaFixtureId } from './qa-fixtures';

export function QaFixtureControls(): ReactNode {
  const fixtureId = readQaFixtureId();
  const enqueueAnimation = useUiStore((s) => s.enqueueAnimation);

  if (fixtureId !== 'animation-preview') {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="qa-trigger-hero-damage-animation"
      className="fixed top-4 right-4 px-3 py-1.5 rounded-[var(--radius-md)] text-[10px] uppercase tracking-[0.2em] font-semibold"
      style={{
        zIndex: 'var(--z-dropdown)',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
      }}
      onClick={() => enqueueAnimation({
        id: `qa_damage_${Date.now()}`,
        type: 'damage',
        targetId: 'hero-0',
        value: 3,
      })}
    >
      Trigger QA Damage
    </button>
  );
}
