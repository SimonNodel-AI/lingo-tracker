import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { applyBaseChange, recordTranslation, type TranslationStatus } from '@simoncodes-ca/domain';
import { RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../../constants';
import { calculateChecksum } from '../../resource/checksum';
import type { ResourceEntries, ResourceEntry } from '../../resource/resource-entry';
import type { ResourceEntryMetadata } from '../../resource/resource-entry-metadata';
import type { TrackerMetadata } from '../../resource/tracker-metadata';
import { readResourceEntries, readTrackerMetadata, writeJsonFile } from '../file-io/json-file-operations';
import type { ResourceTreeEntry } from './load-resource-tree';

/**
 * Resource Folder — the owner of one folder's `resource_entries.json` + `tracker_meta.json` pair.
 *
 * Every read-modify-write of the pair goes through this module, so:
 * - both files are always loaded and saved together,
 * - checksums are computed here, and
 * - status changes follow the domain Staleness rule (`applyBaseChange`, `recordTranslation`).
 *
 * Changes stay in memory until `save()`.
 */
export interface ResourceFolder {
  /** Absolute or cwd-relative folder path this instance was opened with. */
  readonly folderPath: string;
  readonly entriesPath: string;
  readonly metaPath: string;

  has(key: string): boolean;
  /** Returns the stored entry and its metadata (`meta` is `undefined` when tracker_meta has no record). */
  get(key: string): ResourceFolderEntry | undefined;
  keys(): string[];
  isEmpty(): boolean;
  /**
   * The entry as the API/UI sees it. `undefined` when the entry is missing.
   * An entry without a metadata record gets `metadata: {}` (no locale has a status).
   */
  treeEntry(key: string): ResourceTreeEntry | undefined;

  /**
   * Sets the base value. Creates the entry when it does not exist.
   * When an existing base value changes (or its stored checksum is out of date), the
   * Staleness rule updates every translation's status.
   *
   * @returns true when anything changed
   */
  setBase(key: string, value: string): boolean;
  /**
   * Updates comment and/or tags. `undefined` leaves a field alone; `null` (or an empty tag list) removes it.
   * @returns true when anything changed
   */
  setDetails(key: string, details: EntryDetails): boolean;
  /**
   * Writes a translation value and records `{ checksum, baseChecksum, status }` for it.
   * `baseChecksum` is the current base checksum.
   */
  setTranslation(key: string, locale: string, value: string, status?: TranslationStatus): void;
  /**
   * Changes the status of a locale that already has metadata. The value and its checksum are kept.
   * With `refreshBaseChecksum`, the locale's `baseChecksum` is also set to the current base checksum
   * (the translation is re-confirmed against the current base).
   */
  setStatus(
    key: string,
    locale: string,
    status: TranslationStatus,
    options?: { readonly refreshBaseChecksum?: boolean },
  ): void;
  /** Stores an entry and its metadata exactly as given (lossless copy, used by move and normalize). */
  setEntry(key: string, entry: Readonly<ResourceEntry>, meta: Readonly<ResourceEntryMetadata>): void;
  /**
   * Adds `locale` to every entry that has no value for it, as a copy of the base value with status `new`.
   * @returns number of entries seeded
   */
  seedLocale(locale: string): number;
  /**
   * Removes `locale` values and metadata from every entry.
   * @returns number of entries changed
   */
  dropLocale(locale: string): number;
  /** @returns true when the entry existed */
  remove(key: string): boolean;

  /**
   * Writes both files (creating the folder if needed). When the folder has no entries,
   * both files are deleted instead. With `dryRun`, reports what would happen without touching disk.
   */
  save(options?: { readonly dryRun?: boolean }): ResourceFolderSaveResult;
}

export interface ResourceFolderEntry {
  readonly entry: Readonly<ResourceEntry>;
  readonly meta: Readonly<ResourceEntryMetadata> | undefined;
}

export interface EntryDetails {
  readonly comment?: string | null;
  readonly tags?: readonly string[] | null;
}

export interface ResourceFolderSaveResult {
  /** Files written (both files, or none). */
  readonly written: string[];
  /** Subset of `written` that did not exist before. */
  readonly created: string[];
  /** Files deleted because the folder became empty. */
  readonly removed: string[];
}

export interface OpenResourceFolderOptions {
  /** Base locale of the collection (default: `en`). Needed to find the base checksum in metadata. */
  readonly baseLocale?: string;
}

const NON_LOCALE_PROPS: ReadonlySet<string> = new Set(['source', 'comment', 'tags']);

/**
 * Returns the locales that have a translation value in `entry` —
 * every string property except `source`, `comment`, and `tags`.
 */
export function translationLocales(entry: Readonly<ResourceEntry>): string[] {
  return Object.keys(entry).filter((prop) => !NON_LOCALE_PROPS.has(prop) && typeof entry[prop] === 'string');
}

/**
 * Opens the resource folder at `folderPath`. Missing files are treated as empty.
 * @throws Error when a file exists but is not valid JSON
 */
export function openResourceFolder(folderPath: string, options: OpenResourceFolderOptions = {}): ResourceFolder {
  return new FileResourceFolder(folderPath, options.baseLocale ?? 'en');
}

/** Own-property check, so keys like "constructor" are not mistaken for entries (lib es2020 has no Object.hasOwn). */
function hasOwn(target: object, key: string): boolean {
  return Object.getOwnPropertyDescriptor(target, key) !== undefined;
}

class FileResourceFolder implements ResourceFolder {
  readonly entriesPath: string;
  readonly metaPath: string;
  private readonly entries: ResourceEntries;
  private readonly meta: TrackerMetadata;
  private entriesExist: boolean;
  private metaExists: boolean;

  constructor(
    readonly folderPath: string,
    private readonly baseLocale: string,
  ) {
    this.entriesPath = join(folderPath, RESOURCE_ENTRIES_FILENAME);
    this.metaPath = join(folderPath, TRACKER_META_FILENAME);
    this.entriesExist = existsSync(this.entriesPath);
    this.metaExists = existsSync(this.metaPath);
    this.entries = this.entriesExist ? readResourceEntries(this.entriesPath) : {};
    this.meta = this.metaExists ? readTrackerMetadata(this.metaPath) : {};
  }

  has(key: string): boolean {
    return hasOwn(this.entries, key);
  }

  get(key: string): ResourceFolderEntry | undefined {
    if (!this.has(key)) return undefined;
    return { entry: this.entries[key], meta: hasOwn(this.meta, key) ? this.meta[key] : undefined };
  }

  keys(): string[] {
    return Object.keys(this.entries);
  }

  isEmpty(): boolean {
    return this.keys().length === 0;
  }

  treeEntry(key: string): ResourceTreeEntry | undefined {
    const stored = this.get(key);
    if (!stored) return undefined;
    const { entry, meta } = stored;

    const translations: Record<string, string> = {};
    for (const locale of translationLocales(entry)) {
      translations[locale] = entry[locale] as string;
    }

    return {
      key,
      source: entry.source,
      translations,
      metadata: meta ?? {},
      ...(entry.comment !== undefined && { comment: entry.comment }),
      // A hand-edited non-array `tags` reads as no tags, so one bad value does not make the folder unreadable.
      ...(Array.isArray(entry.tags) && entry.tags.length > 0 && { tags: entry.tags }),
    };
  }

  setBase(key: string, value: string): boolean {
    const checksum = calculateChecksum(value);
    const entry = this.has(key) ? this.entries[key] : undefined;
    const entryMeta = this.metaOf(key);
    const previousChecksum = entryMeta[this.baseLocale]?.checksum;

    if (entry && entry.source === value && previousChecksum === checksum) {
      return false;
    }

    // The base changed when an existing entry gets a different value, or when the stored checksum
    // disagrees with the (hand-edited) stored value. A missing checksum on an unchanged value is just recorded.
    const baseChanged = entry !== undefined && (entry.source !== value || previousChecksum !== undefined);

    if (entry) {
      entry.source = value;
    } else {
      this.entries[key] = { source: value };
    }

    this.meta[key] = baseChanged
      ? applyBaseChange(entryMeta, this.baseLocale, checksum)
      : { ...entryMeta, [this.baseLocale]: { ...entryMeta[this.baseLocale], checksum } };

    return true;
  }

  setDetails(key: string, details: EntryDetails): boolean {
    const entry = this.requireEntry(key);
    let changed = false;

    if (details.comment === null && entry.comment !== undefined) {
      delete entry.comment;
      changed = true;
    } else if (typeof details.comment === 'string' && entry.comment !== details.comment) {
      entry.comment = details.comment;
      changed = true;
    }

    const removeTags = details.tags === null || details.tags?.length === 0;
    if (removeTags && entry.tags !== undefined) {
      delete entry.tags;
      changed = true;
    } else if (details.tags && !removeTags && !sameTags(entry.tags, details.tags)) {
      entry.tags = [...details.tags];
      changed = true;
    }

    return changed;
  }

  setTranslation(key: string, locale: string, value: string, status: TranslationStatus = 'translated'): void {
    if (locale === this.baseLocale) {
      throw new Error(`Cannot set a translation for the base locale "${locale}"; use setBase`);
    }
    const entry = this.requireEntry(key);
    entry[locale] = value;

    const entryMeta = this.metaOf(key);
    const baseChecksum = entryMeta[this.baseLocale]?.checksum ?? calculateChecksum(entry.source);
    this.meta[key] = recordTranslation(entryMeta, locale, calculateChecksum(value), baseChecksum, status);
  }

  setStatus(
    key: string,
    locale: string,
    status: TranslationStatus,
    options: { readonly refreshBaseChecksum?: boolean } = {},
  ): void {
    const entryMeta = this.metaOf(key);
    const localeMeta = entryMeta[locale];
    if (!localeMeta) {
      throw new Error(`No metadata for locale "${locale}" of resource "${key}"`);
    }
    localeMeta.status = status;
    if (options.refreshBaseChecksum) {
      localeMeta.baseChecksum =
        entryMeta[this.baseLocale]?.checksum ?? calculateChecksum(this.requireEntry(key).source);
    }
  }

  setEntry(key: string, entry: Readonly<ResourceEntry>, meta: Readonly<ResourceEntryMetadata>): void {
    this.entries[key] = { ...entry };
    this.meta[key] = { ...meta };
  }

  seedLocale(locale: string): number {
    let seeded = 0;
    for (const key of this.keys()) {
      const entry = this.entries[key];
      if (typeof entry !== 'object' || entry === null || typeof entry.source !== 'string') continue;
      if (typeof entry[locale] === 'string') continue;

      this.setTranslation(key, locale, entry.source, 'new');
      seeded++;
    }
    return seeded;
  }

  dropLocale(locale: string): number {
    let changedEntries = 0;
    for (const key of this.keys()) {
      const entry = this.entries[key];
      if (typeof entry !== 'object' || entry === null) continue;

      let changed = false;
      if (locale in entry) {
        delete entry[locale];
        changed = true;
      }
      const entryMeta = this.meta[key];
      if (entryMeta && locale in entryMeta) {
        delete entryMeta[locale];
        changed = true;
      }
      if (changed) changedEntries++;
    }
    return changedEntries;
  }

  remove(key: string): boolean {
    if (!this.has(key)) return false;
    delete this.entries[key];
    delete this.meta[key];
    return true;
  }

  save(options: { readonly dryRun?: boolean } = {}): ResourceFolderSaveResult {
    const dryRun = options.dryRun ?? false;

    if (this.isEmpty()) {
      const removed = [...(this.entriesExist ? [this.entriesPath] : []), ...(this.metaExists ? [this.metaPath] : [])];
      if (!dryRun) {
        for (const filePath of removed) unlinkSync(filePath);
        this.entriesExist = false;
        this.metaExists = false;
      }
      return { written: [], created: [], removed };
    }

    const created = [...(this.entriesExist ? [] : [this.entriesPath]), ...(this.metaExists ? [] : [this.metaPath])];
    if (!dryRun) {
      writeJsonFile({ filePath: this.entriesPath, data: this.entries, ensureDirectory: true });
      writeJsonFile({ filePath: this.metaPath, data: this.meta });
      this.entriesExist = true;
      this.metaExists = true;
    }
    return { written: [this.entriesPath, this.metaPath], created, removed: [] };
  }

  private metaOf(key: string): ResourceEntryMetadata {
    return hasOwn(this.meta, key) ? this.meta[key] : {};
  }

  private requireEntry(key: string): ResourceEntry {
    if (!this.has(key)) {
      throw new Error(`Resource entry not found: ${key}`);
    }
    return this.entries[key];
  }
}

function sameTags(current: readonly string[] | undefined, next: readonly string[]): boolean {
  if (!current) return false;
  return current.length === next.length && current.every((tag, index) => tag === next[index]);
}
