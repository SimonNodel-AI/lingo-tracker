import { patchCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations, updateConfig } from '../lib/config/config-file-operations';
import {
  assertWritableProtectedTermsPath,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsFilePath,
  writeProtectedTermsFile,
} from '../lib/config/protected-terms-file';
import { CollectionNotFoundError, ProtectedTermsFileNotSetError } from '../lib/errors/lingo-tracker-error';

export interface SetProtectedTermsOptions {
  cwd?: string;
}

export interface SetProtectedTermsResult {
  message: string;
  /** Absolute path of the file that was written. */
  filePath: string;
}

/**
 * Writes the global protected-terms list to its file, creating the file when absent.
 * The config itself is untouched — only the file's contents change.
 */
export function setGlobalProtectedTerms(
  terms: string[],
  options: SetProtectedTermsOptions = {},
): SetProtectedTermsResult {
  const cwd = options.cwd ?? process.cwd();
  const config = createConfigFileOperations({ cwd }).read();
  const filePath = resolveGlobalProtectedTermsFilePath(config, cwd);

  writeProtectedTermsFile(filePath, terms);

  return { message: 'Global protected terms updated successfully', filePath };
}

/**
 * Writes a collection's protected-terms list to its own file. Throws when the collection
 * does not exist, or when it has no `protectedTermsFile` pointer — collections have no
 * default path, so one must be set first via `setCollectionProtectedTermsFile`.
 */
export function setCollectionProtectedTerms(
  collectionName: string,
  terms: string[],
  options: SetProtectedTermsOptions = {},
): SetProtectedTermsResult {
  const cwd = options.cwd ?? process.cwd();
  const config = createConfigFileOperations({ cwd }).read();
  const collection = config.collections?.[collectionName];

  if (!collection) {
    throw new CollectionNotFoundError(collectionName);
  }

  const filePath = resolveCollectionProtectedTermsFilePath(collection, cwd);
  if (!filePath) {
    throw new ProtectedTermsFileNotSetError(collectionName);
  }

  writeProtectedTermsFile(filePath, terms);

  return { message: `Collection "${collectionName}" protected terms updated successfully`, filePath };
}

/**
 * Points the global config at a protected-terms file. Any terms already in the previous
 * file are carried over, so switching paths never silently drops the list. Passing
 * `undefined` (or a blank string) clears the pointer, returning to the default path.
 */
export function setGlobalProtectedTermsFile(
  rawPointer: string | undefined,
  options: SetProtectedTermsOptions = {},
): SetProtectedTermsResult {
  const cwd = options.cwd ?? process.cwd();
  const pointer = normalizePointer(rawPointer);
  const previousConfig = createConfigFileOperations({ cwd }).read();
  const carried = readGlobalProtectedTerms(previousConfig, cwd);

  // Validate before touching config, so a bad path never leaves a dangling pointer behind.
  if (pointer !== undefined) {
    assertWritableProtectedTermsPath(resolveProtectedTermsFilePath(pointer, cwd));
  }

  const config = updateConfig((current) => {
    if (pointer === undefined) {
      delete current.protectedTermsFile;
    } else {
      current.protectedTermsFile = pointer;
    }
    return current;
  }, cwd);

  const filePath = resolveGlobalProtectedTermsFilePath(config, cwd);
  writeProtectedTermsFile(filePath, carried);

  return { message: `Global protected terms file set to ${filePath}`, filePath };
}

/**
 * Points a collection at its own protected-terms file, carrying over any terms already
 * in its previous file. Passing `undefined` (or a blank string) clears the pointer, leaving
 * the collection with no terms of its own.
 */
export function setCollectionProtectedTermsFile(
  collectionName: string,
  rawPointer: string | undefined,
  options: SetProtectedTermsOptions = {},
): SetProtectedTermsResult | { message: string; filePath: undefined } {
  const cwd = options.cwd ?? process.cwd();
  const pointer = normalizePointer(rawPointer);
  const config = createConfigFileOperations({ cwd }).read();
  const collection = config.collections?.[collectionName];

  if (!collection) {
    throw new CollectionNotFoundError(collectionName);
  }

  const carried = readCollectionProtectedTerms(collection, cwd);

  // Validate before touching config, so a bad path never leaves a dangling pointer behind.
  const filePath = pointer === undefined ? undefined : resolveProtectedTermsFilePath(pointer, cwd);
  if (filePath !== undefined) {
    assertWritableProtectedTermsPath(filePath);
  }

  // A patch of one key (`''` clears it): the rest of the record (including a `translation` override) stays as is.
  updateConfig((current) => patchCollectionEntry(current, collectionName, { protectedTermsFile: pointer ?? '' }), cwd);

  if (filePath === undefined) {
    return { message: `Collection "${collectionName}" protected terms file cleared`, filePath: undefined };
  }

  writeProtectedTermsFile(filePath, carried);

  return { message: `Collection "${collectionName}" protected terms file set to ${filePath}`, filePath };
}

/** A blank pointer is no pointer: `''` would otherwise resolve to the config directory itself. */
function normalizePointer(pointer: string | undefined): string | undefined {
  return pointer?.trim() || undefined;
}
