import * as definitions from './lingo-tracker-error';

import { createErrorCatalogue } from './error-catalogue';

// The abstract base has no domain code; TranslationError uses PROVIDER_ERROR_CATALOGUE instead.
const CATALOGUE_EXEMPTIONS = ['LingoTrackerError', 'TranslationError'] as const;

/** Every exported typed-error subclass registers unless it is explicitly exempt. */
export const ERROR_CATALOGUE = createErrorCatalogue(definitions, CATALOGUE_EXEMPTIONS);

type Catalogue = typeof ERROR_CATALOGUE;

type DomainCodes = { readonly [Name in keyof Catalogue as Catalogue[Name]['code']]: Catalogue[Name]['code'] };

/** The catalogue is the only source of domain code strings. */
export const ERROR_CODES = Object.fromEntries(
  Object.values(ERROR_CATALOGUE).map((ErrorClass) => [ErrorClass.code, ErrorClass.code]),
) as DomainCodes;

export type DomainErrorCode = keyof typeof ERROR_CODES;

/** Codes core's providers raise today; the taxonomy stays open (see ProviderErrorCode). */
export const PROVIDER_ERROR_CODES = definitions.PROVIDER_ERROR_CATALOGUE.codes;

export type KnownProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];
export type ProviderErrorCode = KnownProviderErrorCode | (string & {});

/** Closed set the API table must cover. */
export type ErrorCode = DomainErrorCode | KnownProviderErrorCode;
