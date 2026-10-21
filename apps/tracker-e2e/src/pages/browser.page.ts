import type { Page } from '@playwright/test';

export class BrowserPage {
  constructor(readonly page: Page) {}

  readonly folderTree = this.page.getByRole('tree');
  readonly search = this.page.getByRole('textbox', { name: 'Search translations', exact: true });
  readonly clearSearch = this.page
    .getByRole('button', { name: 'Clear Search', exact: true })
    .filter({ hasText: 'Clear Search' });
  readonly rows = this.page.getByTestId(/^resource-row-/);
  readonly addButton = this.page.getByRole('button', { name: 'Add Translation', exact: true });
  readonly deleteDialog = this.page.getByRole('dialog', { name: 'Delete Resource', exact: true });

  async goto(collection: string): Promise<void> {
    await this.page.goto(`/browser/${encodeURIComponent(collection)}`);
  }

  folder(name: string) {
    return this.folderTree.getByRole('treeitem', { name: `Folder ${name}`, exact: true });
  }

  row(key: string) {
    return this.page.getByTestId(`resource-row-${key}`);
  }

  statusFilter(status: string) {
    return this.page.getByRole('group', { name: 'Filter by status', exact: true }).getByRole('button', {
      name: new RegExp(`^${status} \\d+$`),
    });
  }

  async selectLocale(locale: string): Promise<void> {
    await this.page.getByTestId('locale-filter-trigger').click();
    await this.page.getByRole('menuitemradio', { name: `${locale} (not selected)`, exact: true }).press('Enter');
  }

  async edit(key: string): Promise<void> {
    await this.row(key).getByRole('button', { name: 'Edit translation', exact: true }).click();
  }

  async delete(key: string): Promise<void> {
    await this.row(key).getByRole('button', { name: 'More actions', exact: true }).click();
    await this.page.getByRole('menuitem', { name: 'Delete translation', exact: true }).click();
    await this.deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  }
}
