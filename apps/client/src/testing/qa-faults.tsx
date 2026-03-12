import type { ReactNode } from 'react';

export type QaFaultId = 'render-error-once';

export const QA_ERROR_BOUNDARY_EVENT = 'aetherion:qa-error-boundary';

const consumedFaults = new Set<QaFaultId>();

export function readQaFaultId(): QaFaultId | null {
  const faultId = new URLSearchParams(window.location.search).get('qaFault');
  return faultId === 'render-error-once' ? faultId : null;
}

function consumeQaFault(faultId: QaFaultId): boolean {
  if (consumedFaults.has(faultId)) {
    return false;
  }

  consumedFaults.add(faultId);
  return true;
}

export function QaFaultTrigger(): ReactNode {
  const faultId = readQaFaultId();

  if (faultId !== 'render-error-once' || consumedFaults.has(faultId)) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid="qa-trigger-render-fault"
      className="fixed top-4 left-4 px-3 py-1.5 rounded-[var(--radius-md)] text-[10px] uppercase tracking-[0.2em] font-semibold"
      style={{
        zIndex: 'var(--z-dropdown)',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
      }}
      onClick={() => {
        if (!consumeQaFault(faultId)) {
          return;
        }

        window.dispatchEvent(new CustomEvent(QA_ERROR_BOUNDARY_EVENT, {
          detail: { message: 'QA fault: simulated render failure' },
        }));
      }}
    >
      Trigger QA Fault
    </button>
  );
}
