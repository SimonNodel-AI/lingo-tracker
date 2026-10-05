import { describe, expect, it, vi } from 'vitest';
import type {
  ErrorCode,
  CollectionTagEditProblem,
  ProtectedTermsEditProblem,
  PreferredTerminologyEditProblem,
} from '@simoncodes-ca/core';
import * as core from '../../../../libs/core/src/lib/errors/lingo-tracker-error';
import { ERROR_CODES, PROVIDER_ERROR_CODES } from '../../../../libs/core/src/lib/errors/error-codes';
import { ADD_RESOURCE_COMMAND_NAME, cliErrorWording, printCliError, type CliErrorWording } from './cli-error-wording';
import { defineCommand, runCommand } from './command-runner';

interface Case {
  readonly error: core.LingoTrackerError;
  readonly wording: CliErrorWording;
}
function unchanged(error: core.LingoTrackerError): Case {
  return { error, wording: { message: error.message } };
}
function changed(error: core.LingoTrackerError, wording: CliErrorWording): Case {
  return { error, wording };
}

const cases = {
  AUTO_TRANSLATION_DISABLED: changed(new core.AutoTranslationDisabledError('main'), {
    message:
      'Auto-translation is not enabled for collection "main". Set translation.enabled = true in your configuration',
  }),
  BASE_LOCALE_IMMUTABLE: unchanged(new core.BaseLocaleImmutableError('en')),
  BUNDLE_ALREADY_EXISTS: unchanged(new core.BundleAlreadyExistsError('main')),
  BUNDLE_HIERARCHICAL_CONFLICT: unchanged(new core.BundleHierarchicalConflictError('main', ['a.b'])),
  BUNDLE_NOT_FOUND: changed(new core.BundleNotFoundError('main'), { message: 'Bundle "main" not found.' }),
  CANNOT_TRANSLATE_BASE_LOCALE: unchanged(new core.CannotTranslateBaseLocaleError('en')),
  COLLECTION_ALREADY_EXISTS: unchanged(new core.CollectionAlreadyExistsError('main')),
  COLLECTION_BASE_LOCALE_MISMATCH: unchanged(
    new core.CollectionBaseLocaleMismatchError([
      { name: 'a', baseLocale: 'en' },
      { name: 'b', baseLocale: 'fr' },
    ]),
  ),
  COLLECTION_NOT_FOUND: unchanged(new core.CollectionNotFoundError('main')),
  COLLECTION_READ_ONLY: unchanged(new core.ReadOnlyCollectionError('main')),
  COLLECTION_RENAME_BUNDLE_CONFLICT: unchanged(new core.CollectionRenameBundleConflictError('main', 'next', ['web'])),
  COLLECTION_REQUIRED_BY_BUNDLE: unchanged(new core.CollectionRequiredByBundleError('main', ['web'])),
  CONFIG_CHANGED: unchanged(new core.ConfigChangedError()),
  CONFIG_NOT_FOUND: changed(new core.ConfigNotFoundError('/project/.lingo-tracker.json'), {
    message: 'Configuration file .lingo-tracker.json not found.',
    hint: 'Run "lingo-tracker init" to initialize a project.',
  }),
  CONFIG_PARSE_FAILED: changed(new core.ConfigParseError('/project/.lingo-tracker.json', 'bad JSON'), {
    message: 'Failed to parse configuration file: bad JSON',
  }),
  CORE_OPERATION_ERROR: unchanged(new core.CoreOperationError('Read failed')),
  FOLDER_MOVE_INTO_DESCENDANT: unchanged(new core.FolderMoveIntoDescendantError('a', 'a.b')),
  FOLDER_NOT_FOUND: unchanged(new core.FolderNotFoundError('a.b')),
  GLOSSARY_EXTRACTOR_ERROR: changed(new core.GlossaryExtractorError('ai'), {
    message: 'The "ai" extractor is not yet implemented. Use --extractor ngram (the default).',
  }),
  GLOSSARY_NO_COLLECTIONS: unchanged(new core.GlossaryNoCollectionsError()),
  IMPORT_SOURCE_ERROR: changed(
    new core.ImportSourceError('Source unavailable', { cause: new Error('Source unavailable') }),
    {
      message: 'Import failed: Source unavailable',
      includeCause: false,
    },
  ),
  INVALID_BUNDLE_DEFINITION: unchanged(new core.InvalidBundleDefinitionError(['Missing dist'])),
  INVALID_BUNDLE_LOCALES: unchanged(new core.InvalidBundleLocalesError('Invalid locales')),
  INVALID_COLLECTION: unchanged(new core.InvalidCollectionError('Invalid collection')),
  INVALID_COLLECTION_FOLDER: unchanged(
    new core.InvalidCollectionFolderError({
      kind: 'unreadable',
      folderPath: 'a',
      absolutePath: '/project/a',
      message: 'denied',
    }),
  ),
  INVALID_CONFIG: unchanged(new core.InvalidConfigError('Invalid config')),
  INVALID_FOLDER_PATH: unchanged(new core.InvalidFolderPathError('folder path', 'bad..path')),
  INVALID_IMPORT_LOCALE: changed(new core.InvalidImportLocaleError('en', 'translation-service'), {
    message:
      'Import failed: Cannot import into base locale "en" with strategy "translation-service". Only "migration" strategy supports base locale imports.',
    includeCause: false,
  }),
  INVALID_LOCALE: unchanged(new core.InvalidLocaleError('bad', 'Invalid locale')),
  INVALID_NAME: unchanged(new core.InvalidNameError()),
  INVALID_PREFERRED_TERMINOLOGY: changed(
    new core.PreferredTerminologyValidationError(
      [{ index: 0, field: 'preferred', code: 'empty', message: 'required' }],
      [{ discouraged: 'old', preferred: '' }],
    ),
    {
      message: 'Preferred terminology not saved:',
      details: ['"old → ": required'],
    },
  ),
  INVALID_PROJECT_TERMS_EDIT: changed(new core.InvalidProjectTermsEditError('Missing edit', 'protected-missing'), {
    message: 'Provide at least one of --add, --remove, --set, --list, or --file',
  }),
  INVALID_PROTECTED_TERMS_FILE: unchanged(
    new core.ProtectedTermsFileError('/project/terms.json', 'Invalid protected terms'),
  ),
  INVALID_RESOURCE_KEY: unchanged(new core.InvalidResourceKeyError('bad..key', 'Invalid key')),
  INVALID_TRANSLATION_STATUS: unchanged(new core.InvalidTranslationStatusError('bad')),
  LOCALE_ALREADY_EXISTS: unchanged(new core.LocaleAlreadyExistsError('fr', 'main')),
  LOCALE_NOT_FOUND: unchanged(new core.LocaleNotFoundError('fr', 'main')),
  MULTIPLE_BUNDLE_CONSTANT_NAME: changed(new core.MultipleBundleConstantNameError(), {
    message: 'Cannot use --token-constant-name with multiple bundles. Please target a single bundle.',
  }),
  NO_TRANSLATION_TARGET_LOCALES: unchanged(new core.NoTranslationTargetLocalesError('en')),
  PARENT_DIRECTORY_MISSING: unchanged(
    new core.ParentDirectoryMissingError('Terms file', '/missing/terms.json', '/missing'),
  ),
  PROTECTED_TERMS_FILE_NOT_SET: changed(new core.ProtectedTermsFileNotSetError('main'), {
    message: 'Collection "main" has no protected terms file. Set one first with --file <path>.',
  }),
  RESOURCE_ALREADY_EXISTS: changed(new core.ResourceAlreadyExistsError('a.b'), {
    message: 'Resource already exists: a.b',
  }),
  RESOURCE_NOT_FOUND: unchanged(new core.ResourceNotFoundError('a.b')),
  TRANSLATION_LOCALE_NOT_CONFIGURED: unchanged(new core.TranslationLocaleNotConfiguredError('ja', ['en', 'fr'])),
  AUTH_ERROR: unchanged(new core.TranslationError('Provider failed', 'AUTH_ERROR', false)),
  INVALID_REQUEST: unchanged(new core.TranslationError('Provider failed', 'INVALID_REQUEST', false)),
  INVALID_REQUEST_TIMEOUT: unchanged(new core.TranslationError('Provider failed', 'INVALID_REQUEST_TIMEOUT', false)),
  INVALID_RESPONSE: unchanged(new core.TranslationError('Provider failed', 'INVALID_RESPONSE', false)),
  MISSING_API_KEY: unchanged(new core.TranslationError('Provider failed', 'MISSING_API_KEY', false)),
  RATE_LIMIT: unchanged(new core.TranslationError('Provider failed', 'RATE_LIMIT', false)),
  SERVER_ERROR: unchanged(new core.TranslationError('Provider failed', 'SERVER_ERROR', false)),
  TIMEOUT: unchanged(new core.TranslationError('Provider failed', 'TIMEOUT', false)),
  UNKNOWN_PROVIDER: unchanged(new core.TranslationError('Provider failed', 'UNKNOWN_PROVIDER', false)),
} satisfies Record<ErrorCode, Case>;

