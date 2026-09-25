// The translation module: the Translator (one seam to the machine-translation provider) and the
// operations that translate one resource or a whole locale through it.

export {
  type InMemoryTranslate,
  InMemoryTranslationProvider,
} from './in-memory-translation-provider';
export {
  type TranslateExistingResourceResult,
  translateExistingResource,
} from './translate-existing-resource';
export {
  type TranslateLocaleParams,
  type TranslateLocaleProgress,
  type TranslateLocaleResult,
  translateLocale,
} from './translate-locale';
export {
  type ProviderCapabilities,
  type TranslateRequest,
  type TranslateResult,
  TranslationError,
  type TranslationProvider,
} from './translation-provider';
export {
  type OpenTranslatorOptions,
  openTranslator,
  type SkippedTranslation,
  type TranslatedValue,
  type TranslationOutcome,
  type TranslationSkipReason,
  type Translator,
  type TranslatorEntry,
} from './translator';
