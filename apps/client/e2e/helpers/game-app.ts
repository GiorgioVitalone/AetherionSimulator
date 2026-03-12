import { expect, type Locator, type Page } from '@playwright/test';

export const HERO_NAMES = {
  onyx: 'Shadowlord Kaelthar',
  radiant: 'Shieldbearer Seraphina',
  sapphire: 'Arcanist Lyria',
  verdant: 'RIA-09',
} as const;

export const TEST_SEEDS = {
  verdantXCostOpening: 8,
  onyxHasteOpening: 35,
  verdantEquipmentOpening: 9,
  verdantSapphireResponse: 2,
} as const;

type ChoiceType = 'mulligan' | 'choose_first_player' | 'response_window';
type PhaseName = 'transform' | 'strategy' | 'action';
type QaFixtureId = 'transform-ready' | 'response-window' | 'aura-zone' | 'animation-preview' | 'game-over';
type QaFaultId = 'render-error-once';

export class GameApp {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.getByTestId('game-setup-screen')).toBeVisible();
  }

  async gotoQaFixture(fixtureId: QaFixtureId): Promise<void> {
    await this.page.addInitScript(({ id }) => {
      window.__AETHERION_QA_FIXTURE__ = id;
    }, { id: fixtureId });
    await this.page.goto(`/?qaFixture=${fixtureId}`);
    await expect(this.page.getByTestId('game-screen')).toBeVisible();
  }

  async gotoQaFault(faultId: QaFaultId): Promise<void> {
    await this.page.goto(`/?qaFault=${faultId}`);
  }

  async startGame(options: {
    readonly player1Hero: string;
    readonly player2Hero: string;
    readonly seed: number;
    readonly firstPlayerOptionId?: 'player_0' | 'player_1';
  }): Promise<void> {
    await this.goto();
    await this.page.getByTestId('seed-input').fill(String(options.seed));
    await this.pickHero(0, options.player1Hero);
    await this.pickHero(1, options.player2Hero);
    await this.page.getByTestId('start-game-button').click();

    await this.keepOpeningHand();
    await this.keepOpeningHand();
    await this.chooseFirstPlayer(options.firstPlayerOptionId ?? 'player_0');

    await expect(this.page.getByTestId('game-screen')).toBeVisible();
    await this.waitForPendingChoiceToClear();
    await this.waitForTurnHandoffToFinish();
    await this.waitForActionablePhase();
  }

  async ensurePhase(targetPhase: PhaseName): Promise<void> {
    let phase = await this.waitForActionablePhase();
    let guard = 0;

    while (phase !== targetPhase && guard < 5) {
      await this.page.getByTestId('end-phase-button').click();
      await this.waitForPendingChoiceToClear();
      await this.waitForTurnHandoffToFinish();
      phase = await this.waitForActionablePhase();
      guard++;
    }

    expect(phase).toBe(targetPhase);
  }

  async deployHandCard(card: Locator, options?: { readonly xValue?: number }): Promise<string> {
    const cardName = await card.getAttribute('data-card-name');
    if (cardName === null) {
      throw new Error('Expected selected hand card to expose a card name.');
    }

    await card.click();
    await this.clickDeployButtonIfNeeded();

    const xValueBar = this.page.locator('[data-testid="action-bar"][data-action-bar-state="awaiting-x-value"]');
    if (await xValueBar.isVisible().catch(() => false)) {
      if (options?.xValue !== undefined) {
        await this.setXValue(options.xValue);
      }
      await this.page.getByTestId('x-value-confirm').click();
    }

    await expect(this.page.locator('[data-testid="action-bar"][data-action-bar-state="awaiting-zone"]')).toBeVisible();
    await this.clickFirstHighlightedPlayerSlot();

    return cardName;
  }

  async clickPlayerBattlefieldCard(cardName: string): Promise<void> {
    await this.page
      .locator(`[data-battlefield-side="player"] [data-testid="battlefield-card"][data-card-name="${escapeAttribute(cardName)}"]`)
      .first()
      .click();
  }

  async clickHeroAbilityButton(abilityIndex = 0, playerIndex?: 0 | 1): Promise<void> {
    const index = playerIndex ?? Number(await this.page.getByTestId('game-screen').getAttribute('data-viewing-player')) as 0 | 1;
    await this.page
      .locator(`[data-testid="hero-panel"][data-player-index="${String(index)}"] [data-testid="hero-ability-button-${String(abilityIndex)}"]`)
      .first()
      .click();
  }

  async endCurrentTurn(): Promise<void> {
    let phase = await this.waitForActionablePhase();
    let guard = 0;

    while (phase !== 'action' && guard < 3) {
      await this.page.getByTestId('end-phase-button').click();
      await this.waitForPendingChoiceToClear();
      phase = await this.waitForActionablePhase();
      guard++;
    }

    if (phase !== 'action') {
      throw new Error(`Expected to reach action phase before ending the turn, received ${phase}.`);
    }

    await this.page.getByTestId('end-phase-button').click();
    await this.waitForPendingChoiceToClear();
    await this.waitForTurnHandoffToFinish();
    await this.waitForActionablePhase();
  }

  async waitForResponseWindow(): Promise<void> {
    const modal = await this.expectPendingChoice('response_window');
    await expect(modal).toBeVisible();
  }

  async expectCardInPlayerBattlefield(cardName: string): Promise<void> {
    await expect(
      this.page.locator(`[data-battlefield-side="player"] [data-testid="battlefield-card"][data-card-name="${escapeAttribute(cardName)}"]`).first(),
    ).toBeVisible();
  }

  async getCurrentPhase(): Promise<string> {
    const phase = await this.page.getByTestId('game-screen').getAttribute('data-phase');
    if (phase === null) {
      throw new Error('Game screen is missing the current phase attribute.');
    }
    return phase;
  }

  async waitForTurnHandoffToFinish(): Promise<void> {
    const overlay = this.page.getByTestId('turn-handoff-overlay');
    await expect(overlay).toBeHidden({ timeout: 3_000 });
  }

  async waitForPendingChoiceToClear(): Promise<void> {
    const modal = this.page.getByTestId('pending-choice-modal');
    if (await modal.isVisible().catch(() => false)) {
      const choiceType = await modal.getAttribute('data-choice-type');
      if (choiceType === 'reserve_exhaust') {
        await this.page.getByTestId('reserve-exhaust-confirm').click();
      }
    }
    await expect(modal).toBeHidden({ timeout: 3_000 });
  }

  handCards(): Locator {
    return this.page.getByTestId('hand-card');
  }

  private async waitForActionablePhase(): Promise<PhaseName> {
    await expect
      .poll(async () => this.getCurrentPhase(), {
        message: 'Expected the game to settle into an actionable phase.',
      })
      .toMatch(/^(transform|strategy|action)$/);

    return (await this.getCurrentPhase()) as PhaseName;
  }

  private async pickHero(playerIndex: 0 | 1, heroName: string): Promise<void> {
    await this.page
      .getByTestId(`hero-picker-player-${String(playerIndex)}`)
      .locator(`[data-hero-name="${escapeAttribute(heroName)}"]`)
      .click();
  }

  private async keepOpeningHand(): Promise<void> {
    if (await this.page.getByTestId('mulligan-handoff-ready').isVisible().catch(() => false)) {
      await this.page.getByTestId('mulligan-handoff-ready').click();
    }
    await this.expectPendingChoice('mulligan');
    await this.page.getByTestId('mulligan-keep-button').click();
  }

  private async chooseFirstPlayer(optionId: 'player_0' | 'player_1'): Promise<void> {
    await this.expectPendingChoice('choose_first_player');
    await this.page.getByTestId(`choice-option-${optionId}`).click();
    await this.page.getByTestId('pending-choice-confirm').click();
  }

  private async clickDeployButtonIfNeeded(): Promise<void> {
    const deployButton = this.page.getByTestId('action-bar-button-deploy');
    if (await deployButton.isVisible().catch(() => false)) {
      await deployButton.click();
    }
  }

  private async setXValue(targetValue: number): Promise<void> {
    const currentValue = this.page.getByTestId('x-value-current');
    let current = Number(await currentValue.textContent());

    while (current < targetValue) {
      await this.page.getByTestId('x-value-increment').click();
      current = Number(await currentValue.textContent());
    }

    while (current > targetValue) {
      await this.page.getByTestId('x-value-decrement').click();
      current = Number(await currentValue.textContent());
    }
  }

  private async clickFirstHighlightedPlayerSlot(): Promise<void> {
    const highlightedSlot = this.page
      .locator('[data-battlefield-side="player"][data-occupied="false"][data-highlighted="true"]')
      .first();

    await expect(highlightedSlot).toBeVisible();
    await highlightedSlot.click();
  }

  private async expectPendingChoice(type: ChoiceType): Promise<Locator> {
    const modal = this.page.getByTestId('pending-choice-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('data-choice-type', type);
    return modal;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
