// The translation module: the Translator (one seam to the machine-translation provider) and the
// operations that translate one resource or a whole locale through it.

export {
  type InMemoryTranslate,
  InMemoryTranslationProvider,
} from './in-memory-translation-provider';
export {
  type TranslateExistingResourceOptions,
  type TranslateExistingResourceResult,
  translateExistingResource,
} from './translate-existing-resource';
export type { TranslateLocaleProgress, TranslateLocaleResult } from './translation-run';
export type {
  ProviderCapabilities,
  TranslateRequest,
  TranslateResult,
  TranslationProvider,
} from './translation-provider';
export {
  assertAutoTranslationEnabled,
  type OpenTranslatorOptions,
  openTranslator,
  type SkippedTranslation,
  type TranslatedValue,
  type TranslationOutcome,
  type TranslationSkipReason,
  type Translator,
  type TranslatorEntry,
} from './translator';

export {
  prepareTranslationRun,
  type TranslationRun,
  type LocaleTranslationRun,
  type TranslationRunExecutionOptions,
  type TranslationRunOptions,
} from './translation-run';
