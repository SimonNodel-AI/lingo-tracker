import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { updateConfig } from '../lib/config/config-file-operations';
import { openCollection } from '../lib/config/open-collection';
import { walkFolders } from '../lib/normalize/iterative-folder-walker';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { BaseLocaleImmutableError, LocaleAlreadyExistsError } from '../lib/errors/lingo-tracker-error';
import { assertValidLocale } from './assert-valid-locale';
import { RESOURCE_ENTRIES_FILENAME } from '../constants';

export interface AddLocaleToCollectionOptions {
  readonly cwd?: string;
}

export interface AddLocaleToCollectionResult {
  readonly message: string;
  readonly entriesBackfilled: number;
  readonly filesUpdated: number;
  /** A `reindex` of the collection: every folder's metadata changed. */
  readonly mutations: ResourceMutation[];
}

export async function addLocaleToCollection(
  collectionName: string,
  locale: string,
  options: AddLocaleToCollectionOptions = {},
): Promise<AddLocaleToCollectionResult> {
  const cwd = options.cwd ?? process.cwd();

  assertValidLocale(locale);

  const updatedConfig = updateConfig((config) => {
    // `writable` throws inside the updater, so nothing is written for a read-only collection.
    const {
      baseLocale,
      locales: effectiveLocales,
      config: collection,
    } = openCollection(config, collectionName, { cwd, writable: true });

    if (locale === baseLocale) {
      throw new BaseLocaleImmutableError(locale);
    }

    if (effectiveLocales.includes(locale)) {
      throw new LocaleAlreadyExistsError(locale, collectionName);
    }

    const newLocales = [...effectiveLocales, locale];

    return {
      ...config,
      collections: {
        ...config.collections,
        [collectionName]: {
          ...collection,
          locales: newLocales,
        },
      },
    };
  }, cwd);

  const collection = openCollection(updatedConfig, collectionName, { cwd });

  let entriesBackfilled = 0;
  let filesUpdated = 0;

  for (const visit of walkFolders(collection.translationsFolder)) {
    if (!existsSync(path.join(visit.absolutePath, RESOURCE_ENTRIES_FILENAME))) continue;

    const folder = openResourceFolder(visit.absolutePath, { baseLocale: collection.baseLocale });

    // Seed the new locale with the base (source) value and status 'new' — the same
    // convention normalize uses for missing locales.
    const seeded = folder.seedLocale(locale);
    if (seeded > 0) {
      folder.save();
      entriesBackfilled += seeded;
      filesUpdated++;
    }
  }

  return {
    message: `Locale "${locale}" added to collection "${collectionName}" successfully`,
    entriesBackfilled,
    filesUpdated,
    mutations: [reindexMutation(collection.translationsFolder)],
  };
}
