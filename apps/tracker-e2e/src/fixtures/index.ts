import { test as base } from '@playwright/test';
import { BrowserPage } from '../pages/browser.page';
import { TranslationEditorDialog } from '../pages/translation-editor-dialog';
import { AppHeader } from '../pages/app-header';
import { SettingsPage } from '../pages/settings.page';
import { CollectionsPage } from '../pages/collections.page';
import { networkGuardFixture } from './network';
import { type Project, projectFixture } from './project';
import { type Server, serverFixture } from './server';

interface TestFixtures {
  project: Project;
  browserPage: BrowserPage;
  translationEditor: TranslationEditorDialog;
  settingsPage: SettingsPage;
  appHeader: AppHeader;
  collectionsPage: CollectionsPage;
  networkGuard: undefined;
}

interface WorkerFixtures {
  server: Server;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [serverFixture, { scope: 'worker', timeout: 45_000 }],
  baseURL: async ({ server }, use) => {
    await use(server.baseURL);
  },
  project: projectFixture,
  browserPage: async ({ page }, use) => {
    await use(new BrowserPage(page));
  },
  translationEditor: async ({ page }, use) => {
    await use(new TranslationEditorDialog(page));
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  appHeader: async ({ page }, use) => {
    await use(new AppHeader(page));
  },
  networkGuard: [networkGuardFixture, { auto: true }],
  collectionsPage: async ({ page }, use) => {
    await use(new CollectionsPage(page));
  },
});

export { expect } from '@playwright/test';