const termCases = {
  'protected-conflict': '--set cannot be combined with --add or --remove',
  'protected-missing': 'Provide at least one of --add, --remove, --set, --list, or --file',
  'protected-file-path': 'Core edit message',
  'protected-replacement-conflict': 'Core edit message',
  'preferred-missing': 'Provide one of --list, --add <discouraged> --preferred <preferred>, or --remove <discouraged>',
  'preferred-conflict': '--add and --remove cannot be combined; run them separately',
  'preferred-orphan-flags': '--preferred and --reason can only be used with --add',
  'preferred-incomplete-flags': '--add requires --preferred <preferred>',
  'preferred-remove-shape': 'Core edit message',
  'preferred-replacement-shape': 'Core edit message',
  'preferred-upsert-shape': 'Core edit message',
} satisfies Record<ProtectedTermsEditProblem | PreferredTerminologyEditProblem, string>;

const tagCases = {
  'tag-conflict': '--set-tags cannot be combined with --add-tag or --remove-tag',
  'tag-missing': 'Provide at least one of --add-tag, --remove-tag, or --set-tags',
} satisfies Record<CollectionTagEditProblem, string>;

/** Keep the closed key union for constructing errors in these contract cases. */
function entries<Key extends string, Value>(table: Record<Key, Value>): [Key, Value][] {
  return Object.entries(table) as [Key, Value][];
}

