// The public surface of @simoncodes-ca/core: the Node-side operations the API and CLI call.
// Only names with an outside consumer, plus the types those names' signatures need, are listed.
// Domain rules and types (TranslationStatus, TokenCasing, ImportStrategy, BundleDefinition, ...) come from @simoncodes-ca/domain.

// Operations: resources
export { addResource, addResources, deleteResource, editResource, moveResource, moveResources } from './lib/resource';
export type { AddResourceOptions, ExistingResourcePolicy } from './lib/resource';

// Operations: folders
export { createFolder, deleteFolder, moveFolder } from './lib/folder';

// Operations: collections and locales
export {
  addCollection,
  addLocaleToCollection,
  deleteCollectionByName,
  editCollectionTags,
  removeLocaleFromCollection,
  updateCollection,
} from './collections-manager';

// Operations: bundles
export {
  addBundleDefinition,
  deleteBundleDefinition,
  generateBundles,
  generatePreparedBundle,
  prepareBundleRun,
  type PreparedBundleRun,
  type PrepareBundleRunParams,
  planBundle,
  updateBundleDefinition,
} from './lib/bundle';

// Operations: import
export {
  detectImportFormat,
  runImport,
} from './lib/import';

// Operations: export
export { exportTargetLocales, runExport } from './lib/export/run-export';

// Operations: glossary
export { buildGlossary, type BuildGlossaryOptions, type BuildGlossaryResult } from './lib/glossary/build-glossary';

// Operations: normalize, translate, validate
export { emptyNormalizeCollectionsResult, normalize, normalizeCollections } from './lib/normalize';
export {
  assertAutoTranslationEnabled,
  assertCanTranslateLocale,
  translateExistingResource,
  translateLocale,
} from './lib/translation';
export { runValidate } from './lib/validate';
export type { ValidateRunOptions, ValidateRunResult } from './lib/validate';

// Collection & config
export type { LingoTrackerCollection } from './config/lingo-tracker-collection';
export type { LingoTrackerConfig } from './config/lingo-tracker-config';
export type { TranslationConfig } from './config/translation-config';
export { CONFIG_FILENAME, DEFAULT_CONFIG } from './constants';
export {
  type Collection,
  displayTermPath,
  initConfig,
  updateProjectTerms,
  type LoadPreferredTerminologyResult,
  loadConfig,
  loadPreferredTerminology,
  openCollection,
  type ResolvedProtectedTerms,
  resolveProtectedTermsForConfig,
  type StoredProtectedTerms,
  type TermFile,
  type TermFiles,
} from './lib/config';

// Project Terms: the protected terms and preferred terminology in force for an opened collection
export type { TerminologyFindings } from './lib/config';

// ResourceFolder: one folder's entries and metadata, loaded and saved as a unit
export {
  type EntryDetails,
  type NormalizeEntryReport,
  openResourceFolder,
  type ResourceFolder,
  type ResourceFolderEntry,
  type ResourceFolderSaveResult,
} from './lib/resource';

// Collection Reader: every entry of a collection, read through ResourceFolder
export {
  type CollectionRead,
  type CollectionReadProblem,
  type CollectionReadTarget,
  readCollection,
  type StoredResource,
} from './lib/resource';

// Read models: the resource tree, Resource Search and fingerprints behind the API's CollectionIndex and CLI find-similar
export {
  computeTreeFingerprint,
  searchPage,
  type SearchPage,
  extractResourcesRecursively,
  extractSubtree,
  type FolderChild,
  loadResourceTree,
  type MatchType,
  type ResourceMutation,
  type ResourceTreeEntry,
  type ResourceTreeNode,
  type SearchableResource,
  type SearchMode,
  type SearchOptions,
  type SearchResult,
  searchResources,
  treeResources,
  type TreeFingerprint,
  treeFingerprintsMatch,
} from './lib/resource';

// Errors
export { PreferredTerminologyValidationError } from './lib/config';
export {
  AutoTranslationDisabledError,
  BaseLocaleImmutableError,
  CannotTranslateBaseLocaleError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  ConfigNotFoundError,
  ConfigParseError,
  type ErrorKind,
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  type FolderPathPart,
  ImportSourceError,
  InvalidBundleDefinitionError,
  InvalidBundleLocalesError,
  InvalidCollectionError,
  InvalidProjectTermsEditError,
  InvalidConfigError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  MultipleBundleConstantNameError,
  TranslationLocaleNotConfiguredError,
  ParentDirectoryMissingError,
  ProtectedTermsFileError,
  ProtectedTermsFileNotSetError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
} from './lib/errors';
export { TranslationError } from './lib/translation';

// Types: operation parameters and results
export type {
  AddCollectionOptions,
  CollectionTagEdit,
  AddLocaleToCollectionOptions,
  AddLocaleToCollectionResult,
  DeleteCollectionOptions,
  RemoveLocaleFromCollectionOptions,
  RemoveLocaleFromCollectionResult,
  UpdateCollectionOptions,
} from './collections-manager';
export type { AddResourcesResult, MoveResourcesOperation } from './lib/resource';
export type {
  BundleDefinitionOperationOptions,
  BundlePlan,
  BundlePlanExampleKey,
  BundlePlanFile,
  BundleProgressEvent,
  BundleRunOutcome,
  BundleTypeOutcome,
  GenerateBundleParams,
  GenerateBundleResult,
  GenerateBundlesOptions,
  GenerateBundlesResult,
  PlanBundleParams,
  UpdateBundleDefinitionOptions,
} from './lib/bundle';
export type { LoadConfigOptions, OpenCollectionOptions } from './lib/config';
export type { PreferredTerminologyEditResult } from './lib/config';
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
  ImportFormat,
  ImportResult,
  ImportRunOptions,
  ImportRunWarning,
  RunImportOptions,
  RunImportResult,
} from './lib/import';
export type {
  CollectionNormalizeResult,
  NormalizeCollectionsOptions,
  NormalizeCollectionsResult,
  NormalizeOptions,
  NormalizeResult,
} from './lib/normalize';
export type {
  ComputeTreeFingerprintOptions,
  LoadResourceTreeOptions,
  OpenResourceFolderOptions,
} from './lib/resource';
export type {
  OpenTranslatorOptions,
  ProviderCapabilities,
  TranslateExistingResourceResult,
  TranslateLocaleParams,
  TranslateLocaleProgress,
  TranslateLocaleResult,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
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
} from './lib/resource';

export type {
  ProjectTermsUpdate,
  ProjectTermsUpdateResult,
  ProjectTermsUpdateView,
} from './lib/config/update-project-terms';
