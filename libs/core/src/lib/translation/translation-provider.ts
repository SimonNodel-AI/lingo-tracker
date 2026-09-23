/**
 * Core types and interfaces for the translation provider abstraction.
 *
 * Providers implement TranslationProvider to supply translation services
 * (e.g. Google Translate, DeepL) behind a consistent interface, enabling
 * the rest of the codebase to remain provider-agnostic.
 */

import { LingoTrackerError } from '../errors/lingo-tracker-error';

export interface TranslateRequest {
  readonly text: string;
  readonly sourceLocale: string;
  readonly targetLocale: string;
}

export interface TranslateResult {
  readonly translatedText: string;
  readonly detectedSourceLocale?: string;
  readonly provider: string;
}

export interface ProviderCapabilities {
  readonly supportsBatch: boolean;
  readonly maxBatchSize: number;
  readonly supportsFormality: boolean;
}

export interface TranslationProvider {
  translate(requests: TranslateRequest[]): Promise<TranslateResult[]>;
  getCapabilities(): ProviderCapabilities;
}

/**
 * Represents a failure that occurred during translation.
 *
 * The `retryable` flag indicates whether the caller can meaningfully
 * retry the operation (e.g. transient server errors) or whether retrying
 * would be pointless (e.g. invalid API key, malformed request).
 */
export class TranslationError extends LingoTrackerError {
  readonly retryable: boolean;
  readonly providerErrorCode: string | undefined;

  /** `code` names the failure kind, e.g. `MISSING_API_KEY`, `RATE_LIMIT`, `INVALID_REQUEST`. */
  constructor(message: string, code: string, retryable: boolean, providerErrorCode?: string) {
    super(message, code);
    this.retryable = retryable;
    this.providerErrorCode = providerErrorCode;
  }
}
