import { importStrategyPolicy, type ImportStrategy } from './import-strategy-policy';

export { DEFAULT_IMPORT_STRATEGY } from './import-strategy-policy';

/** Whether the strategy may write the requested locale. */
export function canImportLocale(locale: string, baseLocale: string, strategy: ImportStrategy): boolean {
  return locale !== baseLocale || importStrategyPolicy(strategy).writesBaseLocale;
}

/** Locale choices for an import, preserving configured order. */
export function importableLocales(
  configuredLocales: readonly string[],
  baseLocale: string,
  strategy: ImportStrategy,
): string[] {
  return configuredLocales.filter((locale) => canImportLocale(locale, baseLocale, strategy));
}
