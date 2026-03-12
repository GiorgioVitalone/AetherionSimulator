import { expect, test } from '@playwright/test';
import { GameApp, HERO_NAMES, TEST_SEEDS } from './helpers/game-app';

test('turn-one x-cost deployment requires a positive X and the deployed unit persists on board', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.radiant,
    seed: TEST_SEEDS.verdantXCostOpening,
  });

  await app.ensurePhase('strategy');

  const xCostCard = page
    .locator('[data-testid="hand-card"][data-card-type="C"][data-playable="true"][data-x-cost="true"]')
    .first();

  await expect(xCostCard).toBeVisible();
  const xCostCardName = await xCostCard.getAttribute('data-card-name');
  expect(xCostCardName).not.toBeNull();
  await xCostCard.click();
  await page.getByTestId('action-bar-button-deploy').click();
  await expect(page.locator('[data-testid="action-bar"][data-action-bar-state="awaiting-x-value"]')).toBeVisible();
  await expect(page.getByTestId('x-value-current')).toHaveText('1');

  await page.getByTestId('x-value-confirm').click();
  const highlightedSlot = page
    .locator('[data-battlefield-side="player"][data-occupied="false"][data-highlighted="true"]')
    .first();
  await highlightedSlot.click();

  await expect(
    page.locator(
      `[data-battlefield-side="player"] [data-testid="battlefield-card"][data-card-name="${xCostCardName}"]`,
    ).first(),
  ).toBeVisible();
});

test('freshly deployed non-Haste characters cannot move on the turn they enter play', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.radiant,
    seed: TEST_SEEDS.verdantXCostOpening,
  });

  await app.ensurePhase('strategy');

  const deployedCardName = await app.deployHandCard(
    page.locator('[data-testid="hand-card"][data-card-type="C"][data-playable="true"][data-x-cost="true"]').first(),
    { xValue: 1 },
  );

  await app.expectCardInPlayerBattlefield(deployedCardName);
  await app.clickPlayerBattlefieldCard(deployedCardName);

  await expect(page.getByTestId('action-bar-button-move')).toHaveCount(0);
  await expect(
    page.locator(`[data-battlefield-side="player"] [data-testid="battlefield-card"][data-card-name="${deployedCardName}"]`).first(),
  ).toHaveAttribute('data-summoning-sick', 'true');
});

test('first player cannot attack on turn one even with a Haste unit', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.onyx,
    player2Hero: HERO_NAMES.sapphire,
    seed: TEST_SEEDS.onyxHasteOpening,
  });

  await app.ensurePhase('strategy');

  const hasteCard = page
    .locator('[data-testid="hand-card"][data-card-type="C"][data-playable="true"][data-has-haste="true"]')
    .first();

  await expect(hasteCard).toBeVisible();
  const hasteCardName = await app.deployHandCard(hasteCard);

  await app.clickPlayerBattlefieldCard(hasteCardName);
  await expect(page.locator('[data-testid="action-bar"][data-action-bar-state="awaiting-zone"]')).toBeVisible();
  await page.getByTestId('action-bar-cancel').click();

  await app.ensurePhase('action');
  await app.clickPlayerBattlefieldCard(hasteCardName);
  await expect(page.locator('[data-testid="action-bar"]')).toHaveCount(0);
  await expect(page.getByTestId('target-overlay')).toHaveCount(0);
});

test('a Haste unit can move immediately through the board UI in strategy', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.onyx,
    player2Hero: HERO_NAMES.sapphire,
    seed: TEST_SEEDS.onyxHasteOpening,
  });

  await app.ensurePhase('strategy');

  const hasteCard = page
    .locator('[data-testid="hand-card"][data-card-type="C"][data-playable="true"][data-has-haste="true"]')
    .first();

  await expect(hasteCard).toBeVisible();
  const hasteCardName = await app.deployHandCard(hasteCard);

  await app.clickPlayerBattlefieldCard(hasteCardName);
  await expect(page.locator('[data-testid="action-bar"][data-action-bar-state="awaiting-zone"]')).toBeVisible();

  const moveDestination = page
    .locator('[data-battlefield-side="player"][data-occupied="false"][data-highlighted="true"]')
    .first();
  const destinationTestId = await moveDestination.getAttribute('data-testid');
  expect(destinationTestId).not.toBeNull();

  await moveDestination.click();
  await expect(
    page.getByTestId(destinationTestId!).locator(`[data-testid="battlefield-card"][data-card-name="${hasteCardName}"]`),
  ).toBeVisible();
});

test('ending the turn hands the UI over to the opponent', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.radiant,
    seed: TEST_SEEDS.verdantXCostOpening,
  });

  await app.ensurePhase('strategy');
  await page.getByTestId('end-phase-button').click();
  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-phase', 'action');

  await page.getByTestId('end-phase-button').click();
  await app.waitForTurnHandoffToFinish();

  await expect(page.getByTestId('game-screen')).toHaveAttribute('data-viewing-player', '1');
});

test('equipment can be attached and removed through the board UI', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.radiant,
    seed: TEST_SEEDS.verdantEquipmentOpening,
    firstPlayerOptionId: 'player_0',
  });

  await app.ensurePhase('strategy');
  const deployedCardName = await app.deployHandCard(
    page.locator('[data-testid="hand-card"][data-card-type="C"][data-playable="true"]').first(),
  );
  await app.expectCardInPlayerBattlefield(deployedCardName);

  await app.endCurrentTurn();
  await app.endCurrentTurn();
  await app.ensurePhase('strategy');

  const equipmentCard = page
    .locator('[data-testid="hand-card"][data-card-type="E"][data-playable="true"]')
    .first();

  await expect(equipmentCard).toBeVisible();
  await equipmentCard.click();
  await page.getByTestId('action-bar-button-attach_equipment').click();
  await expect(page.getByTestId('target-overlay')).toHaveAttribute('data-action-type', 'attach_equipment');
  await app.clickPlayerBattlefieldCard(deployedCardName);

  await app.clickPlayerBattlefieldCard(deployedCardName);
  await expect(page.getByTestId('action-bar-button-remove_equipment')).toBeVisible();
  await page.getByTestId('action-bar-button-remove_equipment').click();

  await app.clickPlayerBattlefieldCard(deployedCardName);
  await expect(page.getByTestId('action-bar-button-remove_equipment')).toHaveCount(0);
});

test('a live response window opens when the defending player has a response spell in hand', async ({ page }) => {
  const app = new GameApp(page);

  await app.startGame({
    player1Hero: HERO_NAMES.verdant,
    player2Hero: HERO_NAMES.sapphire,
    seed: TEST_SEEDS.verdantSapphireResponse,
    firstPlayerOptionId: 'player_1',
  });

  await app.ensurePhase('strategy');
  await app.endCurrentTurn();
  await app.endCurrentTurn();
  await app.endCurrentTurn();
  await app.ensurePhase('strategy');

  const playableSpell = page
    .locator('[data-testid="hand-card"][data-card-type="S"][data-playable="true"]')
    .first();

  await expect(playableSpell).toBeVisible();
  await playableSpell.click();
  await page.getByTestId('action-bar-button-cast_spell').click();
  await app.waitForResponseWindow();
  await expect(page.getByTestId('response-pass-button')).toBeVisible();
  await page.getByTestId('response-pass-button').click();
  await app.waitForPendingChoiceToClear();
});
