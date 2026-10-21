import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { APIRequestContext, APIResponse, TestFixture } from '@playwright/test';
import type { CreateCollectionDto, CreateResourceDto } from '@simoncodes-ca/data-transfer';
import { type CollectionConfig, protectedTermsPath } from './disk';
import type { Server } from './server';

export interface Project {
  collectionName: string;
  translationsFolder: string;
  addResource(resource: CreateResourceDto): Promise<void>;
  addCollection(overrides?: Partial<Omit<CollectionConfig, 'translationsFolder'>>): Promise<string>;
}

async function requireSeedSuccess(response: APIResponse): Promise<void> {
  if (!response.ok()) {
    throw new Error(`Seed request failed: ${response.status()} ${response.url()}\n${await response.text()}`);
  }
}

export const projectFixture: TestFixture<Project, { server: Server; request: APIRequestContext }> = async (
  { server, request },
  use,
  testInfo,
) => {
  const collectionName = `t-${createHash('sha256').update(testInfo.testId).digest('hex').slice(0, 12)}`;
  const translationsFolder = join(server.projectRoot, 'translations', collectionName);
  const configPath = join(server.projectRoot, '.lingo-tracker.json');
  const snapshot = await readFile(configPath);
  const termsPath = await protectedTermsPath(server.projectRoot);
  const termsSnapshot = await readFile(termsPath).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  try {
    await use({
      collectionName,
      translationsFolder,
      async addResource(resource) {
        await requireSeedSuccess(
          await request.post(`/api/collections/${encodeURIComponent(collectionName)}/resources`, { data: resource }),
        );
      },
      async addCollection(overrides = {}) {
        const data: CreateCollectionDto = {
          name: collectionName,
          collection: { ...overrides, translationsFolder },
        };
        await requireSeedSuccess(await request.post('/api/collections', { data }));
        return collectionName;
      },
    });
  } finally {
    try {
      await writeFile(configPath, snapshot);
    } finally {
      try {
        if (termsSnapshot === undefined) await rm(termsPath, { force: true });
        else await writeFile(termsPath, termsSnapshot);
      } finally {
        await rm(translationsFolder, { recursive: true, force: true });
      }
    }
  }
};
