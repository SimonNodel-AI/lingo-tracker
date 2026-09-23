import { describe, expect, it } from 'vitest';
import { PreferredTerminologyValidationError } from '../config/preferred-terminology-file';
import { TranslationError } from '../translation/translation-provider';
import { ErrorMessages } from './error-messages';
import {
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  ConfigNotFoundError,
  ConfigParseError,
  InvalidBundleDefinitionError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ReadOnlyCollectionError,
  ResourceNotFoundError,
} from './lingo-tracker-error';

describe('LingoTrackerError subclasses', () => {
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
      error: new ReadOnlyCollectionError('vendor'),
      name: 'ReadOnlyCollectionError',
      code: 'COLLECTION_READ_ONLY',
      message: ErrorMessages.collectionReadOnly('vendor'),
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
      error: new ResourceNotFoundError('common.ok'),
      name: 'ResourceNotFoundError',
      code: 'RESOURCE_NOT_FOUND',
      message: ErrorMessages.resourceNotFound('common.ok'),
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
