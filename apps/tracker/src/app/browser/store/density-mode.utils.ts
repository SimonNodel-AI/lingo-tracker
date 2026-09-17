import type { DensityMode } from '../types/density-mode';

export interface DensityModeTransition {
  readonly selectedLocales: string[];
  readonly compactLocale: string | undefined;
  readonly compactLocaleManuallyChanged: boolean;
  readonly nonCompactSelectedLocales: string[];
}

export interface DensityModeContext {
  readonly currentDensityMode: DensityMode;
  readonly currentSelectedLocales: string[];
  readonly availableLocales: string[];
  readonly baseLocale: string;
  readonly compactLocale: string | undefined;
  readonly compactLocaleManuallyChanged: boolean;
  readonly nonCompactSelectedLocales: string[];
}

/**
 * Computes the new locale selection state when switching density modes.
 *
 * Compact mode enforces a single-locale display. Switching to compact saves the
 * current multi-locale selection and picks a single locale. Switching away from
 * compact restores the previously saved multi-locale selection (unless the user
 * manually changed the locale while in compact mode).
 */
export function computeDensityModeTransition(
  targetMode: DensityMode,
  context: DensityModeContext,
): DensityModeTransition {
  const isEnteringCompact = targetMode === 'compact';
  const isLeavingCompact = context.currentDensityMode === 'compact' && !isEnteringCompact;

  let selectedLocales = context.currentSelectedLocales;
  let compactLocale = context.compactLocale;
  let compactLocaleManuallyChanged = context.compactLocaleManuallyChanged;
  let nonCompactSelectedLocales = context.nonCompactSelectedLocales;

  if (isEnteringCompact) {
    nonCompactSelectedLocales = context.currentSelectedLocales;
    compactLocaleManuallyChanged = false;

    // Compact starts on the locale it was last showing, and otherwise on the
    // base locale. The full-density filter is deliberately not consulted: it is a
    // set of locales to compare, not a statement about which one to read alone.
    if (compactLocale && context.availableLocales.includes(compactLocale)) {
      selectedLocales = [compactLocale];
    } else {
      const fallback = defaultCompactLocale(context.availableLocales, context.baseLocale);

      if (fallback) {
        selectedLocales = [fallback];
        compactLocale = fallback;
      }
    }
  } else if (isLeavingCompact) {
    if (context.compactLocaleManuallyChanged) {
      selectedLocales = context.currentSelectedLocales;
    } else if (context.nonCompactSelectedLocales.length > 0) {
      selectedLocales = context.nonCompactSelectedLocales;
    }

    if (context.currentSelectedLocales.length > 0) {
      compactLocale = context.currentSelectedLocales[0];
    }
  }

  return { selectedLocales, compactLocale, compactLocaleManuallyChanged, nonCompactSelectedLocales };
}

/**
 * The base locale when the collection has it, otherwise its first locale, or
 * undefined when there is nothing to show at all.
 */
function defaultCompactLocale(availableLocales: string[], baseLocale: string): string | undefined {
  if (baseLocale && availableLocales.includes(baseLocale)) return baseLocale;
  return availableLocales.at(0);
}

/**
 * Resolves a single locale to display in compact mode from a saved preference and available options.
 * Used during collection initialization when restoring view preferences.
 *
 * Order: the remembered compact locale, then a saved single selection (older
 * preferences persisted only that), then the base locale.
 */
export function resolveCompactLocale(options: {
  readonly savedCompactLocale: string | undefined;
  readonly currentSelectedLocales: string[];
  readonly availableLocales: string[];
  readonly baseLocale: string;
}): string[] {
  const { savedCompactLocale, currentSelectedLocales, availableLocales, baseLocale } = options;

  if (savedCompactLocale && availableLocales.includes(savedCompactLocale)) {
    return [savedCompactLocale];
  }

  if (currentSelectedLocales.length === 1 && availableLocales.includes(currentSelectedLocales[0])) {
    return currentSelectedLocales;
  }

  const fallback = defaultCompactLocale(availableLocales, baseLocale);
  return fallback ? [fallback] : [];
}
