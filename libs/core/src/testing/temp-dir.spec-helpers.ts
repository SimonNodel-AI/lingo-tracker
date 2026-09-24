/**
 * Real-filesystem fixtures for core specs: a fresh temp directory per test, collections that
 * point into it, and helpers that write resources through the Resource Folder or as raw files.
 *
 * Spec-only (imports vitest): `*.spec-helpers.ts` files are excluded from the library build.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranslationStatus } from '@simoncodes-ca/domain';
import { afterEach, beforeEach } from 'vitest';
import { RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../constants';
import type { Collection } from '../lib/config/open-collection';
import { DEFAULT_PROTECTED_TERMS_FILENAME } from '../lib/config/protected-terms-file';
import { openResourceFolder } from '../lib/resource/resource-folder';

/**
 * Creates a temp directory before each test and removes it after. Call inside `describe`;
 * read the path with the returned getter (it changes per test).
 *
 * Temp directories live outside the workspace so fixture writes never reach the Nx file watcher.
 */
export function useTempDir(prefix = 'lingo-core-'): () => string {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  return () => dir;
}

/**
 * A resolved collection for tests. `locales` defaults to the base locale plus `fr` and `es`; the global
 * protected-terms file defaults to `.lingo-tracker-protected-terms.json` inside `translationsFolder`.
 */
export function testCollection(translationsFolder: string, overrides: Partial<Collection> = {}): Collection {
  const baseLocale = overrides.baseLocale ?? 'en';
  const locales = overrides.locales ?? [baseLocale, 'fr', 'es'];
  return {
    name: 'main',
    translationsFolder,
    translationConfig: undefined,
    tags: [],
    protectedTermsFiles: { global: join(translationsFolder, DEFAULT_PROTECTED_TERMS_FILENAME), globalExplicit: false },
    readOnly: false,
    config: { translationsFolder },
    ...overrides,
    baseLocale,
    locales,
    targetLocales: overrides.targetLocales ?? locales.filter((locale) => locale !== baseLocale),
  };
}

/** A translation value, optionally with its status (default `translated`). */
export type SeedTranslation = string | { readonly value: string; readonly status: TranslationStatus };

export interface SeedResource {
  readonly source: string;
  readonly translations?: Readonly<Record<string, SeedTranslation>>;
  readonly comment?: string;
  readonly tags?: readonly string[];
}

/**
 * Writes resources by full key (`apps.common.ok`) through the Resource Folder, so checksums and
 * metadata are what core itself would store.
 */
export function seedResources(collection: Collection, resources: Readonly<Record<string, SeedResource>>): void {
  for (const [fullKey, resource] of Object.entries(resources)) {
    const segments = fullKey.split('.');
    const entryKey = segments.pop() ?? fullKey;
    const folder = openResourceFolder(join(collection.translationsFolder, ...segments), {
      baseLocale: collection.baseLocale,
    });

    folder.setBase(entryKey, resource.source);
    if (resource.comment !== undefined || resource.tags !== undefined) {
      folder.setDetails(entryKey, { comment: resource.comment, tags: resource.tags });
    }
    for (const [locale, translation] of Object.entries(resource.translations ?? {})) {
      const { value, status } =
        typeof translation === 'string' ? { value: translation, status: undefined } : translation;
      folder.setTranslation(entryKey, locale, value, status);
    }
    folder.save();
  }
}

/**
 * Writes one folder's files as given, bypassing the Resource Folder — for malformed or hand-edited
 * data. A string is written verbatim; an object as JSON; `undefined` leaves the file out.
 */
export function writeFolderFiles(
  translationsFolder: string,
  folderPath: string,
  files: { readonly entries?: object | string; readonly meta?: object | string },
): string {
  const folder = join(translationsFolder, ...folderPath.split('.').filter((segment) => segment.length > 0));
  mkdirSync(folder, { recursive: true });
  const write = (name: string, content: object | string | undefined): void => {
    if (content === undefined) return;
    writeFileSync(join(folder, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };
  write(RESOURCE_ENTRIES_FILENAME, files.entries);
  write(TRACKER_META_FILENAME, files.meta);
  return folder;
}
