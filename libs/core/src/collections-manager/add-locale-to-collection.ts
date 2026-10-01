import type { ConfigFileOperations } from '../lib/config/config-file-operations';
import type { OpenedCollection } from '../lib/config/open-collection';
import { BaseLocaleImmutableError, LocaleAlreadyExistsError } from '../lib/errors/lingo-tracker-error';
import type { ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { changeCollection } from './update-collection';

export interface AddLocaleToCollectionResult {
  readonly message: string;
  readonly entriesBackfilled: number;
  readonly filesUpdated: number;
  /** A `reindex` of the collection: every folder's metadata changed. */
  readonly mutations: ResourceMutation[];
}

export async function addLocaleToCollection(
  collection: OpenedCollection,
  configFile: Pick<ConfigFileOperations, 'write' | 'assertUnchanged'>,
  locale: string,
): Promise<AddLocaleToCollectionResult> {
  assertValidLocale(locale);
  const collectionName = collection.name;
  const result = await changeCollection(collection, configFile, undefined, {}, {}, (current) => {
    if (locale === current.baseLocale) {
      throw new BaseLocaleImmutableError(locale);
    }
    if (current.locales.includes(locale)) {
      throw new LocaleAlreadyExistsError(locale, collectionName);
    }
    return [...current.locales, locale];
  });

  return {
    message: `Locale "${locale}" added to collection "${collectionName}" successfully`,
    entriesBackfilled: result.entriesAdded,
    filesUpdated: result.filesUpdated,
    mutations: result.mutations,
  };
}
