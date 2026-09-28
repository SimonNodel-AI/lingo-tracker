import type { DensityMode } from '../types/density-mode';
import type { CollectionSettings } from '../../collections/store/collection-settings';

/**
 * Root state for signals shared across multiple features.
 * Cross-cutting state lives here to avoid circular type dependencies between features:
 * - collectionSettings, and its projections selectedCollection, availableLocales, baseLocale,
 *   isReadOnly: the open collection's settings, written only by the Browser Session
 *   (`with-browser-session.feature.ts`)
 * - sessionId: bumped by every `openCollection`; loaders capture it (`session-guard.ts`) and drop
 *   a response that arrives after another collection was opened
 * - currentFolderPath: read by withTranslationsFeature (selectFolder) and written by withFolderTreeFeature
 * - densityMode and related: read by withFilterFeature (compact-mode locale tracking) and written by withViewPreferencesFeature
 */
export interface RootState {
  sessionId: number;
  /** The open collection's resolved settings: the one source the browser reads them from. */
  collectionSettings: CollectionSettings | null;
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
  sessionId: 0,
  collectionSettings: null,
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
