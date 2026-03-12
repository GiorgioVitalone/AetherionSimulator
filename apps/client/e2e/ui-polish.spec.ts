import { expect, test } from '@playwright/test';
import { GameApp, HERO_NAMES, TEST_SEEDS } from './helpers/game-app';

test('open game log does not overlap any hand cards on desktop', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.radiant,
    seed: TEST_SEEDS.verdantXCostOpening,
  });

  await expect(page.getByTestId('hand-card').first()).toBeVisible();
  await page.getByTestId('game-log-toggle').click();
  await expect(page.getByTestId('game-log-panel')).toBeVisible();

  await expect
    .poll(async () => page.evaluate(() => {
      const log = document.querySelector('[data-testid="game-log"]');
      const handCards = Array.from(document.querySelectorAll('[data-testid="hand-card"]'));

      if (log === null || handCards.length === 0) {
        return { ready: false, overlappingCards: [] };
      }

      const logRect = log.getBoundingClientRect();
      const overlappingCards = handCards
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          const horizontalOverlap = rect.left < logRect.right && rect.right > logRect.left;
          const verticalOverlap = rect.top < logRect.bottom && rect.bottom > logRect.top;
          return horizontalOverlap && verticalOverlap;
        })
        .map(card => card.getAttribute('data-card-name') ?? 'unknown');

      return {
        ready: true,
        overlappingCards,
      };
    }))
    .toEqual({
      ready: true,
      overlappingCards: [],
    });
});
