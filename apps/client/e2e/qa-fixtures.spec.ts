import { expect, test } from '@playwright/test';
import { GameApp } from './helpers/game-app';

test('transform-ready QA fixture exposes the transform phase and affordance', async ({ page }) => {
  const app = new GameApp(page);

  await app.gotoQaFixture('transform-ready');

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'transform');
  await expect(page.getByTestId('transform-button')).toBeVisible();
});

test('response-window QA fixture exposes the modal shell for sign-off', async ({ page }) => {
  const app = new GameApp(page);

  await app.gotoQaFixture('response-window');

  await expect(page.getByTestId('pending-choice-modal')).toHaveAttribute('data-choice-type', 'response_window');
  await expect(page.getByTestId('response-pass-button')).toBeVisible();
});

test('aura-zone QA fixture exposes persistent aura cards near the hero panel', async ({ page }) => {
  const app = new GameApp(page);

  await app.gotoQaFixture('aura-zone');

  const auraZone = page.locator('[data-testid="aura-zone"][data-player-index="0"]');
  await expect(auraZone).toBeVisible();
  await expect(auraZone.locator('[data-testid="aura-card"]')).toHaveCount(1);
  await expect(auraZone.locator('[data-testid="aura-card"]').first()).toHaveAttribute('data-card-name', /.+/);
});

test('game-over QA fixture exposes the winner overlay and reset path', async ({ page }) => {
  const app = new GameApp(page);

  await app.gotoQaFixture('game-over');

  await expect(page.getByTestId('game-over-overlay')).toBeVisible();
  await expect(page.getByTestId('game-over-title')).toHaveText('VICTORY');
  await page.getByTestId('game-over-play-again').click();
  await expect(page.getByTestId('game-setup-screen')).toBeVisible();
});
