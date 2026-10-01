import { effectiveProtectedTerms, type ListEdit, mergeListEdit, normalizeProtectedTerms } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CollectionNotFoundError, InvalidCollectionError } from '../errors/lingo-tracker-error';
import { patchCollectionEntry } from './collection-entry';
import { type ConfigFileOperations, createConfigFileOperations, updateConfig } from './config-file-operations';
import {
  assertWritableProtectedTermsPath,
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  resolveProtectedTermsFilePath,
  resolveWritableCollectionProtectedTermsPath,
  writeProtectedTermsFile,
} from './protected-terms-file';

/** Rejects an untyped request before it can change a term file or a collection entry. */
export function assertProtectedTerms(terms: unknown): asserts terms is string[] {
  if (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string')) {
    throw new InvalidCollectionError('protectedTerms must be an array of strings');
  }
}

export type ProtectedTermsEdit = ListEdit;

export interface ProtectedTermsView {
  readonly globalTerms: string[];
  readonly collectionTerms: string[];
  readonly effectiveTerms: string[];
  readonly globalFilePath: string;
  readonly collectionFilePath?: string;
  readonly warnings: string[];
  readonly storedTerms: string[];
}

export interface ProtectedTermsEditResult {
  readonly terms: string[];
  readonly filePath: string;
}

/** Reads the stored lists and paths for one scope, before an edit writes anything. */
export function readProtectedTermsTarget(
  config: LingoTrackerConfig,
  target: { readonly collection?: string },
  cwd: string = process.cwd(),
): ProtectedTermsView {
  const collectionName = target.collection;
  if (collectionName && !config.collections?.[collectionName]) {
    throw new CollectionNotFoundError(collectionName);
  }
  const collection = collectionName ? config.collections?.[collectionName] : undefined;
  const global = readGlobalProtectedTerms(config, cwd);
  const own = collection ? readCollectionProtectedTerms(collection, cwd) : { terms: [] };
  const globalFilePath = resolveGlobalProtectedTermsFilePath(config, cwd);
  const collectionFilePath = collection ? resolveCollectionProtectedTermsFilePath(collection, cwd) : undefined;
  const storedTerms = collectionName ? [...own.terms] : [...global.terms];
  const warnings = [...new Set([global.warning, own.warning])].filter(
    (warning): warning is string => warning !== undefined,
  );
  return {
    globalTerms: global.terms,
    collectionTerms: own.terms,
    effectiveTerms: effectiveProtectedTerms(global.terms, own.terms),
    globalFilePath,
    collectionFilePath,
    warnings,
    storedTerms,
  };
}

/** Applies add, remove, or set to the list already read for this scope. */
export function editProtectedTerms(
  target: { readonly collection?: string },
  view: ProtectedTermsView,
  edit: ProtectedTermsEdit,
  options: SetProtectedTermsOptions = {},
): ProtectedTermsEditResult {
  const terms = mergeListEdit(view.storedTerms, edit, normalizeProtectedTerms);
  const result = target.collection
    ? setCollectionProtectedTerms(target.collection, terms, options)
    : setGlobalProtectedTerms(terms, options);
  return { terms, filePath: result.filePath };
}

export interface SetProtectedTermsOptions {
  cwd?: string;
  /** Config already used to plan the edit; omit it for a standalone setter call. */
  config?: LingoTrackerConfig;
  /** A handle tied to that config's read, when it has a tracked snapshot. */
  configFile?: Pick<ConfigFileOperations, 'write'>;
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
  assertProtectedTerms(terms);
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? createConfigFileOperations({ cwd }).read();
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
  assertProtectedTerms(terms);
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? createConfigFileOperations({ cwd }).read();
  const collection = config.collections?.[collectionName];

  if (!collection) {
    throw new CollectionNotFoundError(collectionName);
  }

  const filePath = resolveWritableCollectionProtectedTermsPath(collectionName, collection, cwd);

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
  const previousConfig = options.config ?? createConfigFileOperations({ cwd }).read();
  const carried = readGlobalProtectedTerms(previousConfig, cwd).terms;

  // Validate before touching config, so a bad path never leaves a dangling pointer behind.
  if (pointer !== undefined) {
    assertWritableProtectedTermsPath(resolveProtectedTermsFilePath(pointer, cwd));
  }

  const config = { ...previousConfig };
  if (pointer === undefined) delete config.protectedTermsFile;
  else config.protectedTermsFile = pointer;
  if (options.configFile) {
    options.configFile.write(config);
  } else {
    updateConfig((current) => {
      if (pointer === undefined) delete current.protectedTermsFile;
      else current.protectedTermsFile = pointer;
      return current;
    }, cwd);
  }

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
  const config = options.config ?? createConfigFileOperations({ cwd }).read();
  const collection = config.collections?.[collectionName];

  if (!collection) {
    throw new CollectionNotFoundError(collectionName);
  }

  const carried = readCollectionProtectedTerms(collection, cwd).terms;

  // Validate before touching config, so a bad path never leaves a dangling pointer behind.
  const filePath = pointer === undefined ? undefined : resolveProtectedTermsFilePath(pointer, cwd);
  if (filePath !== undefined) {
    assertWritableProtectedTermsPath(filePath);
  }

  // A patch of one key (`''` clears it): the rest of the record (including a `translation` override) stays as is.
  if (options.configFile) {
    options.configFile.write(patchCollectionEntry(config, collectionName, { protectedTermsFile: pointer ?? '' }));
  } else {
    updateConfig(
      (current) => patchCollectionEntry(current, collectionName, { protectedTermsFile: pointer ?? '' }),
      cwd,
    );
  }

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
