import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { readEntries, readMeta, readOutput } from './fixtures/disk';

test('exports a collection through the dialog and writes its seeded resources to JSON', async ({
  project,
  collectionsPage,
  exportDialog,
  page,
}) => {
  await project.addCollection();
  await project.addResource({
    key: 'common.greeting',
    baseValue: 'Hello',
    translations: [{ locale: 'fr-ca', value: 'Bonjour', status: 'new' }],
  });
  await project.addResource({
    key: 'common.farewell',
    baseValue: 'Goodbye',
    translations: [{ locale: 'fr-ca', value: 'Au revoir', status: 'new' }],
  });
  const output = join(project.artifactsFolder, 'export');
  await collectionsPage.goto();
  await collectionsPage.openExport(project.collectionName);
  await exportDialog.exportJson(output);
  await expect(exportDialog.dialog).toBeHidden();
  await expect(page.getByTestId('export-strip')).toContainText('Exported');
  await expect
    .poll(() => readOutput(join(output, 'fr-ca.json')))
    .toEqual({
      common: { greeting: 'Bonjour', farewell: 'Au revoir' },
    });
  expect(await readdir(output)).toEqual(['fr-ca.json']);
});

test('uploads and imports translations through the dialog and persists values and statuses', async ({
  project,
  collectionsPage,
  importDialog,
  page,
}, testInfo) => {
  const folder = join(project.artifactsFolder, 'import');
  await project.addCollection({ importFolder: folder });
  await project.addResource({ key: 'common.greeting', baseValue: 'Hello' });
  const input = testInfo.outputPath('fr-ca.json');
  try {
    await writeFile(input, JSON.stringify({ 'common.greeting': { value: 'Bonjour', baseValue: 'Hello' } }));
    await collectionsPage.goto();
    await collectionsPage.openImport(project.collectionName);
    await expect(importDialog.uploadButton).toBeEnabled();
    await importDialog.upload(input);
    await expect(importDialog.dialog.getByTestId('file-row-fr-ca.json').getByRole('checkbox')).toBeChecked();
    await importDialog.submitButton.click();
    await expect(importDialog.dialog).toBeHidden();
    await expect(page.getByTestId('import-strip')).toContainText('Imported');
    const resourceFolder = join(project.translationsFolder, 'common');
    expect(await readEntries(resourceFolder)).toMatchObject({ greeting: { source: 'Hello', 'fr-ca': 'Bonjour' } });
    expect(await readMeta(resourceFolder)).toMatchObject({ greeting: { 'fr-ca': { status: 'translated' } } });
  } finally {
    await rm(input, { force: true });
  }
});
