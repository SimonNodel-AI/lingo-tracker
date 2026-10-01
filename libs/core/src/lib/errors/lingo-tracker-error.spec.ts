import { describe, expect, it } from 'vitest';
import { PreferredTerminologyValidationError } from '../config/preferred-terminology-file';
import { TranslationError } from '../translation/translation-provider';
import { ErrorMessages } from './error-messages';
import * as errorClasses from './lingo-tracker-error';
import {
  AutoTranslationDisabledError,
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CannotTranslateBaseLocaleError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  CollectionRenameBundleConflictError,
  CollectionRequiredByBundleError,
  ConfigChangedError,
  ConfigNotFoundError,
  ConfigParseError,
  CoreOperationError,
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  GlossaryBaseLocaleMismatchError,
  GlossaryExtractorError,
  GlossaryNoCollectionsError,
  ImportSourceError,
  InvalidBundleDefinitionError,
  InvalidBundleLocalesError,
  InvalidCollectionError,
  InvalidConfigError,
  InvalidFolderPathError,
  InvalidImportLocaleError,
  InvalidLocaleError,
  InvalidProjectTermsEditError,
  InvalidResourceKeyError,
  InvalidTranslationStatusError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  MultipleBundleConstantNameError,
  ParentDirectoryMissingError,
  ProtectedTermsFileError,
  ProtectedTermsFileNotSetError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
  TranslationLocaleNotConfiguredError,
} from './lingo-tracker-error';

