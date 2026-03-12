import { expect, test } from '@playwright/test';
import { GameApp } from './helpers/game-app';

test('aura-zone fixture keeps aura cards visible and inspectable through card detail hover', async ({ page }) => {
  const app = new GameApp(page);

  await app.gotoQaFixture('aura-zone');

  const auraZone = page.locator('[data-testid="aura-zone"][data-player-index="0"]');
  const auraCard = auraZone.locator('[data-testid="aura-card"]').first();
  await expect(auraZone).toBeVisible();
  await expect(auraZone.locator('[data-testid="aura-card"]')).toHaveCount(1);
  await expect(auraCard).toHaveAttribute('data-card-name', /.+/);

  const auraCardName = await auraCard.getAttribute('data-card-name');
  await auraCard.hover();

  await expect(page.getByTestId('card-detail-modal')).toBeVisible();
  await expect(page.getByTestId('card-detail-modal')).toContainText(auraCardName ?? '');
});
