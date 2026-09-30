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
import {
  type ErrorKind,
  FolderMoveIntoDescendantError,
  InvalidBundleDefinitionError,
  InvalidFolderPathError,
  LingoTrackerError,
  PreferredTerminologyValidationError,
  TranslationError,
} from '@simoncodes-ca/core';

/**
 * The HTTP answer for a typed core error. This is the only place the API maps a core
 * error to a status; controllers let core errors propagate.
 *
 * Locale conflicts and missing locales declare `invalid`, retaining their 400 answers.
 *
 * Every mapped answer has the same `{ statusCode, message, error }` body. An invalid bundle
 * definition also carries `errors`, every problem the domain rules found, under the fixed
 * message `Invalid bundle definition`; invalid preferred-terminology rules carry the per-row
 * `errors` under `Invalid preferred terminology rules`. A runtime subclass with an unknown kind
 * is a 500 that keeps its message. An `InvalidConfigError`
 * (a `.lingo-tracker.json` the server cannot use), for example, says what to fix in the file.
 */
const HTTP_BY_KIND: Record<ErrorKind, (message: string) => HttpException> = {
  'not-found': (message) => new NotFoundException(message),
  conflict: (message) => new ConflictException(message),
  invalid: (message) => new BadRequestException(message),
  forbidden: (message) => new ForbiddenException(message),
  unavailable: (message) => new UnprocessableEntityException(message),
  upstream: (message) => new BadGatewayException(message),
  internal: (message) => new InternalServerErrorException(message),
};

export function lingoTrackerErrorToHttp(error: LingoTrackerError): HttpException {
  if (!error.exposeMessage) {
    return new InternalServerErrorException({ statusCode: 500, error: 'Internal Server Error' });
  }
  if (error instanceof InvalidBundleDefinitionError) {
    return invalidBundleDefinitionToHttp(error);
  }
  if (error instanceof PreferredTerminologyValidationError) {
    return withErrors('Invalid preferred terminology rules', error.errors);
  }
  if (error instanceof InvalidFolderPathError || error instanceof FolderMoveIntoDescendantError) {
    return HTTP_BY_KIND.invalid(`Validation error: ${error.message}`);
  }
  if (error instanceof TranslationError) {
    return translationErrorToHttp(error);
  }
  // A runtime subclass with an unrecognised kind retains the old typed 500 response.
  const mapper = HTTP_BY_KIND[error.kind];
  return mapper ? mapper(error.message) : new InternalServerErrorException(error.message);
}

function invalidBundleDefinitionToHttp(error: InvalidBundleDefinitionError): HttpException {
  return withErrors('Invalid bundle definition', error.errors);
}

/** A 400 whose body also lists every problem found. */
function withErrors(message: string, errors: readonly unknown[]): HttpException {
  const status = HttpStatus.BAD_REQUEST;
  return new BadRequestException({ ...HttpException.createBody(message, 'Bad Request', status), errors: [...errors] });
}

/** Translation codes that mean the server's translation setup is wrong, not the request. */
const TRANSLATION_CONFIGURATION_CODES: ReadonlySet<string> = new Set([
  'MISSING_API_KEY',
  'UNKNOWN_PROVIDER',
  'AUTH_ERROR',
]);

function translationErrorToHttp(error: TranslationError): HttpException {
  const message = `Translation provider error: ${error.message}`;

  if (error.code === 'INVALID_REQUEST') {
    return new BadRequestException(message);
  }
  if (TRANSLATION_CONFIGURATION_CODES.has(error.code)) {
    return new InternalServerErrorException(message);
  }
  if (error.code === 'RATE_LIMIT') {
    const status = HttpStatus.TOO_MANY_REQUESTS;
    return new HttpException(HttpException.createBody(message, 'Too Many Requests', status), status);
  }
  return new BadGatewayException(message);
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
