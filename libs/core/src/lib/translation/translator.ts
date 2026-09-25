/**
 * Translator — the one way core machine-translates text for a collection.
 *
 * Opened from a resolved Collection, it owns everything the callers used to repeat:
 *
 * - **Setup**: the collection's translation config must be enabled, and the provider is built
 *   from it (`createTranslationProvider`, API key read from `process.env[apiKeyEnv]`) unless one
 *   is injected.
 * - **ICU skip**: complex ICU (plural, select, number, date, time) is never sent to the provider.
 * - **Placeholder guard**: simple placeholders (`{name}`, `{{ name }}`) are sent as notranslate
 *   markers and restored afterwards; a translation that loses or duplicates a marker is skipped.
 * - **Protected-term guard**: a translation that drops a protected term present in the source
 *   (the collection's terms in force, read once when the Translator is opened) is skipped, as
 *   import would reject it.
 * - **Normalisation**: every returned value is ICU (`translocoToICU`).
 *
 * Callers decide which entries and locales need work (the Staleness rule) and what to store.
 *
 * @module translator
 */

import { classifyICUContent, findProtectedTermViolations, translocoToICU } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { readProtectedTermsInForce } from '../config/protected-terms-file';
import { AutoTranslationDisabledError } from '../errors/lingo-tracker-error';
import { type ExtractedPlaceholder, protectPlaceholders, restorePlaceholders } from './placeholder-protector';
import { TranslationError, type TranslationProvider } from './translation-provider';
import { createTranslationProvider } from './translation-provider-factory';

/** One text to translate. `key` is the caller's identifier (for example the full resource key). */
export interface TranslatorEntry {
  readonly key: string;
  /** The base value (ICU or Transloco syntax). */
  readonly source: string;
}

/** A translation that passed every guard, normalised to ICU. */
export interface TranslatedValue {
  readonly key: string;
  readonly locale: string;
  readonly value: string;
}

/**
 * Why an entry was not translated for a locale:
 * - `complex-icu` — plural, select, or another complex ICU construct; never sent to the provider.
 * - `placeholder-mismatch` — the provider lost or duplicated a placeholder marker.
 * - `protected-term` — the translation dropped a protected term present in the source.
 */
export type TranslationSkipReason = 'complex-icu' | 'placeholder-mismatch' | 'protected-term';

export interface SkippedTranslation {
  readonly key: string;
  readonly locale: string;
  readonly reason: TranslationSkipReason;
  /** The protected terms the translation dropped (reason `protected-term` only). */
  readonly terms?: readonly string[];
}

export interface TranslationOutcome {
  readonly values: TranslatedValue[];
  readonly skipped: SkippedTranslation[];
}

export interface Translator {
  /**
   * Translates every entry into every locale: one provider call per locale (the provider chunks
   * internally), locales in parallel. The base locale is ignored. Results are ordered by locale,
   * then by entry.
   *
   * @throws {TranslationError} The provider failed.
   */
  translate(entries: readonly TranslatorEntry[], locales: readonly string[]): Promise<TranslationOutcome>;
}

export interface OpenTranslatorOptions {
  /** The provider to use instead of the one the collection's translation config names. */
  readonly provider?: TranslationProvider;
  /** The protected terms to guard instead of the collection's terms files. */
  readonly protectedTerms?: readonly string[];
}

/**
 * Opens the Translator for a collection.
 *
 * @throws {AutoTranslationDisabledError} The collection has no enabled translation config.
 * @throws {TranslationError} No provider was injected and the API key env var is unset
 *   (`MISSING_API_KEY`) or the provider name is unknown (`UNKNOWN_PROVIDER`).
 * @throws {ProtectedTermsFileError} No terms were passed and a terms file is not a JSON array of strings.
 */
export function openTranslator(collection: Collection, options: OpenTranslatorOptions = {}): Translator {
  const config = collection.translationConfig;
  if (!config?.enabled) {
    throw new AutoTranslationDisabledError(collection.name);
  }

  const provider = options.provider ?? createTranslationProvider(config.provider, readApiKey(config.apiKeyEnv));
  const protectedTerms = options.protectedTerms ?? readProtectedTermsInForce(collection);
  const { baseLocale } = collection;

  return {
    async translate(entries, locales) {
      const prepared = entries.map(prepare);
      const targets = [...new Set(locales)].filter((locale) => locale !== baseLocale);
      const perLocale = await Promise.all(
        targets.map((locale) => translateForLocale(provider, prepared, baseLocale, locale, protectedTerms)),
      );
      return {
        values: perLocale.flatMap(({ values }) => values),
        skipped: perLocale.flatMap(({ skipped }) => skipped),
      };
    },
  };
}

function readApiKey(apiKeyEnv: string): string {
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new TranslationError(
      `Translation API key not found. Set the ${apiKeyEnv} environment variable.`,
      'MISSING_API_KEY',
      false,
    );
  }
  return apiKey;
}

/** An entry classified once for all locales: skipped, or the text to send and the markers to restore. */
type PreparedEntry =
  | { readonly entry: TranslatorEntry; readonly kind: 'complex-icu' }
  | {
      readonly entry: TranslatorEntry;
      readonly kind: 'sendable';
      readonly text: string;
      readonly placeholders: ReadonlyArray<ExtractedPlaceholder>;
    };

function prepare(entry: TranslatorEntry): PreparedEntry {
  const classification = classifyICUContent(entry.source);
  if (classification === 'complex-icu') {
    return { entry, kind: 'complex-icu' };
  }
  if (classification === 'plain') {
    return { entry, kind: 'sendable', text: entry.source, placeholders: [] };
  }
  const { protectedText, placeholders } = protectPlaceholders(entry.source);
  return { entry, kind: 'sendable', text: protectedText, placeholders };
}

async function translateForLocale(
  provider: TranslationProvider,
  prepared: readonly PreparedEntry[],
  sourceLocale: string,
  targetLocale: string,
  protectedTerms: readonly string[],
): Promise<TranslationOutcome> {
  const sendable = prepared.filter((item) => item.kind === 'sendable');
  const results =
    sendable.length > 0
      ? await provider.translate(sendable.map(({ text }) => ({ text, sourceLocale, targetLocale })))
      : [];
  if (results.length !== sendable.length) {
    throw new TranslationError(
      `Translation provider returned ${results.length} results for ${sendable.length} texts.`,
      'INVALID_RESPONSE',
      false,
    );
  }

  const values: TranslatedValue[] = [];
  const skipped: SkippedTranslation[] = [];
  let next = 0;
  for (const item of prepared) {
    const { key, source } = item.entry;
    if (item.kind === 'complex-icu') {
      skipped.push({ key, locale: targetLocale, reason: 'complex-icu' });
      continue;
    }

    const restored = restorePlaceholders(results[next++].translatedText, item.placeholders);
    if (!restored.success) {
      skipped.push({ key, locale: targetLocale, reason: 'placeholder-mismatch' });
      continue;
    }

    const value = translocoToICU(restored.value);
    const terms = findProtectedTermViolations(source, value, protectedTerms);
    if (terms.length > 0) {
      skipped.push({ key, locale: targetLocale, reason: 'protected-term', terms });
      continue;
    }

    values.push({ key, locale: targetLocale, value });
  }
  return { values, skipped };
}
