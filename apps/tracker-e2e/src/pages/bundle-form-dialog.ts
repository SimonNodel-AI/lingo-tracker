import type { Page } from '@playwright/test';

export class BundleFormDialog {
  constructor(readonly page: Page) {}

  readonly dialog = this.page
    .getByRole('dialog', { name: /^(New bundle|Edit bundle)$/ })
    .filter({ hasNot: this.page.getByRole('dialog') });

  async edit(outputFolder: string, pattern: string): Promise<void> {
    await this.dialog.getByTestId('rail-output').click();
    await this.dialog.getByRole('textbox', { name: 'Output folder', exact: true }).fill(outputFolder);
    await this.dialog.getByRole('textbox', { name: 'File name pattern', exact: true }).fill(pattern);
    await this.dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  }

  async create(name: string, outputFolder: string): Promise<void> {
    await this.dialog.getByTestId('rail-output').click();
    await this.dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await this.dialog.getByRole('textbox', { name: 'Output folder', exact: true }).fill(outputFolder);
    await this.dialog.getByRole('textbox', { name: 'File name pattern', exact: true }).fill('{locale}');
    await this.dialog.getByRole('button', { name: 'Create bundle', exact: true }).click();
  }
}