describe('CLI Error Wording contract', () => {
  it('pins every core and known provider code', () => {
    expect(Object.keys(cases).sort()).toEqual([...Object.keys(ERROR_CODES), ...PROVIDER_ERROR_CODES].sort());
    for (const [code, { error }] of Object.entries(cases)) expect(error.code).toBe(code);
  });

  it.each(Object.entries(cases))('formats %s and reports it through the runner', async (_code, { error, wording }) => {
    const before = { message: error.message, code: error.code, cause: error.cause };
    expect(cliErrorWording(error)).toEqual(wording);
    const hook = vi.fn(() => 'Command override');
    const command = defineCommand<object>()({
      name: 'Contract',
      collection: 'none',
      config: false,
      formatError: hook,
      run: () => {
        throw error;
      },
    });
    const result = await runCommand(command, {}, { cwd: process.cwd() });
    const details = wording.details?.map((detail) => `  ${detail}\n`).join('') ?? '';
    const hint = wording.hint ? `${wording.hint}\n` : '';
    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: `❌ ${wording.message}\n${details}${hint}` });
    expect(hook).not.toHaveBeenCalled();
    expect({ message: error.message, code: error.code, cause: error.cause }).toEqual(before);
  });

  it.each(entries(termCases))('formats project term problem %s', (problem, message) => {
    expect(cliErrorWording(new core.InvalidProjectTermsEditError('Core edit message', problem))).toEqual({ message });
  });

  it.each(entries(tagCases))('formats collection tag problem %s', (problem, message) => {
    expect(cliErrorWording(new core.InvalidCollectionError('Core edit message', { problem }))).toEqual({ message });
  });

  it('keeps format detection text without an import prefix or duplicate cause', () => {
    expect(
      cliErrorWording(
        new core.ImportSourceError('Unknown format', {
          stage: 'format',
          cause: new Error('Unknown format'),
        }),
      ),
    ).toEqual({ message: 'Unknown format', includeCause: false });
  });

  it('uses a row number when a terminology error has no submitted rule', () => {
    expect(
      cliErrorWording(
        new core.PreferredTerminologyValidationError([
          { index: 2, field: 'preferred', code: 'empty', message: 'required' },
        ]),
      ),
    ).toEqual({ message: 'Preferred terminology not saved:', details: ['row 3: required'] });
  });

  it('keeps unknown typed and provider codes and ignores ordinary failures', () => {
    class FutureError extends core.LingoTrackerError {
      readonly kind = 'internal' as const;
    }
    expect(cliErrorWording(new FutureError('Future failure', 'FUTURE_CODE'))).toEqual({ message: 'Future failure' });
    expect(cliErrorWording(new core.TranslationError('Future provider', 'FUTURE_PROVIDER', false))).toEqual({
      message: 'Future provider',
    });
    expect(cliErrorWording(new FutureError('Own property only', 'toString'))).toEqual({ message: 'Own property only' });
    expect(cliErrorWording(new Error('Plain error'))).toBeUndefined();
    expect(cliErrorWording('Thrown text')).toBeUndefined();
  });

  it.each(['preflight', 'prompts', 'run'] as const)('keeps command hooks for ordinary %s failures', async (stage) => {
    const error = new Error('Command failure');
    const hook = vi.fn(() => 'Command-specific text');
    const fail = () => {
      throw error;
    };
    const command = defineCommand<object>()({
      name: 'Contract',
      collection: 'none',
      config: false,
      formatError: hook,
      ...(stage === 'preflight' ? { preflight: fail } : stage === 'prompts' ? { prompts: fail } : {}),
      run: stage === 'run' ? fail : () => undefined,
    });
    expect(await runCommand(command, {}, { cwd: process.cwd() })).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: '❌ Command-specific text\n',
    });
    expect(hook).toHaveBeenCalledWith(error, stage === 'run');
  });

  it.each([
    ADD_RESOURCE_COMMAND_NAME,
    'Edit resource',
    'Add resources',
  ])('scopes existing-key advice for %s', async (name) => {
    const error = new core.ResourceAlreadyExistsError('a.b');
    const command = defineCommand<object>()({
      name,
      collection: 'none',
      config: false,
      run: () => {
        throw error;
      },
    });
    const result = await runCommand(command, {}, { cwd: process.cwd() });
    const hint =
      name === ADD_RESOURCE_COMMAND_NAME ? '  Use --override to replace it, or edit-resource to change it.\n' : '';
    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: `❌ Resource already exists: a.b\n${hint}` });
  });

  it.each([
    [
      new core.ConfigNotFoundError('/project/.lingo-tracker.json'),
      '❌ Configuration file .lingo-tracker.json not found.\nRun "lingo-tracker init" to initialize a project.\n',
    ],
    [
      new core.PreferredTerminologyValidationError([
        { index: 0, field: 'preferred', code: 'empty', message: 'required' },
      ]),
      '❌ Preferred terminology not saved:\n  row 1: required\n',
    ],
    [
      new core.InvalidConfigError('Invalid config', { cause: new Error('Underlying reason') }),
      '❌ Invalid config\n  Underlying reason\n',
    ],
  ] as const)('prints complete diagnostics directly for %p', async (error, stderr) => {
    const command = defineCommand<object>()({
      name: 'Direct print',
      collection: 'none',
      config: false,
      run: () => {
        printCliError(error);
        return { exitCode: 1 };
      },
    });
    expect(await runCommand(command, {}, { cwd: process.cwd() })).toEqual({ exitCode: 1, stdout: '', stderr });
  });
});
