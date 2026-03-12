import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ArtProvider } from '@aetherion-sim/ui';
import { initCardData } from '@/features/game-setup/deck-loader';
import { applyQaFixture, readQaFixtureId } from '@/testing/qa-fixtures';
import type { SimCard } from '@aetherion-sim/cards';
import './index.css';

const ART_BASE_URL = import.meta.env.VITE_ART_BASE_URL ?? '';

const root = document.getElementById('root')!;

function renderError(message: string, detail: string): void {
  createRoot(root).render(
    <StrictMode>
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <h1 className="text-2xl font-black text-[var(--color-error)]">{message}</h1>
          <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: detail }}
          />
        </div>
      </div>
    </StrictMode>,
  );
}

/**
 * Load card data before rendering the app.
 * cards.json is generated at build time by `pnpm generate:cards`.
 * The placeholder empty array triggers a user-friendly error screen.
 */
async function bootstrap(): Promise<void> {
  let cards: readonly SimCard[];

  try {
    const module = await import(
      /* @vite-ignore */ '@aetherion-sim/cards/data/cards.json'
    );
    cards = (module.default ?? module) as unknown as readonly SimCard[];
  } catch {
    renderError(
      'Card Data Not Found',
      'Run <code class="text-[var(--color-accent)] font-mono">pnpm generate:cards</code> first. ' +
      'This requires Docker with the <code class="font-mono">tcg-postgres</code> container running.',
    );
    return;
  }

  if (!Array.isArray(cards) || cards.length === 0) {
    renderError(
      'Card Data Empty',
      'The card database is empty. Run <code class="text-[var(--color-accent)] font-mono">pnpm generate:cards</code> ' +
      'to populate it from PostgreSQL.',
    );
    return;
  }

  initCardData(cards);
  const qaFixtureId = readQaFixtureId();
  if (qaFixtureId !== null) {
    applyQaFixture(qaFixtureId, cards);
  }

  createRoot(root).render(
    <StrictMode>
      <ArtProvider value={ART_BASE_URL}>
        <App />
      </ArtProvider>
    </StrictMode>,
  );
}

bootstrap();
