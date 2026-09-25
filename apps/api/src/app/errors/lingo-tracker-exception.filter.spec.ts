import { Controller, Get, HttpException, type INestApplication, Logger, NotFoundException } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  AutoTranslationDisabledError,
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionNotFoundError,
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  InvalidBundleDefinitionError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ProtectedTermsFileError,
  ReadOnlyCollectionError,
  ResourceAlreadyExistsError,
  ResourceNotFoundError,
  TranslationError,
} from '@simoncodes-ca/core';
import { LingoTrackerExceptionFilter, toHttpException } from './lingo-tracker-exception.filter';

describe('toHttpException', () => {
  it.each([
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
      new InvalidBundleDefinitionError(['a', 'b']),
      400,
      { message: 'Invalid bundle definition', error: 'Bad Request', statusCode: 400, errors: ['a', 'b'] },
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
    [
      new LingoTrackerError('Unmapped', 'UNMAPPED'),
      500,
      { message: 'Unmapped', error: 'Internal Server Error', statusCode: 500 },
    ],
    [
      new Error('Disk write failure'),
      500,
      { message: 'Internal server error', error: 'Internal Server Error', statusCode: 500 },
    ],
    ['not an error', 500, { message: 'Internal server error', error: 'Internal Server Error', statusCode: 500 }],
  ])('maps %p to %i', (error, status, response) => {
    const http = toHttpException(error);

    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toEqual(response);
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

  it('answers an unexpected error with a generic 500 that hides its message, and logs it', async () => {
    await expect(get('plain')).resolves.toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' },
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
