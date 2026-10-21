import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestFixture } from '@playwright/test';
import { type CollectionConfig, readConfig } from './disk';
import type { Server } from './server';

export interface Project {
  collectionName: string;
  translationsFolder: string;
  addCollection(overrides?: Partial<Omit<CollectionConfig, 'translationsFolder'>>): Promise<string>;
}

export const projectFixture: TestFixture<Project, { server: Server }> = async ({ server }, use, testInfo) => {
  const collectionName = `t-${createHash('sha256').update(testInfo.testId).digest('hex').slice(0, 12)}`;
  const translationsFolder = join(server.projectRoot, 'translations', collectionName);
  const configPath = join(server.projectRoot, '.lingo-tracker.json');
  const snapshot = await readFile(configPath);
  try {
    await use({
      collectionName,
      translationsFolder,
      async addCollection(overrides = {}) {
        const config = await readConfig(server.projectRoot);
        await mkdir(translationsFolder, { recursive: true });
        config.collections[collectionName] = { ...overrides, translationsFolder };
        await writeFile(configPath, JSON.stringify(config, null, 2));
        return collectionName;
      },
    });
  } finally {
    try {
      await writeFile(configPath, snapshot);
    } finally {
      await rm(translationsFolder, { recursive: true, force: true });
    }
  }
};
