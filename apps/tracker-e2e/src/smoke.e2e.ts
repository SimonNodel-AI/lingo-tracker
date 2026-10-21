import { expect, test } from './fixtures';

test('opens collections without browser errors and shows a collection from disk', async ({
  page,
  project,
  collectionsPage,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  const name = await project.addCollection();
  await collectionsPage.goto();

  await expect(page).toHaveURL(/\/collections$/);
  await expect(page).toHaveTitle('Collections');
  await expect(collectionsPage.collection(name)).toBeVisible();
  expect(errors, 'Browser console errors and uncaught page errors').toEqual([]);
});
