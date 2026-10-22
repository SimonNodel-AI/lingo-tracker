import { join } from 'node:path';
import { expect, test } from './fixtures';
import { readConfig, readOutput } from './fixtures/disk';

test('creates a bundle in the dialog and persists its definition in config', async ({
  project,
  server,
  collectionsPage,
  bundlesPage,
  bundleFormDialog,
}) => {
  await project.addCollection();
  const output = join(project.artifactsFolder, 'bundle');
  await collectionsPage.goto();
  await bundlesPage.openCreate();
  await bundleFormDialog.create(project.collectionName, output);
  await expect(bundleFormDialog.dialog).toBeHidden();
  await expect(bundlesPage.bundle(project.collectionName)).toBeVisible();
  await expect
    .poll(async () => (await readConfig(server.projectRoot)).bundles?.[project.collectionName])
    .toEqual({
      dist: output,
      bundleName: '{locale}',
      collections: [{ name: project.collectionName, entriesSelectionRules: 'All' }],
    });
});

test('deletes a seeded bundle after confirmation and removes its definition from config', async ({
  project,
  server,
  collectionsPage,
  bundlesPage,
}) => {
  await project.addCollection();
  await project.addBundle({
    name: project.collectionName,
    bundle: {
      dist: join(project.artifactsFolder, 'bundle'),
      bundleName: '{locale}',
      collections: [{ name: project.collectionName, entriesSelectionRules: 'All' }],
    },
  });
  await collectionsPage.goto();
  await expect(bundlesPage.bundle(project.collectionName)).toBeVisible();
  await bundlesPage.delete(project.collectionName);
  await expect(bundlesPage.deleteDialog).toBeHidden();
  await expect(bundlesPage.bundle(project.collectionName)).toBeHidden();
  await expect
    .poll(async () => (await readConfig(server.projectRoot)).bundles ?? {})
    .not.toHaveProperty(project.collectionName);
});

test('generates a bundle through its card and writes per-locale resources on disk', async ({
  project,
  collectionsPage,
  bundlesPage,
}) => {
  await project.addCollection();
  await project.addResource({
    key: 'common.greeting',
    baseValue: 'Hello',
    translations: [{ locale: 'fr-ca', value: 'Bonjour', status: 'translated' }],
  });
  const output = join(project.artifactsFolder, 'bundle');
  await project.addBundle({
    name: project.collectionName,
    bundle: {
      dist: output,
      bundleName: '{locale}',
      collections: [{ name: project.collectionName, entriesSelectionRules: 'All' }],
    },
  });
  await collectionsPage.goto();
  await bundlesPage.generate(project.collectionName);
  await expect(bundlesPage.runStatus(project.collectionName)).toContainText('Generated');
  await expect.poll(() => readOutput(join(output, 'en.json'))).toEqual({ common: { greeting: 'Hello' } });
  await expect.poll(() => readOutput(join(output, 'fr-ca.json'))).toEqual({ common: { greeting: 'Bonjour' } });
});

test('edits a seeded bundle in the dialog and persists its updated definition in config', async ({
  project,
  server,
  collectionsPage,
  bundlesPage,
  bundleFormDialog,
}) => {
  await project.addCollection();
  await project.addBundle({
    name: project.collectionName,
    bundle: {
      dist: join(project.artifactsFolder, 'bundle'),
      bundleName: '{locale}',
      collections: [{ name: project.collectionName, entriesSelectionRules: 'All' }],
    },
  });
  await collectionsPage.goto();
  await bundlesPage.edit(project.collectionName);
  const output = join(project.artifactsFolder, 'edited-bundle');
  await bundleFormDialog.edit(output, 'app.{locale}');
  await expect(bundleFormDialog.dialog).toBeHidden();
  await expect(bundlesPage.bundle(project.collectionName)).toBeVisible();
  await expect
    .poll(async () => (await readConfig(server.projectRoot)).bundles?.[project.collectionName])
    .toEqual({
      dist: output,
      bundleName: 'app.{locale}',
      collections: [{ name: project.collectionName, entriesSelectionRules: 'All' }],
    });
});