describe('LingoTrackerError subclasses', () => {
  it('keeps the string form of a former plain error for CLI summaries', () => {
    const error = new CoreOperationError('Failed to read file');
    expect(error.kind).toBe('internal');
    expect(error.exposeMessage).toBe(false);
    expect(String(error)).toBe('Error: Failed to read file');
  });

  const cases: ReadonlyArray<{ error: LingoTrackerError; name: string; code: string; message: string }> = [
    {
      error: new ConfigNotFoundError('/w/.lingo-tracker.json'),
      name: 'ConfigNotFoundError',
      code: 'CONFIG_NOT_FOUND',
      message: `${ErrorMessages.configNotFound()}: /w/.lingo-tracker.json`,
    },
    {
      error: new ConfigParseError('/w/.lingo-tracker.json', 'Unexpected token'),
      name: 'ConfigParseError',
      code: 'CONFIG_PARSE_FAILED',
      message: ErrorMessages.jsonParseFailed('/w/.lingo-tracker.json', 'Unexpected token'),
    },
    {
      error: new CollectionNotFoundError('app'),
      name: 'CollectionNotFoundError',
      code: 'COLLECTION_NOT_FOUND',
      message: ErrorMessages.collectionNotFound('app'),
    },
    {
      error: new CollectionAlreadyExistsError('app'),
      name: 'CollectionAlreadyExistsError',
      code: 'COLLECTION_ALREADY_EXISTS',
      message: ErrorMessages.collectionAlreadyExists('app'),
    },
    {
      error: new CollectionRequiredByBundleError('app', ['main', 'other']),
      name: 'CollectionRequiredByBundleError',
      code: 'COLLECTION_REQUIRED_BY_BUNDLE',
      message: ErrorMessages.collectionRequiredByBundles('app', ['main', 'other']),
    },
    {
      error: new CollectionRenameBundleConflictError('app', 'legacy', ['main', 'other']),
      name: 'CollectionRenameBundleConflictError',
      code: 'COLLECTION_RENAME_BUNDLE_CONFLICT',
      message: ErrorMessages.collectionRenameBundleConflict('app', 'legacy', ['main', 'other']),
    },
    {
      error: new ReadOnlyCollectionError('vendor'),
      name: 'ReadOnlyCollectionError',
      code: 'COLLECTION_READ_ONLY',
      message: ErrorMessages.collectionReadOnly('vendor'),
    },
    {
      error: new InvalidCollectionError('translationsFolder is required'),
      name: 'InvalidCollectionError',
      code: 'INVALID_COLLECTION',
      message: 'translationsFolder is required',
    },
    {
      error: new InvalidProjectTermsEditError('--add and --remove cannot be combined; run them separately'),
      name: 'InvalidProjectTermsEditError',
      code: 'INVALID_PROJECT_TERMS_EDIT',
      message: '--add and --remove cannot be combined; run them separately',
    },
    {
      error: new ProtectedTermsFileNotSetError('app'),
      name: 'ProtectedTermsFileNotSetError',
      code: 'PROTECTED_TERMS_FILE_NOT_SET',
      message: ErrorMessages.protectedTermsFileNotSet('app'),
    },
    {
      error: new ParentDirectoryMissingError('protected terms file', '/p/terms.json', '/p'),
      name: 'ParentDirectoryMissingError',
      code: 'PARENT_DIRECTORY_MISSING',
      message: 'Cannot write protected terms file — directory does not exist: /p',
    },
    {
      error: new InvalidLocaleError('x!', 'Invalid locale format: "x!"'),
      name: 'InvalidLocaleError',
      code: 'INVALID_LOCALE',
      message: 'Invalid locale format: "x!"',
    },
    {
      error: new LocaleNotFoundError('ja', 'app'),
      name: 'LocaleNotFoundError',
      code: 'LOCALE_NOT_FOUND',
      message: ErrorMessages.localeNotFound('ja', 'app'),
    },
    {
      error: new LocaleAlreadyExistsError('fr', 'app'),
      name: 'LocaleAlreadyExistsError',
      code: 'LOCALE_ALREADY_EXISTS',
      message: ErrorMessages.localeAlreadyExists('fr', 'app'),
    },
    {
      error: new BaseLocaleImmutableError('en'),
      name: 'BaseLocaleImmutableError',
      code: 'BASE_LOCALE_IMMUTABLE',
      message: ErrorMessages.cannotModifyBaseLocale('en'),
    },
    {
      error: new InvalidResourceKeyError('a..b', 'Key validation: Invalid key format "a..b"'),
      name: 'InvalidResourceKeyError',
      code: 'INVALID_RESOURCE_KEY',
      message: 'Key validation: Invalid key format "a..b"',
    },
    {
      error: new InvalidTranslationStatusError('verifed'),
      name: 'InvalidTranslationStatusError',
      code: 'INVALID_TRANSLATION_STATUS',
      message: 'Invalid translation status "verifed". Valid statuses: new, translated, stale, verified',
    },
    {
      error: new ResourceNotFoundError('common.ok'),
      name: 'ResourceNotFoundError',
      code: 'RESOURCE_NOT_FOUND',
      message: ErrorMessages.resourceNotFound('common.ok'),
    },
    {
      error: new ResourceAlreadyExistsError('common.ok'),
      name: 'ResourceAlreadyExistsError',
      code: 'RESOURCE_ALREADY_EXISTS',
      message: ErrorMessages.resourceAlreadyExists('common.ok'),
    },
    {
      error: new FolderNotFoundError('apps.common'),
      name: 'FolderNotFoundError',
      code: 'FOLDER_NOT_FOUND',
      message: ErrorMessages.folderNotFound('apps.common'),
    },
    {
      error: new FolderMoveIntoDescendantError('apps', 'apps.common'),
      name: 'FolderMoveIntoDescendantError',
      code: 'FOLDER_MOVE_INTO_DESCENDANT',
      message: ErrorMessages.folderMoveIntoDescendant('apps', 'apps.common'),
    },
    {
      error: new InvalidFolderPathError('folder name', 'a b'),
      name: 'InvalidFolderPathError',
      code: 'INVALID_FOLDER_PATH',
      message: 'Invalid folder name segment "a b". Segments must match pattern [A-Za-z0-9_-]+',
    },
    {
      error: new BundleNotFoundError('main'),
      name: 'BundleNotFoundError',
      code: 'BUNDLE_NOT_FOUND',
      message: ErrorMessages.bundleNotFound('main'),
    },
    {
      error: new AutoTranslationDisabledError('main'),
      name: 'AutoTranslationDisabledError',
      code: 'AUTO_TRANSLATION_DISABLED',
      message: ErrorMessages.autoTranslationDisabled('main'),
    },
    {
      error: new BundleAlreadyExistsError('main'),
      name: 'BundleAlreadyExistsError',
      code: 'BUNDLE_ALREADY_EXISTS',
      message: ErrorMessages.bundleAlreadyExists('main'),
    },
    {
      error: new InvalidBundleDefinitionError(['a', 'b']),
      name: 'InvalidBundleDefinitionError',
      code: 'INVALID_BUNDLE_DEFINITION',
      message: ErrorMessages.invalidBundleDefinition(['a', 'b']),
    },
    {
      error: new TranslationError('Rate limit exceeded', 'RATE_LIMIT', true),
      name: 'TranslationError',
      code: 'RATE_LIMIT',
      message: 'Rate limit exceeded',
    },
    {
      error: new PreferredTerminologyValidationError([]),
      name: 'PreferredTerminologyValidationError',
      code: 'INVALID_PREFERRED_TERMINOLOGY',
      message: 'Invalid preferred terminology rules: ',
    },
  ];

  it('requires a kind on every error class in the core errors module and the two external subclasses', () => {
    const additional = [
      new ImportSourceError('source failed'),
      new InvalidImportLocaleError('en', 'translation-service'),
      new GlossaryBaseLocaleMismatchError([
        { name: 'a', baseLocale: 'en' },
        { name: 'b', baseLocale: 'fr' },
      ]),
      new GlossaryNoCollectionsError(),
      new GlossaryExtractorError('unknown'),
      new ProtectedTermsFileError('/p/terms.json', 'bad terms'),
      new InvalidConfigError('bad config'),
      new ConfigChangedError(),
      new CannotTranslateBaseLocaleError('en'),
      new TranslationLocaleNotConfiguredError('ja', ['en']),
      new MultipleBundleConstantNameError(),
      new InvalidBundleLocalesError('bad locale'),
      new CoreOperationError('operation failed'),
    ];
    const instances = [...cases.map(({ error }) => error), ...additional];
    const defined = Object.entries(errorClasses)
      .filter(([, value]) => typeof value === 'function' && value.prototype instanceof LingoTrackerError)
      .map(([name]) => name)
      .concat('TranslationError', 'PreferredTerminologyValidationError')
      .sort();
    expect(instances.map((error) => error.constructor.name).sort()).toEqual(defined);
    for (const error of instances) {
      expect(error.kind).toMatch(/^(not-found|conflict|invalid|forbidden|unavailable|upstream|internal)$/);
    }
  });

  it.each(cases)('$name has its name, code and message, and is a LingoTrackerError', ({
    error,
    name,
    code,
    message,
  }) => {
    expect(error).toBeInstanceOf(LingoTrackerError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it('keeps the typed payload of each error', () => {
    expect(new ResourceNotFoundError('common.ok').key).toBe('common.ok');
    expect(new LocaleNotFoundError('ja', 'app')).toMatchObject({ locale: 'ja', collectionName: 'app' });
    expect(new InvalidFolderPathError('parent path', 'x y')).toMatchObject({ part: 'parent path', segment: 'x y' });
    expect(new InvalidBundleDefinitionError(['a']).errors).toEqual(['a']);
  });
});
