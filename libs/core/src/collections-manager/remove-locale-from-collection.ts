import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { validateLocale } from '@simoncodes-ca/domain';
import { updateConfig } from '../lib/config/config-file-operations';
import { openCollection } from '../lib/config/open-collection';
import { walkFolders } from '../lib/normalize/iterative-folder-walker';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { ErrorMessages } from '../lib/errors/error-messages';
import { RESOURCE_ENTRIES_FILENAME } from '../constants';

export interface RemoveLocaleFromCollectionOptions {
  readonly cwd?: string;
}

export interface RemoveLocaleFromCollectionResult {
  readonly message: string;
  readonly entriesPurged: number;
  readonly filesUpdated: number;
  /** A `reindex` of the collection: every folder's metadata changed. */
  readonly mutations: ResourceMutation[];
}

export async function removeLocaleFromCollection(
  collectionName: string,
  locale: string,
  options: RemoveLocaleFromCollectionOptions = {},
): Promise<RemoveLocaleFromCollectionResult> {
  const cwd = options.cwd ?? process.cwd();

  validateLocale(locale);

  const updatedConfig = updateConfig((config) => {
    // `writable` throws inside the updater, so nothing is written for a read-only collection.
    const {
      baseLocale,
      locales: effectiveLocales,
      config: collection,
    } = openCollection(config, collectionName, { cwd, writable: true });

    if (locale === baseLocale) {
      throw new Error(ErrorMessages.cannotModifyBaseLocale(locale));
    }

    if (!effectiveLocales.includes(locale)) {
      throw new Error(ErrorMessages.localeNotFound(locale, collectionName));
    }

    const newLocales = effectiveLocales.filter((l) => l !== locale);

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

  let entriesPurged = 0;
  let filesUpdated = 0;

  for (const visit of walkFolders(collection.translationsFolder)) {
    if (!existsSync(path.join(visit.absolutePath, RESOURCE_ENTRIES_FILENAME))) continue;

    const folder = openResourceFolder(visit.absolutePath);

    const purged = folder.dropLocale(locale);
    if (purged > 0) {
      folder.save();
      entriesPurged += purged;
      filesUpdated++;
    }
  }

  return {
    message: `Locale "${locale}" removed from collection "${collectionName}" successfully`,
    entriesPurged,
    filesUpdated,
    mutations: [reindexMutation(collection.translationsFolder)],
  };
}
