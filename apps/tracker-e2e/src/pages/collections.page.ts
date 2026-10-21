import type { Page } from '@playwright/test';

export class CollectionsPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  collection(name: string) {
    return this.page.getByRole('heading', { name, level: 3, exact: true });
  }
}
