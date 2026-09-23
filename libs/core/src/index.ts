// The public surface of @simoncodes-ca/core: the Node-side operations the API and CLI call.
// Only names with a consumer outside this library are listed, plus the types their signatures use.
// Domain rules and types (TranslationStatus, TokenCasing, ImportStrategy, ...) come from @simoncodes-ca/domain.

// Operations: resources
export { addResource, deleteResource, editResource, moveResource } from './resource';

// Operations: folders
export { createFolder, deleteFolder, moveFolder } from './lib/folder';

// Operations: collections and locales
export {
  addCollection,
  addLocaleToCollection,
  deleteCollectionByName,
  removeLocaleFromCollection,
  setCollectionProtectedTerms,
  setCollectionProtectedTermsFile,
  setGlobalProtectedTerms,
  setGlobalProtectedTermsFile,
  updateCollection,
} from './collections-manager';

// Operations: bundles
export { hasTypeDistConfigured } from './config/bundle-definition';
export {
  addBundleDefinition,
  deleteBundleDefinition,
  generateBundle,
  getBundleOutputPath,
  planBundle,
  updateBundleDefinition,
  validateBundleDefinition,
  validateBundleKey,
} from './lib/bundle';

// Operations: import
export {
  detectImportFormat,
  generateImportSummary,
  importResources,
  parseJsonImport,
  parseXliffImport,
} from './lib/import';

// Operations: export
export {
  validateBasePropertyName,
  validateOutputDirectory,
} from './lib/export/export-common';
export { exportTargetLocales, runExport } from './lib/export/run-export';

// Operations: normalize, translate, validate
export { normalize } from './lib/normalize';
export { translateExistingResource, translateLocale } from './lib/translation';
export { describePreferredTermRule, generateValidationSummary, validateResources } from './lib/validate';

// Collection & config
export type { BundleDefinition, CollectionBundleDefinition, EntrySelectionRule } from './config/bundle-definition';
export type { LingoTrackerCollection } from './config/lingo-tracker-collection';
export type { LingoTrackerConfig } from './config/lingo-tracker-config';
export type { TranslationConfig } from './config/translation-config';
export { CONFIG_FILENAME, DEFAULT_CONFIG } from './constants';
export {
  type Collection,
  type LoadPreferredTerminologyResult,
  loadConfig,
  loadPreferredTerminology,
  openCollection,
  type ResolvedProtectedTerms,
  readCollectionProtectedTerms,
  readEffectiveProtectedTerms,
  readGlobalProtectedTerms,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFilePath,
  resolvePreferredTerminologyFilePath,
  resolveProtectedTermsForConfig,
  writePreferredTerminology,
} from './lib/config';

// ResourceFolder: one folder's entries and metadata, loaded and saved as a unit
export {
  type EntryDetails,
  openResourceFolder,
  type ResolvedResourcePaths,
  type ResourceFolder,
  type ResourceFolderEntry,
  type ResourceFolderSaveResult,
  resolveResourcePaths,
} from './lib/resource';

// Collection Reader: every entry of a collection, read through ResourceFolder
export {
  type CollectionRead,
  type CollectionReadProblem,
  type CollectionReadTarget,
  readCollection,
  type StoredResource,
} from './lib/resource';

// Read models: the resource tree, search and fingerprints behind the API's CollectionIndex
export {
  computeTreeFingerprint,
  extractResourcesRecursively,
  extractSubtree,
  type FolderChild,
  loadResourceTree,
  type MatchType,
  type ResourceMutation,
  type ResourceTreeEntry,
  type ResourceTreeNode,
  reindexMutation,
  type SearchResult,
  searchResourceTree,
  searchTranslations,
  type TreeFingerprint,
  treeFingerprintsMatch,
} from './lib/resource';

// Errors
export { PreferredTerminologyValidationError } from './lib/config';
export {
  AutoTranslationDisabledError,
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  ConfigNotFoundError,
  ConfigParseError,
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  type FolderPathPart,
  InvalidBundleDefinitionError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from './lib/errors';
export { TranslationError } from './lib/translation';

// Types: operation parameters and results
export type {
  AddCollectionOptions,
  AddLocaleToCollectionOptions,
  AddLocaleToCollectionResult,
  DeleteCollectionOptions,
  RemoveLocaleFromCollectionOptions,
  RemoveLocaleFromCollectionResult,
  SetProtectedTermsOptions,
  SetProtectedTermsResult,
  UpdateCollectionOptions,
} from './collections-manager';
export type {
  BundleDefinitionOperationOptions,
  BundlePlan,
  BundlePlanExampleKey,
  BundlePlanFile,
  BundleProgressEvent,
  GenerateBundleParams,
  GenerateBundleResult,
  PlanBundleParams,
  UpdateBundleDefinitionOptions,
} from './lib/bundle';
export type { LoadConfigOptions, OpenCollectionOptions } from './lib/config';
export type { ExportLocaleResult, ExportRunOptions, ExportRunResult } from './lib/export/run-export';
export type { ExportFormat, ExportResult } from './lib/export/types';
export type {
  CreateFolderParams,
  CreateFolderResult,
  DeleteFolderParams,
  DeleteFolderResult,
  MoveFolderParams,
  MoveFolderResult,
} from './lib/folder';
export type {
  ICUAutoFix,
  ICUAutoFixError,
  ImportChange,
  ImportChangeType,
  ImportedResource,
  ImportFormat,
  ImportParseOptions,
  ImportResult,
  ImportRunOptions,
  ImportSummaryOptions,
  StatusTransition,
} from './lib/import';
export type { NormalizeParams, NormalizeResult } from './lib/normalize';
export type {
  ComputeTreeFingerprintOptions,
  LoadResourceTreeOptions,
  OpenResourceFolderOptions,
  ResourcePathResolutionParams,
  SearchParams,
  SearchTreeParams,
} from './lib/resource';
export type {
  TranslateExistingResourceResult,
  TranslateLocaleParams,
  TranslateLocaleProgress,
  TranslateLocaleResult,
} from './lib/translation';
export type { ResourceValidationResult, ValidationOptions } from './lib/validate';
export type {
  AddResourceParams,
  AddResourceResult,
  DeleteResourceParams,
  DeleteResourceResult,
  EditResourceChanges,
  EditResourceResult,
  MoveResourceParams,
  MoveResourceResult,
  ResourceEntryMetadata,
  ResourceTranslation,
} from './resource';
