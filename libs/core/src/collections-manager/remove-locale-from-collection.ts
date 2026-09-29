import { updateConfig } from '../lib/config/config-file-operations';
import { openCollection } from '../lib/config/open-collection';
import { BaseLocaleImmutableError, LocaleNotFoundError } from '../lib/errors/lingo-tracker-error';
import type { ResourceFolder } from '../lib/resource/resource-folder';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { dropLocaleFiles, openLocaleFolders } from './locale-files';

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

  assertValidLocale(locale);

  let folders: ResourceFolder[] = [];
  const updatedConfig = updateConfig((config) => {
    // `writable` throws inside the updater, so nothing is written for a read-only collection.
    const opened = openCollection(config, collectionName, { cwd, writable: true });
    const { baseLocale, locales: effectiveLocales, config: collection } = opened;

    if (locale === baseLocale) {
      throw new BaseLocaleImmutableError(locale);
    }

    if (!effectiveLocales.includes(locale)) {
      throw new LocaleNotFoundError(locale, collectionName);
    }

    const newLocales = effectiveLocales.filter((l) => l !== locale);

    // Every folder is read before the config is written: an unreadable one fails the change with nothing written.
    folders = openLocaleFolders(opened);

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
  const { entries: entriesPurged, filesUpdated } = dropLocaleFiles(folders, locale);

  return {
    message: `Locale "${locale}" removed from collection "${collectionName}" successfully`,
    entriesPurged,
    filesUpdated,
    mutations: [reindexMutation(collection.translationsFolder)],
  };
}
