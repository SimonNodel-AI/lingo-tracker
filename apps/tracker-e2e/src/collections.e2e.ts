import { join } from 'node:path';
import { expect, test } from './fixtures';
import { readConfig, readEntries } from './fixtures/disk';

test('creates a collection in the dialog and persists its translations folder', async ({
  project,
  server,
  collectionsPage,
}) => {
  const name = `${project.collectionName}-ui`;
  const folder = join(project.translationsFolder, 'ui');
  await collectionsPage.goto();
  await collectionsPage.create(name, folder);
  await expect(collectionsPage.createDialog).toBeHidden();
  await expect(collectionsPage.collection(name)).toBeVisible();
  await expect
    .poll(async () => (await readConfig(server.projectRoot)).collections[name]?.translationsFolder)
    .toBe(folder);
});

test('adds a collection locale in the dialog and persists it', async ({ project, server, collectionsPage }) => {
  const name = await project.addCollection();
  await project.addResource({
    key: 'greeting',
    baseValue: 'Hello',
    translations: [{ locale: 'fr-ca', value: 'Bonjour' }],
  });
  await collectionsPage.goto();
  await collectionsPage.addLocale(name, 'de');
  await expect(collectionsPage.editDialog).toBeHidden();
  await expect(collectionsPage.card(name).getByRole('list', { name: 'Locales', exact: true })).toContainText('de');
  await expect.poll(async () => (await readConfig(server.projectRoot)).collections[name]?.locales).toContain('de');
  expect(await readEntries(project.translationsFolder)).toHaveProperty('greeting');
});

test('deletes a collection after confirmation and removes it from config', async ({
  project,
  server,
  collectionsPage,
}) => {
  const name = await project.addCollection();
  await collectionsPage.goto();
  await expect(collectionsPage.collection(name)).toBeVisible();
  await collectionsPage.delete(name);
  await expect(collectionsPage.deleteDialog).toBeHidden();
  await expect(collectionsPage.collection(name)).toBeHidden();
  await expect.poll(async () => (await readConfig(server.projectRoot)).collections).not.toHaveProperty(name);
});

test('read-only collections disable Import but keep collection Edit and Delete available', async ({
  project,
  server,
  page,
  collectionsPage,
}) => {
  const name = await project.addCollection({ readOnly: true });
  const writableName = `${project.collectionName}-writable`;
  await collectionsPage.goto();
  await collectionsPage.create(writableName, join(project.translationsFolder, 'writable'));
  await expect(collectionsPage.createDialog).toBeHidden();
  await collectionsPage.openActions(writableName);
  await expect(collectionsPage.importAction).toBeEnabled();
  await expect(collectionsPage.editAction).toBeEnabled();
  await expect(collectionsPage.deleteAction).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(collectionsPage.card(name)).toContainText(
    "This collection is read-only. Its resources can't be modified.",
  );
  await collectionsPage.openActions(name);
  await expect(collectionsPage.importAction).toBeDisabled();
  await expect(collectionsPage.editAction).toBeEnabled();
  await expect(collectionsPage.deleteAction).toBeEnabled();
  const config = await readConfig(server.projectRoot);
  expect(config.collections[name]?.readOnly).toBe(true);
  expect(config.collections[writableName]?.translationsFolder).toBe(join(project.translationsFolder, 'writable'));
});
