import { BaseLocaleImmutableError, LocaleNotFoundError } from '../lib/errors/lingo-tracker-error';
import type { ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { changeCollection } from './update-collection';

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
  assertValidLocale(locale);
  const result = await changeCollection(collectionName, undefined, {}, options, (current) => {
    if (locale === current.baseLocale) {
      throw new BaseLocaleImmutableError(locale);
    }
    if (!current.locales.includes(locale)) {
      throw new LocaleNotFoundError(locale, collectionName);
    }
    const remaining = current.locales.filter((candidate) => candidate !== locale);
    return remaining.length === 0 ? [current.baseLocale] : remaining;
  });

  return {
    message: `Locale "${locale}" removed from collection "${collectionName}" successfully`,
    entriesPurged: result.entriesRemoved,
    filesUpdated: result.filesUpdated,
    mutations: result.mutations,
  };
}
