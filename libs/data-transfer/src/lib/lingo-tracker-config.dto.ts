import type { TranslationConfigDto } from './translation-config.dto';
import type { LingoTrackerCollectionDto } from './lingo-tracker-collection.dto';
import type { BundleDefinitionDto, TokenCasingDto } from './bundle-definition.dto';

export interface LingoTrackerConfigDto {
  exportFolder: string;
  importFolder: string;
  baseLocale: string;
  locales: string[];
  collections: Record<string, LingoTrackerCollectionDto>;
  /** Bundle definitions keyed by bundle name. */
  bundles?: Record<string, BundleDefinitionDto>;
  /** Project-wide default token casing for generated type files. Bundles may override it. */
  tokenCasing?: TokenCasingDto;
  /** Project-wide default for ICU → Transloco conversion at bundle time (core default: true). */
  transformICUToTransloco?: boolean;
  translation?: TranslationConfigDto;
  /** Resolved global protected terms, read from the protected-terms file. Read-only. */
  protectedTerms?: string[];
  /** Path of the file the global protected terms are stored in. Read-only; shown in the UI. */
  protectedTermsFilePath?: string;
  /** Basename of the served workspace folder. Read-only; shown as the home page title. */
  projectName?: string;
}
