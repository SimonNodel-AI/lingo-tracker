import { resolveResourceKey, validateKey, validateTargetFolder } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { InvalidResourceKeyError } from '../errors/lingo-tracker-error';
import {
  type EntryAddChanges,
  type EntryAddResult,
  type EntryWriteOptions,
  type ExistingResourcePolicy,
  writeEntry,
} from './resource-entry';

export type { EntryAddResult as AddResourceResult, ExistingResourcePolicy } from './resource-entry';

export interface AddResourceParams extends EntryAddChanges {
  /** Dot-delimited key, e.g., "apps.common.buttons.ok". */
  readonly key: string;
  /** The stored key is targetFolder.key. */
  readonly targetFolder?: string;
}

export interface AddResourceOptions extends EntryWriteOptions {
  readonly onExisting?: ExistingResourcePolicy;
}

/**
 * Adds a resource entry to a collection. With `onExisting: 'replace'`, an existing
 * entry's previous translations and metadata are dropped. Creates the folders it needs.
 *
 * Every target locale of the collection gets a value: the supplied translation, else an
 * auto-translation when the collection has it enabled, else a copy of the base value as
 * `new` (the Locale seeding rule, {@link seedLocales}). When a supplied translation
 * has no status, the Staleness rule infers `new` for a copy or `translated` otherwise.
 *
 * Values are normalized to ICU before they are stored. Nothing is written when the
 * translation provider fails. The stored base value is checked against the preferred
 * terminology (Project Terms) and the findings returned; they never block the add.
 *
 * @param options - Existence policy and optional `provider` / `protectedTerms` overrides (see `openTranslator`).
 * @throws {ResourceAlreadyExistsError} The resolved key already exists and the policy is `fail`.
 * @throws {InvalidResourceKeyError} The key or `targetFolder` is malformed.
 * @throws {LocaleNotFoundError} A supplied translation names a locale the collection does not have.
 * @throws {TranslationError} The translation provider failed.
 * @throws {ProtectedTermsFileError} Auto-translation runs and a protected-terms file is malformed.
 */
export async function addResource(
  collection: Collection,
  params: AddResourceParams,
  options: AddResourceOptions = {},
): Promise<EntryAddResult> {
  const resolvedKey = resolveAddKey(params);
  const outcome = await writeEntry(
    collection,
    resolvedKey,
    { kind: 'add', changes: params, onExisting: options.onExisting ?? 'fail' },
    options,
  );
  return outcome.result;
}

/** Validates input and places its key without opening or resolving a filesystem folder. */
export function resolveAddKey(params: AddResourceParams): string {
  try {
    validateKey(params.key);
    if (params.targetFolder) validateTargetFolder(params.targetFolder);
  } catch (error) {
    throw new InvalidResourceKeyError(params.key, error instanceof Error ? error.message : String(error));
  }
  return resolveResourceKey(params.key, params.targetFolder);
}
