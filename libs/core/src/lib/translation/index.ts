// The translation module: machine-translate one resource or a whole locale through the configured provider.

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
export { TranslationError } from './translation-provider';
