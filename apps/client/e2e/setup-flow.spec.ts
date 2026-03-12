import { expect, test } from '@playwright/test';
import { GameApp, HERO_NAMES, TEST_SEEDS } from './helpers/game-app';

test('loads setup and starts a game through mulligan and first-player choice', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.radiant,
    seed: TEST_SEEDS.verdantXCostOpening,
  });

  await expect(page.getByTestId('game-screen')).toBeVisible();
  await expect(page.getByTestId('phase-indicator')).toBeVisible();
  await expect(page.getByTestId('hand-row')).toBeVisible();
});
