import { Controller, Get, HttpException, type INestApplication, Logger, NotFoundException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as core from '@simoncodes-ca/core';
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
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  ImportSourceError,
  InvalidBundleDefinitionError,
  InvalidBundleLocalesError,
  InvalidCollectionError,
  InvalidCollectionFolderError,
  InvalidConfigError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidProjectTermsEditError,
  InvalidResourceKeyError,
  InvalidTranslationStatusError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  MultipleBundleConstantNameError,
  ParentDirectoryMissingError,
  PreferredTerminologyValidationError,
  ProtectedTermsFileError,
  ProtectedTermsFileNotSetError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
  TranslationError,
  TranslationLocaleNotConfiguredError,
} from '@simoncodes-ca/core';
// Pin core-internal subclasses too. The public alias resolves to this same source via tsconfig.base paths.
import * as internalErrors from '../../../../../libs/core/src/lib/errors/lingo-tracker-error';
import { LingoTrackerExceptionFilter, toHttpException } from './lingo-tracker-exception.filter';

describe('toHttpException', () => {
  const cases = [
    [
      new CollectionNotFoundError('app'),
      404,
      { message: 'Collection "app" not found', error: 'Not Found', statusCode: 404 },
    ],
    [
      new ResourceNotFoundError('a.b'),
      404,
      { message: 'Resource not found: a.b', error: 'Not Found', statusCode: 404 },
    ],
    [
      new FolderNotFoundError('apps.missing'),
      404,
      { message: 'Folder not found: apps.missing', error: 'Not Found', statusCode: 404 },
    ],
    [new BundleNotFoundError('main'), 404, { message: 'Bundle "main" not found', error: 'Not Found', statusCode: 404 }],
    [
      new ConfigChangedError(),
      409,
      {
        message: 'The configuration file changed after it was read; run the command again',
        error: 'Conflict',
        statusCode: 409,
      },
    ],
    [
      new InvalidBundleLocalesError('Unknown locale "xx": must be defined in the project locales'),
      400,
      {
        message: 'Unknown locale "xx": must be defined in the project locales',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new ReadOnlyCollectionError('vendor'),
      403,
      {
        message: 'Collection "vendor" is read-only. Its resources cannot be modified.',
        error: 'Forbidden',
        statusCode: 403,
      },
    ],
    [
      new BundleAlreadyExistsError('main'),
      409,
      { message: 'Bundle "main" already exists', error: 'Conflict', statusCode: 409 },
    ],
    [
      new ResourceAlreadyExistsError('apps.ok'),
      409,
      { message: 'Resource already exists: apps.ok', error: 'Conflict', statusCode: 409 },
    ],
    [
      new CollectionAlreadyExistsError('app'),
      409,
      { message: 'Collection "app" already exists', error: 'Conflict', statusCode: 409 },
    ],
    [
      new CollectionRequiredByBundleError('app', ['main', 'other']),
      409,
      {
        message:
          'Collection "app" is the only collection of bundle(s) "main", "other". Remove it from those bundles or delete them first.',
        error: 'Conflict',
        statusCode: 409,
      },
    ],
    [
      new CollectionRenameBundleConflictError('app', 'legacy', ['main', 'other']),
      409,
      {
        message:
          'Cannot rename collection "app" to "legacy": bundle(s) "main", "other" already reference "legacy". Remove those references first.',
        error: 'Conflict',
        statusCode: 409,
      },
    ],
    [
      new AutoTranslationDisabledError('app'),
      422,
      {
        message: 'Auto-translation is not enabled for collection "app"',
        error: 'Unprocessable Entity',
        statusCode: 422,
      },
    ],
    [
      new InvalidFolderPathError('folder name', 'a b'),
      400,
      {
        message: 'Validation error: Invalid folder name segment "a b". Segments must match pattern [A-Za-z0-9_-]+',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new FolderMoveIntoDescendantError('apps.common', 'apps.common.buttons'),
      400,
      {
        message: 'Validation error: Cannot move folder "apps.common" into its own descendant "apps.common.buttons"',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new InvalidResourceKeyError('a..b', 'Key validation: bad'),
      400,
      { message: 'Key validation: bad', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new InvalidTranslationStatusError('verifed'),
      400,
      {
        message: 'Invalid translation status "verifed". Valid statuses: new, translated, stale, verified',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new InvalidLocaleError('x!', 'Invalid locale format: "x!"'),
      400,
      { message: 'Invalid locale format: "x!"', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new LocaleNotFoundError('ja', 'app'),
      400,
      { message: 'Locale "ja" not found in collection "app"', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new LocaleAlreadyExistsError('fr', 'app'),
      400,
      { message: 'Locale "fr" already exists in collection "app"', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new BaseLocaleImmutableError('en'),
      400,
      { message: 'Cannot add or remove the base locale "en"', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new CannotTranslateBaseLocaleError('en'),
      400,
      { message: 'Cannot translate to the base locale "en".', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new TranslationLocaleNotConfiguredError('ja', ['en', 'fr']),
      400,
      { message: 'Locale "ja" is not configured. Available locales: en, fr', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new InvalidBundleDefinitionError(['a', 'b']),
      400,
      { message: 'Invalid bundle definition', error: 'Bad Request', statusCode: 400, errors: ['a', 'b'] },
    ],
    [
      new PreferredTerminologyValidationError([{ index: 0, field: 'preferred', code: 'empty', message: 'empty' }]),
      400,
      {
        message: 'Invalid preferred terminology rules',
        error: 'Bad Request',
        statusCode: 400,
        errors: [{ index: 0, field: 'preferred', code: 'empty', message: 'empty' }],
      },
    ],
    [
      new InvalidCollectionFolderError({
        kind: 'unreadable',
        folderPath: 'link',
        absolutePath: '/translations/link',
        message: 'This folder is a symbolic link and is not part of the collection',
      }),
      400,
      {
        message: "Cannot access folder 'link': This folder is a symbolic link and is not part of the collection",
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new InvalidCollectionError('translationsFolder is required'),
      400,
      { message: 'translationsFolder is required', error: 'Bad Request', statusCode: 400 },
    ],
    [
      new InvalidProjectTermsEditError(
        'Only one preferred terminology edit can be applied at a time',
        'preferred-conflict',
      ),
      400,
      {
        message: 'Only one preferred terminology edit can be applied at a time',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new ProtectedTermsFileNotSetError('app'),
      400,
      {
        message: 'Collection "app" has no protected terms file. Set a file path first.',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new ParentDirectoryMissingError('protected terms file', '/p/terms.json', '/p'),
      400,
      {
        message: 'Cannot write protected terms file — directory does not exist: /p',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new ProtectedTermsFileError('/p/terms.json', 'Protected terms file is not valid JSON: /p/terms.json'),
      500,
      {
        message: 'Protected terms file is not valid JSON: /p/terms.json',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    // Any other typed error is a 500 that keeps its message.
    [
      new InvalidConfigError('"preferredTerminologyFile" in .lingo-tracker.json must be a string path (got number)'),
      500,
      {
        message: '"preferredTerminologyFile" in .lingo-tracker.json must be a string path (got number)',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    [
      new ConfigNotFoundError('/p/.lingo-tracker.json'),
      500,
      {
        message: 'LingoTracker configuration file (.lingo-tracker.json) not found: /p/.lingo-tracker.json',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    [
      new ConfigParseError('/p/.lingo-tracker.json', 'bad JSON'),
      500,
      {
        message: 'Failed to parse JSON file /p/.lingo-tracker.json: bad JSON',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    [
      new ImportSourceError('Source file not found: /p/source.json'),
      500,
      { message: 'Source file not found: /p/source.json', error: 'Internal Server Error', statusCode: 500 },
    ],
    [
      new MultipleBundleConstantNameError(),
      500,
      {
        message: 'A token constant name override needs exactly one bundle.',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    [
      new internalErrors.InvalidImportLocaleError('en', 'translation-service'),
      500,
      {
        message:
          'Cannot import into base locale "en" with strategy "translation-service". Only "migration" strategy supports base locale imports.',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    [
      new internalErrors.CollectionBaseLocaleMismatchError([
        { name: 'a', baseLocale: 'en' },
        { name: 'b', baseLocale: 'fr' },
      ]),
      400,
      {
        message: 'Cannot combine collections with different base locales (a: en, b: fr). Run them separately.',
        error: 'Bad Request',
        statusCode: 400,
      },
    ],
    [
      new internalErrors.GlossaryNoCollectionsError(),
      500,
      { message: 'Cannot build a glossary without collections.', error: 'Internal Server Error', statusCode: 500 },
    ],
    [
      new internalErrors.GlossaryExtractorError('ai'),
      500,
      {
        message: 'The "ai" extractor is not yet implemented; use the "ngram" extractor (the default).',
        error: 'Internal Server Error',
        statusCode: 500,
      },
    ],
    [
      new internalErrors.CoreOperationError('Failed to read file /private/config.json'),
      500,
      { error: 'Internal Server Error', statusCode: 500 },
    ],
    [
      new (class UnmappedError extends LingoTrackerError {
        readonly kind = 'internal' as const;
      })('Unmapped', 'UNMAPPED'),
      500,
      { message: 'Unmapped', error: 'Internal Server Error', statusCode: 500 },
    ],
    // Not typed: nothing about it is safe to disclose, so the body carries no message at all.
    [new Error('Disk write failure'), 500, { error: 'Internal Server Error', statusCode: 500 }],
    ['not an error', 500, { error: 'Internal Server Error', statusCode: 500 }],
  ] as const;

  it.each(cases)('maps %p to %i', (error, status, response) => {
    const http = toHttpException(error);

    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toEqual(response);
  });

  it('maps a missing move destination with its destination-specific message', () => {
    const http = toHttpException(new CollectionNotFoundError('app', 'destination'));
    expect(http.getStatus()).toBe(404);
    expect(http.getResponse()).toEqual({
      statusCode: 404,
      message: 'Destination collection "app" not found',
      error: 'Not Found',
    });
  });

  it('prefixes collection field-shape messages', () => {
    const http = toHttpException(
      new InvalidCollectionError('translationsFolder is required', { field: 'translationsFolder' }),
    );
    expect(http.getStatus()).toBe(400);
    expect(http.getResponse()).toEqual({
      message: 'collection.translationsFolder is required',
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('pins every public and internal core error subclass', () => {
    const errorExports = [...Object.entries(core), ...Object.entries(internalErrors)];
    const exported = [
      ...new Set(
        errorExports
          .filter(([, value]) => typeof value === 'function' && value.prototype instanceof LingoTrackerError)
          .map(([name]) => name),
      ),
    ].sort();
    const pinned = cases
      .map(([error]) => error)
      .filter((error): error is LingoTrackerError => error instanceof LingoTrackerError)
      .map((error) => error.constructor.name)
      .filter((name) => name !== 'UnmappedError')
      // Its code-dependent responses are pinned in the TranslationError table below.
      .concat('TranslationError')
      .sort();
    expect(pinned).toEqual(exported);
    for (const name of exported) {
      if (name === 'TranslationError') {
        expect(new TranslationError('Provider said no', 'SERVER_ERROR', false).kind).toBe('upstream');
        continue;
      }
      const instance = cases.map(([error]) => error).find((error) => error?.constructor.name === name);
      expect(instance).toBeInstanceOf(LingoTrackerError);
      expect((instance as LingoTrackerError).kind).toMatch(
        /^(not-found|conflict|invalid|forbidden|unavailable|upstream|internal)$/,
      );
    }
  });

  it.each([
    ['INVALID_REQUEST', 400, 'Bad Request'],
    ['MISSING_API_KEY', 500, 'Internal Server Error'],
    ['UNKNOWN_PROVIDER', 500, 'Internal Server Error'],
    ['AUTH_ERROR', 500, 'Internal Server Error'],
    ['RATE_LIMIT', 429, 'Too Many Requests'],
    ['SERVER_ERROR', 502, 'Bad Gateway'],
    ['SOMETHING_NEW', 502, 'Bad Gateway'],
  ])('maps a TranslationError with code %s to %i', (code, status, error) => {
    const http = toHttpException(new TranslationError('Provider said no', code, false));

    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toEqual({
      message: 'Translation provider error: Provider said no',
      error,
      statusCode: status,
    });
  });

  it('returns an HttpException unchanged', () => {
    const exception = new NotFoundException('Path "x" not found in collection tree');

    expect(toHttpException(exception)).toBe(exception);
  });

  it('keeps a formerly plain core failure hidden in the HTTP body', () => {
    class HiddenCoreError extends LingoTrackerError {
      readonly kind = 'internal' as const;
      override readonly exposeMessage = false;
    }
    const http = toHttpException(new HiddenCoreError('Failed to write /private/file', 'CORE_OPERATION_ERROR'));
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toEqual({ statusCode: 500, error: 'Internal Server Error' });
  });

  it('keeps the message of a typed error with an unknown runtime kind', () => {
    class FutureError extends LingoTrackerError {
      readonly kind = 'internal' as const;
    }
    const error = new FutureError('Future failure', 'FUTURE_FAILURE');
    Object.defineProperty(error, 'kind', { value: 'future-kind' });

    const http = toHttpException(error);
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toEqual({ statusCode: 500, message: 'Future failure', error: 'Internal Server Error' });
  });

  it('hides domain details when the error does not expose its message', () => {
    class HiddenDetailedError extends LingoTrackerError {
      readonly kind = 'invalid' as const;
      override readonly exposeMessage = false;
      override readonly details = ['private detail'];
    }
    const http = toHttpException(new HiddenDetailedError('Private failure', 'PRIVATE'));
    expect(http.getStatus()).toBe(500);
    expect(http.getResponse()).toEqual({ statusCode: 500, error: 'Internal Server Error' });
  });

  it('maps a new domain error subclass by code and details', () => {
    class DetailedValidationError extends LingoTrackerError {
      readonly kind = 'invalid' as const;
      override readonly details = ['first problem'];
    }
    const error = new DetailedValidationError('Original domain message', 'INVALID_BUNDLE_DEFINITION');
    const http = toHttpException(error);
    expect(error.message).toBe('Original domain message');
    expect(http.getStatus()).toBe(400);
    expect(http.getResponse()).toEqual({
      message: 'Invalid bundle definition',
      error: 'Bad Request',
      statusCode: 400,
      errors: ['first problem'],
    });
  });

  it('does not treat provider codes on non-upstream errors as translation failures', () => {
    class LocalError extends LingoTrackerError {
      readonly kind = 'conflict' as const;
    }
    const http = toHttpException(new LocalError('Local failure', 'RATE_LIMIT'));
    expect(http.getStatus()).toBe(409);
    expect(http.getResponse()).toEqual({ message: 'Local failure', error: 'Conflict', statusCode: 409 });
  });
});

@Controller('throw')
class ThrowingController {
  @Get('resource')
  resource(): never {
    throw new ResourceNotFoundError('a.b');
  }

  @Get('locale')
  locale(): never {
    throw new LocaleAlreadyExistsError('fr', 'app');
  }

  @Get('http')
  http(): never {
    throw new HttpException('Auto-translation is not enabled for this collection', 422);
  }

  @Get('plain')
  plain(): never {
    throw new Error('Disk write failure');
  }

  @Get('status-code')
  statusCode(): never {
    throw Object.assign(new Error('request entity too large'), { statusCode: 413 });
  }
}

describe('LingoTrackerExceptionFilter (registered with APP_FILTER)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let loggerError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
      providers: [{ provide: APP_FILTER, useClass: LingoTrackerExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    const response = await fetch(`${baseUrl.replace('[::1]', 'localhost')}/throw/${path}`);
    return { status: response.status, body: await response.json() };
  };

  it('answers a typed core error with its mapped status and the Nest body', async () => {
    await expect(get('resource')).resolves.toEqual({
      status: 404,
      body: { message: 'Resource not found: a.b', error: 'Not Found', statusCode: 404 },
    });
    await expect(get('locale')).resolves.toEqual({
      status: 400,
      body: { statusCode: 400, message: 'Locale "fr" already exists in collection "app"', error: 'Bad Request' },
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('passes an HttpException through', async () => {
    await expect(get('http')).resolves.toEqual({
      status: 422,
      body: { statusCode: 422, message: 'Auto-translation is not enabled for this collection' },
    });
  });

  it('answers an unexpected error with a generic 500 that carries no message, and logs it', async () => {
    await expect(get('plain')).resolves.toEqual({
      status: 500,
      body: { statusCode: 500, error: 'Internal Server Error' },
    });
    expect(loggerError).toHaveBeenCalledWith('Disk write failure', expect.any(String));
  });

  it("leaves an error that carries its own statusCode to Nest's default handling", async () => {
    await expect(get('status-code')).resolves.toEqual({
      status: 413,
      body: { statusCode: 413, message: 'request entity too large' },
    });
  });
});
