import { expect, test } from '@playwright/test';
import { GameApp } from './helpers/game-app';

test('render fault shows the error boundary and recovery returns to setup', async ({ page }) => {
  const app = new GameApp(page);

  await app.gotoQaFault('render-error-once');
  await page.getByTestId('qa-trigger-render-fault').click();

  await expect(page.getByTestId('error-boundary-screen')).toBeVisible();
  await expect(page.getByTestId('error-boundary-message')).toContainText('QA fault: simulated render failure');

  await page.getByTestId('error-boundary-reset').click();
  await expect(page.getByTestId('game-setup-screen')).toBeVisible();
});

test('animation-preview fixture shows damage motion and settles cleanly', async ({ page }) => {
  const app = new GameApp(page);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.gotoQaFixture('animation-preview');

  await page.getByTestId('qa-trigger-hero-damage-animation').click();

  const popup = page.locator('[data-testid="damage-popup"][data-animation-type="damage"][data-popup-value="3"]');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveText('-3');
  await expect(popup).toBeHidden({ timeout: 2_000 });
  await expect(page.getByTestId('hero-panel').first()).toBeVisible();
});
