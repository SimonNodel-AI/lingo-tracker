import { test as base } from '@playwright/test';
import { CollectionsPage } from '../pages/collections.page';
import { networkGuardFixture } from './network';
import { type Project, projectFixture } from './project';
import { type Server, serverFixture } from './server';

interface TestFixtures {
  project: Project;
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
  networkGuard: [networkGuardFixture, { auto: true }],
  collectionsPage: async ({ page }, use) => {
    await use(new CollectionsPage(page));
  },
});

export { expect } from '@playwright/test';
