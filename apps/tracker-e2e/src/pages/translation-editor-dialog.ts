import type { Page } from '@playwright/test';

export class TranslationEditorDialog {
  constructor(readonly page: Page) {}

  // Material's container and the template both expose dialog roles; select the inner form dialog.
  readonly dialog = this.page
    .getByRole('dialog', { name: /^(New translation|Edit translation)$/ })
    .filter({ hasNot: this.page.getByRole('dialog') });
  readonly key = this.dialog.getByRole('textbox', { name: /^Key / });
  readonly baseValue = this.dialog.getByRole('textbox', { name: 'English en Base', exact: true });
  readonly comment = this.dialog.getByRole('textbox', { name: /^Comment / });
  readonly localesDrawer = this.dialog.getByRole('group', { name: 'Other locales', exact: true });

  async create(key: string, baseValue: string, comment: string): Promise<void> {
    await this.key.fill(key);
    await this.baseValue.fill(baseValue);
    await this.comment.fill(comment);
    await this.dialog.getByRole('button', { name: 'Create translation', exact: true }).click();
  }

  async save(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  }

  async verifyTranslation(localeName: string, value: string): Promise<void> {
    await this.dialog.getByRole('button', { name: /^Other locales / }).click();
    await this.localesDrawer.getByRole('textbox', { name: `${localeName} Translation`, exact: true }).fill(value);
    await this.localesDrawer.getByRole('button', { name: 'Status', exact: true }).click();
    await this.page.getByRole('menuitem', { name: 'Verified', exact: true }).click();
    await this.localesDrawer.getByRole('button', { name: 'Done', exact: true }).click();
    await this.save();
  }
}
