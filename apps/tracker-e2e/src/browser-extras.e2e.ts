import { expect, test } from './fixtures';
import { readEntries, readMeta } from './fixtures/disk';

test('adds a resource comment and restores it in the editor after reload', async ({
  project,
  browserPage,
  translationEditor,
  page,
}) => {
  await project.addCollection();
  await project.addResource({ key: 'greeting', baseValue: 'Hello' });
  await browserPage.goto(project.collectionName);
  await browserPage.edit('greeting');
  await translationEditor.comment.fill('Welcome message on the home page');
  await translationEditor.save();
  await expect(translationEditor.dialog).toBeHidden();
  expect(await readEntries(project.translationsFolder)).toMatchObject({
    greeting: { source: 'Hello', comment: 'Welcome message on the home page' },
  });
  await page.reload();
  await browserPage.edit('greeting');
  await expect(translationEditor.comment).toHaveValue('Welcome message on the home page');
});

test('adds a resource tag in the editor and persists it on disk', async ({
  project,
  browserPage,
  translationEditor,
  page,
}) => {
  await project.addCollection();
  await project.addResource({ key: 'greeting', baseValue: 'Hello', comment: 'Home page greeting' });
  await browserPage.goto(project.collectionName);
  await browserPage.edit('greeting');
  await translationEditor.addTag('home-ui');
  await translationEditor.save();
  await expect(translationEditor.dialog).toBeHidden();
  expect(await readEntries(project.translationsFolder)).toMatchObject({
    greeting: { source: 'Hello', tags: ['home-ui'] },
  });
  await page.reload();
  await browserPage.edit('greeting');
  await expect(translationEditor.tag('home-ui')).toBeVisible();
});

test('blocks a duplicate key with a visible error and leaves resource files unchanged', async ({
  project,
  browserPage,
  translationEditor,
}) => {
  await project.addCollection();
  await project.addResource({ key: 'greeting', baseValue: 'Hello' });
  const entries = await readEntries(project.translationsFolder);
  const meta = await readMeta(project.translationsFolder);
  await browserPage.goto(project.collectionName);
  await expect(browserPage.row('greeting')).toBeVisible();
  await browserPage.addButton.click();
  await translationEditor.key.fill('greeting');
  await translationEditor.baseValue.fill('Replacement');
  await translationEditor.comment.fill('Must not be stored');
  await expect(translationEditor.collisionError).toContainText('greeting already exists in this folder.');
  await translationEditor.createButton.click();
  await expect(translationEditor.conflictDialog).toBeVisible();
  await expect(translationEditor.conflictDialog).toContainText('The translation key "greeting" already exists');
  await translationEditor.chooseDifferentKey();
  await expect(translationEditor.conflictDialog).toBeHidden();
  await expect(translationEditor.collisionError).toContainText('greeting already exists in this folder.');
  expect(await readEntries(project.translationsFolder)).toEqual(entries);
  expect(await readMeta(project.translationsFolder)).toEqual(meta);
  await expect(translationEditor.dialog).toBeVisible();
});

test('rejects a base value with a braced placeholder and leaves resource files unchanged', async ({
  project,
  browserPage,
  translationEditor,
}) => {
  await project.addCollection();
  await project.addResource({ key: 'greeting', baseValue: 'Hello', comment: 'Home page greeting' });
  const entries = await readEntries(project.translationsFolder);
  const meta = await readMeta(project.translationsFolder);
  await browserPage.goto(project.collectionName);
  await browserPage.edit('greeting');
  const fixErrors = translationEditor.dialog
    .getByRole('alert')
    .filter({ hasText: 'Fix the highlighted fields before saving' });
  await translationEditor.baseValue.fill('Hello {{{name}}}');
  await expect(fixErrors).toBeHidden();
  await translationEditor.save();
  await expect(fixErrors).toBeVisible();
  await expect(
    translationEditor.dialog.getByRole('alert').filter({
      hasText: 'is inside literal braces and would lose a brace on save.',
    }),
  ).toBeVisible();
  await expect(translationEditor.baseValue).toHaveAttribute('aria-invalid', 'true');
  await expect(translationEditor.dialog).toBeVisible();
  expect(await readEntries(project.translationsFolder)).toEqual(entries);
  expect(await readMeta(project.translationsFolder)).toEqual(meta);
});
