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
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import {
  BaseLocaleImmutableError,
  BundleAlreadyExistsError,
  BundleNotFoundError,
  CollectionNotFoundError,
  InvalidBundleDefinitionError,
  InvalidFolderPathError,
  InvalidLocaleError,
  InvalidResourceKeyError,
  LingoTrackerError,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  ReadOnlyCollectionError,
  ResourceNotFoundError,
  TranslationError,
} from '@simoncodes-ca/core';

/**
 * The HTTP answer for a typed core error. This is the only place the API maps a core
 * error to a status; controllers let core errors propagate.
 *
 * Some statuses are kept from before the mapping moved here, although they are not
 * what the class name suggests: locale conflicts and missing locales answer 400 (bundle
 * conflicts answer 409).
 *
 * Every mapped answer has the same `{ statusCode, message, error }` body.
 */
export function lingoTrackerErrorToHttp(error: LingoTrackerError): HttpException {
  const { message } = error;

  if (
    error instanceof CollectionNotFoundError ||
    error instanceof ResourceNotFoundError ||
    error instanceof BundleNotFoundError
  ) {
    return new NotFoundException(message);
  }
  if (error instanceof ReadOnlyCollectionError) {
    return new ForbiddenException(message);
  }
  if (error instanceof BundleAlreadyExistsError) {
    return new ConflictException(message);
  }
  if (error instanceof InvalidFolderPathError) {
    return new BadRequestException(`Validation error: ${message}`);
  }
  if (
    error instanceof InvalidResourceKeyError ||
    error instanceof InvalidLocaleError ||
    error instanceof LocaleNotFoundError ||
    error instanceof LocaleAlreadyExistsError ||
    error instanceof BaseLocaleImmutableError ||
    error instanceof InvalidBundleDefinitionError
  ) {
    return new BadRequestException(message);
  }
  if (error instanceof TranslationError) {
    return translationErrorToHttp(error);
  }
  return new InternalServerErrorException(message);
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
 * (`Internal server error`) that does not disclose the error's message.
 */
export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof LingoTrackerError) {
    return lingoTrackerErrorToHttp(error);
  }
  return new InternalServerErrorException('Internal server error');
}

/**
 * Global filter (registered with `APP_FILTER`). It turns typed core errors and unexpected
 * errors into HTTP exceptions with `toHttpException`, then lets Nest's base filter write
 * the body. An unexpected error is logged (message and stack) and answered with a generic
 * 500, so internal details stay on the server. Errors from HTTP middleware that carry their
 * own `statusCode` (body-parser, for example) keep Nest's default handling.
 */
@Catch()
export class LingoTrackerExceptionFilter extends BaseExceptionFilter {
  readonly #logger = new Logger(LingoTrackerExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException || exception instanceof LingoTrackerError) {
      super.catch(toHttpException(exception), host);
    } else if (exception instanceof Error && !('statusCode' in exception)) {
      this.#logger.error(exception.message, exception.stack);
      super.catch(toHttpException(exception), host);
    } else {
      super.catch(exception, host);
    }
  }
}
