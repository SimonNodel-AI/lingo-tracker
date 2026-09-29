import { BaseLocaleImmutableError, LocaleAlreadyExistsError } from '../lib/errors/lingo-tracker-error';
import type { ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { changeCollection } from './update-collection';

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
  assertValidLocale(locale);
  const result = await changeCollection(collectionName, undefined, {}, options, (current) => {
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
