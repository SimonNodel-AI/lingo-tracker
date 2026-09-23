import type { LocaleMetadata } from './locale-metadata';
import type { TranslationStatus } from './translation-status';

/**
 * Staleness — the single home of the rules that decide a translation's
 * `{ checksum, baseChecksum, status }` metadata.
 *
 * Every writer (add, edit, import, normalize, translate, locale seeding) goes
 * through these functions so that "what happens to translations when the base
 * value changes" is answered in exactly one place.
 *
 * Pure: no Node.js dependencies. Checksums are computed by the caller.
 */

/** Metadata for one resource entry, keyed by locale (base locale included). */
export type EntryLocaleMetadata = Readonly<Record<string, LocaleMetadata>>;

/** Import strategies. Each strategy implies a different status outcome. */
export type ImportStrategy = 'translation-service' | 'verification' | 'migration' | 'update';

/**
 * Returns true when a translation is an untranslated copy of the base value.
 *
 * Pass either both values or both checksums. A translation that is identical to
 * the base is treated as "not translated yet", so its status is `new`:
 * - when an entry is created with translations (`add-resource`), and
 * - when the base value changes (see {@link applyBaseChange}).
 */
export function isUntranslatedCopy(translation: string, base: string): boolean {
  return translation === base;
}

/**
 * The staleness rule. Applies a base value change to an entry's metadata.
 *
 * - The base locale's `checksum` becomes `newBaseChecksum`.
 * - Every other locale's `baseChecksum` becomes `newBaseChecksum`, and its status becomes:
 *   - `new` when its value is an untranslated copy of the new base value
 *     (its `checksum` equals `newBaseChecksum`), because there is nothing to re-review;
 *   - `stale` otherwise, whatever the previous status was (including `verified`).
 *
 * Decision: the "copy of the base stays `new`" clause comes from normalize, and it is the same
 * rule that `add-resource` uses at creation time. It relies on each locale's `checksum` being
 * current, which every writer guarantees because it recomputes the checksum when it writes a value.
 *
 * Callers apply this only when the base value actually changed.
 *
 * @returns New metadata object; the input is not mutated.
 */
export function applyBaseChange(
  entryMeta: EntryLocaleMetadata,
  baseLocale: string,
  newBaseChecksum: string,
): Record<string, LocaleMetadata> {
  const updated: Record<string, LocaleMetadata> = {};

  for (const [locale, localeMeta] of Object.entries(entryMeta)) {
    if (locale === baseLocale) continue;
    updated[locale] = {
      ...localeMeta,
      baseChecksum: newBaseChecksum,
      status: isUntranslatedCopy(localeMeta.checksum, newBaseChecksum) ? 'new' : 'stale',
    };
  }

  return { ...entryMeta, ...updated, [baseLocale]: { ...entryMeta[baseLocale], checksum: newBaseChecksum } };
}

/**
 * Records a translation for `locale`. Returns new entry metadata with that locale set to
 * `{ checksum, baseChecksum, status }`. Other locales are not changed.
 *
 * @param checksum - Checksum of the translated value
 * @param baseChecksum - Checksum of the base value that the translation was made from
 */
export function recordTranslation(
  entryMeta: EntryLocaleMetadata,
  locale: string,
  checksum: string,
  baseChecksum: string,
  status: TranslationStatus,
): Record<string, LocaleMetadata> {
  return { ...entryMeta, [locale]: { checksum, baseChecksum, status } };
}

/**
 * Returns true when a locale needs (machine or human) translation:
 * there is no metadata for it, or its status is `new` or `stale`.
 */
export function needsTranslation(localeMeta: LocaleMetadata | undefined): boolean {
  if (!localeMeta) return true;
  return localeMeta.status === 'new' || localeMeta.status === 'stale';
}

export interface ResolveImportStatusParams {
  /** `undefined` gets no strategy-specific handling (rules 2, 3, and 5 do not apply). */
  readonly strategy: ImportStrategy | undefined;
  /** Status before the import, if the locale had metadata. */
  readonly oldStatus: TranslationStatus | undefined;
  /**
   * Status carried by the imported file, only when the caller has decided to honour it
   * (for example `preserveStatus`). `undefined` means "use the strategy".
   */
  readonly incomingStatus: TranslationStatus | undefined;
  /** True when the imported value differs from the stored value (or the locale had no value). */
  readonly valueChanged: boolean;
  /**
   * True when the locale's stored `baseChecksum` no longer matches the current base checksum.
   * Only relevant when the value is unchanged.
   */
  readonly baseChecksumChanged: boolean;
}

/**
 * Resolves the status of a target-locale value written (or re-confirmed) by an import.
 *
 * 1. An honoured incoming status always wins.
 * 2. `verification` → `verified`.
 * 3. `update` → keeps the previous status (`translated` if none).
 * 4. A changed value (`translation-service`, `migration`) → `translated`.
 * 5. An unchanged value re-confirmed by `translation-service` → `translated` when it was
 *    `stale` or its base checksum moved; otherwise the previous status is kept.
 * 6. Otherwise the previous status is kept (`translated` if none).
 */
export function resolveImportStatus(params: ResolveImportStatusParams): TranslationStatus {
  const { strategy, oldStatus, incomingStatus, valueChanged, baseChecksumChanged } = params;

  if (incomingStatus) return incomingStatus;
  if (strategy === 'verification') return 'verified';
  if (strategy === 'update') return oldStatus ?? 'translated';
  if (valueChanged) return 'translated';
  if (strategy === 'translation-service' && (oldStatus === 'stale' || baseChecksumChanged)) return 'translated';
  return oldStatus ?? 'translated';
}
