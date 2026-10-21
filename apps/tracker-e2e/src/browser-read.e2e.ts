import { expect, test } from './fixtures';

test('navigates nested folders and shows only resources in the selected folder', async ({ project, browserPage }) => {
  await project.addCollection();
  await project.addResource({ key: 'common.buttons.ok', baseValue: 'OK' });
  await project.addResource({ key: 'common.buttons.cancel', baseValue: 'Cancel' });
  await project.addResource({ key: 'home.title', baseValue: 'Home' });
  await browserPage.goto(project.collectionName);
  await expect(browserPage.rows).toHaveCount(3);
  await browserPage.folder('common').press('ArrowRight');
  await browserPage.folder('buttons').click();
  await expect(browserPage.folder('buttons')).toHaveAttribute('aria-selected', 'true');
  await expect(browserPage.rows).toHaveCount(2);
  await expect(browserPage.row('common.buttons.ok')).toBeVisible();
  await expect(browserPage.row('common.buttons.cancel')).toBeVisible();
  await expect(browserPage.row('home.title')).toBeHidden();
  await browserPage.folder('home').click();
  await expect(browserPage.rows).toHaveCount(1);
  await expect(browserPage.row('home.title')).toBeVisible();
  await expect(browserPage.row('common.buttons.ok')).toBeHidden();
  await expect(browserPage.row('common.buttons.cancel')).toBeHidden();
});

test('does not search below three characters and searches at and above the minimum', async ({
  project,
  browserPage,
  page,
}) => {
  await project.addCollection();
  await project.addResource({ key: 'actions.save', baseValue: 'Save draft' });
  await project.addResource({ key: 'actions.cancel', baseValue: 'Cancel' });
  await browserPage.goto(project.collectionName);
  await expect(browserPage.rows).toHaveCount(2);
  const queries: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/resources/search')) queries.push(url.searchParams.get('query') ?? '');
  });
  await page.clock.install();
  await browserPage.search.fill('sa');
  // Advance past the component's 300 ms debounce to exercise the minimum-length branch.
  await page.clock.runFor(400);
  await expect(browserPage.rows).toHaveCount(2);
  await expect(browserPage.clearSearch).toBeHidden();
  expect(queries).toEqual([]);
  await browserPage.search.fill('sav');
  await page.clock.runFor(400);
  await expect(browserPage.rows).toHaveCount(1);
  await expect(browserPage.row('actions.save')).toBeVisible();
  await expect(browserPage.row('actions.cancel')).toBeHidden();
  await expect(browserPage.clearSearch).toBeVisible();
  await browserPage.search.fill('draft');
  await page.clock.runFor(400);
  await expect.poll(() => queries).toEqual(['sav', 'draft']);
  await expect(browserPage.rows).toHaveCount(1);
  await expect(browserPage.row('actions.save')).toBeVisible();
  await expect(browserPage.row('actions.cancel')).toBeHidden();
});

test('filters resources by the selected French Canadian translation status', async ({ project, browserPage }) => {
  await project.addCollection();
  await project.addResource({
    key: 'actions.save',
    baseValue: 'Save',
    translations: [{ locale: 'fr-ca', value: 'Enregistrer', status: 'translated' }],
  });
  await project.addResource({
    key: 'actions.cancel',
    baseValue: 'Cancel',
    translations: [{ locale: 'fr-ca', value: 'Annuler', status: 'new' }],
  });
  await browserPage.goto(project.collectionName);
  await expect(browserPage.rows).toHaveCount(2);
  await browserPage.selectLocale('fr-ca');
  await browserPage.statusFilter('Translated').click();
  await expect(browserPage.statusFilter('Translated')).toHaveAttribute('aria-pressed', 'true');
  await expect(browserPage.rows).toHaveCount(1);
  await expect(browserPage.row('actions.save')).toBeVisible();
  await expect(browserPage.row('actions.cancel')).toBeHidden();
  await browserPage.statusFilter('Translated').click();
  await browserPage.statusFilter('New').click();
  await expect(browserPage.statusFilter('New')).toHaveAttribute('aria-pressed', 'true');
  await expect(browserPage.rows).toHaveCount(1);
  await expect(browserPage.row('actions.cancel')).toBeVisible();
  await expect(browserPage.row('actions.save')).toBeHidden();
});
