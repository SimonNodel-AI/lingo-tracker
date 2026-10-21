import type { Page } from '@playwright/test';

export class AppHeader {
  constructor(readonly page: Page) {}

  // These controls have translated names, so test IDs also work after switching language.
  readonly localePicker = this.page.getByTestId('locale-picker');

  async selectLocale(locale: string): Promise<void> {
    await this.localePicker.click();
    await this.page.getByTestId(`locale-option-${locale}`).click();
  }
}
