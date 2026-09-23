import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { validateLocale } from '@simoncodes-ca/domain';
import { updateConfig } from '../lib/config/config-file-operations';
import { walkFolders } from '../lib/normalize/iterative-folder-walker';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { ErrorMessages } from '../lib/errors/error-messages';
import { RESOURCE_ENTRIES_FILENAME } from '../constants';

export interface AddLocaleToCollectionOptions {
  readonly cwd?: string;
}

export interface AddLocaleToCollectionResult {
  readonly message: string;
  readonly entriesBackfilled: number;
  readonly filesUpdated: number;
}

export async function addLocaleToCollection(
  collectionName: string,
  locale: string,
  options: AddLocaleToCollectionOptions = {},
): Promise<AddLocaleToCollectionResult> {
  const cwd = options.cwd ?? process.cwd();

  validateLocale(locale);

  const updatedConfig = updateConfig((config) => {
    if (!config.collections?.[collectionName]) {
      throw new Error(ErrorMessages.collectionNotFound(collectionName));
    }

    const collection = config.collections[collectionName];
    const baseLocale = collection.baseLocale ?? config.baseLocale;

    if (locale === baseLocale) {
      throw new Error(ErrorMessages.cannotModifyBaseLocale(locale));
    }

    const effectiveLocales = collection.locales ?? config.locales ?? [];

    if (effectiveLocales.includes(locale)) {
      throw new Error(ErrorMessages.localeAlreadyExists(locale, collectionName));
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

  const collection = updatedConfig.collections[collectionName];
  const translationsFolderPath = path.resolve(cwd, collection.translationsFolder);

  let entriesBackfilled = 0;
  let filesUpdated = 0;

  for (const visit of walkFolders(translationsFolderPath)) {
    if (!existsSync(path.join(visit.absolutePath, RESOURCE_ENTRIES_FILENAME))) continue;

    const folder = openResourceFolder(visit.absolutePath, {
      baseLocale: collection.baseLocale ?? updatedConfig.baseLocale,
    });

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
  };
}
