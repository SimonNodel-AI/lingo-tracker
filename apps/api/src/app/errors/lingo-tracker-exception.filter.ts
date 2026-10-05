import {
  type ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  Catch,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { type ErrorCode, type ErrorKind, LingoTrackerError } from '@simoncodes-ca/core';
import type { ApiErrorCode } from './api-error-codes';

/**
 * The HTTP answer for a typed core error. This is the only place the API maps a core
 * error to a status; controllers let core errors propagate.
 *
 * Kind selects the default status. The API owns code-based presentation rules and
 * reads only domain facts (`code`, `field`, `details`), without subclass checks.
 *
 * Every mapped answer has the same `{ statusCode, message, error }` body. An invalid bundle
 * definition also carries `errors`, every problem the domain rules found, under the fixed
 * message `Invalid bundle definition`; invalid preferred-terminology rules carry the per-row
 * `errors` under `Invalid preferred terminology rules`. A runtime subclass with an unknown kind
 * is a 500 that keeps its message. An `InvalidConfigError`
 * (a `.lingo-tracker.json` the server cannot use), for example, says what to fix in the file.
 */
type HttpFactory = (message: string) => HttpException;

const HTTP_BY_KIND: Record<ErrorKind, HttpFactory> = {
  'not-found': (message) => new NotFoundException(message),
  conflict: (message) => new ConflictException(message),
  invalid: (message) => new BadRequestException(message),
  forbidden: (message) => new ForbiddenException(message),
  unavailable: (message) => new UnprocessableEntityException(message),
  upstream: (message) => new BadGatewayException(message),
  internal: (message) => new InternalServerErrorException(message),
};

interface HttpRule {
  readonly kind: ErrorKind;
  readonly message?: (error: LingoTrackerError) => string;
  readonly status?: HttpFactory;
  readonly includeDetails?: boolean;
}

/** HTTP presentation belongs to the API; the core error keeps its original message and code. */
type MappedCode = ErrorCode | ApiErrorCode;

const HTTP_BY_CODE = {
  INVALID_COLLECTION: {
    kind: 'invalid',
    message: (error) => ('field' in error && error.field !== undefined ? `collection.${error.message}` : error.message),
  },
  INVALID_BUNDLE_DEFINITION: { kind: 'invalid', message: () => 'Invalid bundle definition', includeDetails: true },
  INVALID_PREFERRED_TERMINOLOGY: {
    kind: 'invalid',
    message: () => 'Invalid preferred terminology rules',
    includeDetails: true,
  },
  INVALID_FOLDER_PATH: { kind: 'invalid', message: (error) => `Validation error: ${error.message}` },
  FOLDER_MOVE_INTO_DESCENDANT: { kind: 'invalid', message: (error) => `Validation error: ${error.message}` },
  INVALID_REQUEST: { kind: 'upstream', status: HTTP_BY_KIND.invalid },
  MISSING_API_KEY: { kind: 'upstream', status: HTTP_BY_KIND.internal },
  UNKNOWN_PROVIDER: { kind: 'upstream', status: HTTP_BY_KIND.internal },
  AUTH_ERROR: { kind: 'upstream', status: HTTP_BY_KIND.internal },
  RATE_LIMIT: {
    kind: 'upstream',
    status: (message) =>
      new HttpException(
        HttpException.createBody(message, 'Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
        HttpStatus.TOO_MANY_REQUESTS,
      ),
  },
  IMPORT_SOURCE_ERROR: { kind: 'internal' },
  INVALID_IMPORT_LOCALE: { kind: 'internal' },
  COLLECTION_BASE_LOCALE_MISMATCH: { kind: 'invalid' },
  GLOSSARY_NO_COLLECTIONS: { kind: 'internal' },
  GLOSSARY_EXTRACTOR_ERROR: { kind: 'internal' },
  CONFIG_NOT_FOUND: { kind: 'internal' },
  CONFIG_PARSE_FAILED: { kind: 'internal' },
  CONFIG_CHANGED: { kind: 'conflict' },
  INVALID_CONFIG: { kind: 'internal' },
  INVALID_PROTECTED_TERMS_FILE: { kind: 'internal' },
  INVALID_PROJECT_TERMS_EDIT: { kind: 'invalid' },
  COLLECTION_NOT_FOUND: { kind: 'not-found' },
  COLLECTION_ALREADY_EXISTS: { kind: 'conflict' },
  COLLECTION_REQUIRED_BY_BUNDLE: { kind: 'conflict' },
  COLLECTION_RENAME_BUNDLE_CONFLICT: { kind: 'conflict' },
  COLLECTION_READ_ONLY: { kind: 'forbidden' },
  INVALID_NAME: { kind: 'invalid' },
  PROTECTED_TERMS_FILE_NOT_SET: { kind: 'invalid' },
  PARENT_DIRECTORY_MISSING: { kind: 'invalid' },
  INVALID_TRANSLATION_STATUS: { kind: 'invalid' },
  INVALID_LOCALE: { kind: 'invalid' },
  LOCALE_NOT_FOUND: { kind: 'invalid' },
  LOCALE_ALREADY_EXISTS: { kind: 'invalid' },
  BASE_LOCALE_IMMUTABLE: { kind: 'invalid' },
  INVALID_RESOURCE_KEY: { kind: 'invalid' },
  RESOURCE_NOT_FOUND: { kind: 'not-found' },
  RESOURCE_ALREADY_EXISTS: { kind: 'conflict' },
  FOLDER_NOT_FOUND: { kind: 'not-found' },
  INVALID_COLLECTION_FOLDER: { kind: 'invalid' },
  AUTO_TRANSLATION_DISABLED: { kind: 'unavailable' },
  NO_TRANSLATION_TARGET_LOCALES: { kind: 'invalid' },
  CANNOT_TRANSLATE_BASE_LOCALE: { kind: 'invalid' },
  TRANSLATION_LOCALE_NOT_CONFIGURED: { kind: 'invalid' },
  MULTIPLE_BUNDLE_CONSTANT_NAME: { kind: 'internal' },
  BUNDLE_HIERARCHICAL_CONFLICT: { kind: 'invalid' },
  BUNDLE_NOT_FOUND: { kind: 'not-found' },
  INVALID_BUNDLE_LOCALES: { kind: 'invalid' },
  BUNDLE_ALREADY_EXISTS: { kind: 'conflict' },
  CORE_OPERATION_ERROR: { kind: 'internal' },
  INVALID_REQUEST_TIMEOUT: { kind: 'upstream' },
  INVALID_RESPONSE: { kind: 'upstream' },
  SERVER_ERROR: { kind: 'upstream' },
  TIMEOUT: { kind: 'upstream' },
  JOB_NOT_FOUND: { kind: 'not-found' },
} as const satisfies Record<MappedCode, HttpRule>;

const rules: Readonly<Partial<Record<string, HttpRule>>> = HTTP_BY_CODE;

export function lingoTrackerErrorToHttp(error: LingoTrackerError): HttpException {
  if (!error.exposeMessage) {
    return new InternalServerErrorException({ statusCode: 500, error: 'Internal Server Error' });
  }
  const candidate = rules[error.code];
  const rule = candidate?.kind === error.kind ? candidate : undefined;
  // TranslationError is the only core subclass with kind 'upstream'. Core's error
  // spec reserves that kind for it, so unknown provider codes keep the prefix and
  // default 502 without changing the existing open provider-code taxonomy.
  const message =
    error.kind === 'upstream'
      ? `Translation provider error: ${error.message}`
      : (rule?.message?.(error) ?? error.message);
  // A runtime subclass with an unrecognised kind retains the old typed 500 response.
  const mapper = rule?.status ?? HTTP_BY_KIND[error.kind] ?? HTTP_BY_KIND.internal;
  const http = mapper(message);
  if (!rule?.includeDetails || error.details === undefined) {
    return http;
  }
  const body = http.getResponse();
  return new HttpException(
    { ...(typeof body === 'string' ? { message: body } : body), errors: [...error.details] },
    http.getStatus(),
  );
}

/**
 * The HTTP answer for anything a handler throws: an `HttpException` as is, a
 * `LingoTrackerError` by `lingoTrackerErrorToHttp`, and anything else as a generic 500
 * whose body has no `message` at all (`{ statusCode, error }`), so a client that shows a
 * server message when there is one falls back to its own text for an undisclosed failure.
 */
export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof LingoTrackerError) {
    return lingoTrackerErrorToHttp(error);
  }
  const status = HttpStatus.INTERNAL_SERVER_ERROR;
  return new InternalServerErrorException({ statusCode: status, error: 'Internal Server Error' });
}

/**
 * Global filter (registered with `APP_FILTER`). It turns typed core errors and unexpected
 * errors into HTTP exceptions with `toHttpException`, then lets Nest's base filter write
 * the body. An unexpected error is logged (message and stack) and answered with a generic
 * 500 without a message, so internal details stay on the server. Errors from HTTP middleware that carry their
 * own `statusCode` (body-parser, for example) keep Nest's default handling.
 */
@Catch()
export class LingoTrackerExceptionFilter extends BaseExceptionFilter {
  readonly #logger = new Logger(LingoTrackerExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException || exception instanceof LingoTrackerError) {
      if (exception instanceof LingoTrackerError && !exception.exposeMessage) {
        this.#logger.error(exception.message, exception.stack);
      }
      super.catch(toHttpException(exception), host);
    } else if (exception instanceof Error && !('statusCode' in exception)) {
      this.#logger.error(exception.message, exception.stack);
      super.catch(toHttpException(exception), host);
    } else {
      super.catch(exception, host);
    }
  }
}
