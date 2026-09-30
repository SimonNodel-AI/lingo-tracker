import type { ImportStrategy } from './staleness';

/** Strategy used when an import does not specify one. */
export const DEFAULT_IMPORT_STRATEGY: ImportStrategy = 'translation-service';

/** Whether the strategy may write the requested locale. */
export function canImportLocale(locale: string, baseLocale: string, strategy: ImportStrategy): boolean {
  return locale !== baseLocale || strategy === 'migration';
}

/** Locale choices for an import, preserving configured order. */
export function importableLocales(
  configuredLocales: readonly string[],
  baseLocale: string,
  strategy: ImportStrategy,
): string[] {
  return configuredLocales.filter((locale) => canImportLocale(locale, baseLocale, strategy));
}
