import type { DensityMode } from '../types/density-mode';

/**
 * Root state for signals shared across multiple features.
 * Cross-cutting state lives here to avoid circular type dependencies between features:
 * - selectedCollection, availableLocales, baseLocale, isReadOnly: the open collection's settings,
 *   written only by the Browser Session (`with-browser-session.feature.ts`)
 * - currentFolderPath: read by withTranslationsFeature (selectFolder) and written by withFolderTreeFeature
 * - densityMode and related: read by withFilterFeature (compact-mode locale tracking) and written by withViewPreferencesFeature
 */
export interface RootState {
  selectedCollection: string | null;
  availableLocales: string[];
  baseLocale: string;
  isDisabled: boolean;
  /**
   * True when the active collection is read-only. Persistent for the lifetime of the
   * selected collection — kept separate from the transient `isDisabled` flag (which search
   * and move operations flip on and off) so it is never accidentally cleared.
   */
  isReadOnly: boolean;
  error: string | null;
  currentFolderPath: string;
  densityMode: DensityMode;
  compactLocale: string | undefined;
  compactLocaleManuallyChanged: boolean;
  nonCompactSelectedLocales: string[];
}

export const initialRootState: RootState = {
  selectedCollection: null,
  availableLocales: [],
  baseLocale: '',
  isDisabled: false,
  isReadOnly: false,
  error: null,
  currentFolderPath: '',
  densityMode: 'compact',
  compactLocale: undefined,
  compactLocaleManuallyChanged: false,
  nonCompactSelectedLocales: [],
};
