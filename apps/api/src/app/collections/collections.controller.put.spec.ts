import { Test } from '@nestjs/testing';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILENAME, type LingoTrackerConfig } from '@simoncodes-ca/core';
import type { UpdateCollectionDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';
import { ConfigService } from '../config/config.service';
import { CollectionsController } from './collections.controller';

/**
 * PUT /collections/:name through the real mapper and real core, against a temp project: the
 * fields a client does not send must survive the update.
 */
describe('CollectionsController PUT (real core)', () => {
  let projectDir: string;
  let controller: CollectionsController;

  const stored = {
    translationsFolder: './i18n',
    exportFolder: 'custom/export',
    importFolder: 'custom/import',
    locales: ['en', 'fr'],
    translation: { enabled: true, provider: 'google-translate', apiKeyEnv: 'KEY' },
    tags: ['team-x'],
  };
  const config: LingoTrackerConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en'],
    collections: { app: stored },
  };
  const readConfig = (): LingoTrackerConfig => JSON.parse(readFileSync(join(projectDir, CONFIG_FILENAME), 'utf8'));

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'lingo-api-collections-put-'));
    jest.spyOn(process, 'cwd').mockReturnValue(projectDir);
    writeFileSync(join(projectDir, CONFIG_FILENAME), JSON.stringify(config));

    const module = await Test.createTestingModule({
      controllers: [CollectionsController],
      providers: [ConfigService, { provide: CollectionIndex, useValue: { apply: jest.fn() } }],
    }).compile();
    controller = module.get(CollectionsController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('keeps translation, exportFolder and importFolder through the Tracker form payload', async () => {
    // The shape CollectionFormDialog#buildResult sends: it never carries these three fields.
    const body: UpdateCollectionDto = {
      name: 'app',
      collection: {
        translationsFolder: './i18n',
        locales: ['en', 'fr'],
        readOnly: false,
        tags: ['team-x', 'Team Y'],
      },
    };

    const result = await controller.updateCollectionByName('app', body);

    expect(result).toEqual({ message: 'Collection "app" updated successfully' });
    expect(readConfig().collections['app']).toEqual({ ...stored, tags: ['team-x', 'team-y'] });
  });

  it('applies the fields a client does send, including clears', async () => {
    await controller.updateCollectionByName('app', {
      collection: { translationsFolder: './i18n', tags: [], exportFolder: 'dist/lingo-export' },
    });

    const { tags, exportFolder, ...rest } = stored;
    expect(readConfig().collections['app']).toEqual(rest);
  });
});
