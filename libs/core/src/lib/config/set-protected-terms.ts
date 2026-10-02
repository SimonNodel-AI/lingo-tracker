import { effectiveProtectedTerms, type ListEdit } from '@simoncodes-ca/domain';
import { CollectionNotFoundError, InvalidCollectionError } from '../errors/lingo-tracker-error';
import type { OpenedProject } from './open-collection';
import {
  readCollectionProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
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
  project: OpenedProject,
  target: { readonly collection?: string },
): ProtectedTermsView {
  const { sourceConfig: config, projectRoot: cwd } = project;
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
