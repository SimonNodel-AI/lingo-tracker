import type { Page } from '@playwright/test';

export class ImportDialog {
  constructor(readonly page: Page) {}

  readonly dialog = this.page
    .getByRole('dialog', { name: 'Import translations', exact: true })
    .filter({ hasNot: this.page.getByRole('dialog') });
  readonly uploadButton = this.dialog.getByRole('button', { name: 'Upload files…', exact: true });
  readonly submitButton = this.dialog.getByTestId('submit');

  async upload(path: string): Promise<void> {
    await this.dialog.getByTestId('upload-input').setInputFiles(path);
  }
}
