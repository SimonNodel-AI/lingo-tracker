/**
 * Add / update / delete bundle definitions in `.lingo-tracker.json`.
 *
 * Every operation validates the definition against the freshly read config
 * inside the `updateConfig` updater so the check and the write see the same
 * state. Key order in `config.bundles` is preserved on update and rename.
 */

import type { BundleDefinition, CollectionBundleDefinition, EntrySelectionRule } from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { updateConfig } from '../config/config-file-operations';
import { ErrorMessages } from '../errors/error-messages';
import { validateBundleDefinition, validateBundleKey } from './validate-bundle-definition';

export interface BundleDefinitionOperationOptions {
  cwd?: string;
}

export interface UpdateBundleDefinitionOptions extends BundleDefinitionOperationOptions {
  /** Rename the bundle to this key while updating it. */
  newKey?: string;
}

export function addBundleDefinition(
  key: string,
  definition: BundleDefinition,
  options: BundleDefinitionOperationOptions = {},
): { message: string } {
  const bundleKey = assertValidKey(key);

  updateConfig((config) => {
    if (config.bundles?.[bundleKey]) {
      throw new Error(ErrorMessages.bundleAlreadyExists(bundleKey));
    }

    const cleaned = assertValidDefinition(definition, config);

    return {
      ...config,
      bundles: {
        ...(config.bundles ?? {}),
        [bundleKey]: cleaned,
      },
    };
  }, options.cwd);

  return { message: `Bundle "${bundleKey}" added successfully` };
}

export function updateBundleDefinition(
  key: string,
  definition: BundleDefinition,
  options: UpdateBundleDefinitionOptions = {},
): { message: string } {
  const bundleKey = key.trim();
  const targetKey = options.newKey === undefined ? bundleKey : assertValidKey(options.newKey);
  const isRename = targetKey !== bundleKey;

  updateConfig((config) => {
    const bundles = config.bundles ?? {};

    if (!bundles[bundleKey]) {
      throw new Error(ErrorMessages.bundleNotFound(bundleKey));
    }

    if (isRename && bundles[targetKey]) {
      throw new Error(ErrorMessages.bundleAlreadyExists(targetKey));
    }

    const cleaned = assertValidDefinition(definition, config);

    // Rebuild the record in the original order so a rename keeps its position.
    const nextBundles: Record<string, BundleDefinition> = {};
    for (const [existingKey, existingDefinition] of Object.entries(bundles)) {
      if (existingKey === bundleKey) {
        nextBundles[targetKey] = cleaned;
      } else {
        nextBundles[existingKey] = existingDefinition;
      }
    }

    return { ...config, bundles: nextBundles };
  }, options.cwd);

  return isRename
    ? { message: `Bundle "${bundleKey}" renamed to "${targetKey}" and updated successfully` }
    : { message: `Bundle "${bundleKey}" updated successfully` };
}

export function deleteBundleDefinition(
  key: string,
  options: BundleDefinitionOperationOptions = {},
): { message: string } {
  const bundleKey = key.trim();

  updateConfig((config) => {
    const bundles = config.bundles ?? {};

    if (!bundles[bundleKey]) {
      throw new Error(ErrorMessages.bundleNotFound(bundleKey));
    }

    const { [bundleKey]: _removed, ...remaining } = bundles;
    const next: LingoTrackerConfig = { ...config, bundles: remaining };

    // Drop the `bundles` key entirely when the last bundle goes, keeping the file minimal.
    if (Object.keys(remaining).length === 0) {
      delete next.bundles;
    }

    return next;
  }, options.cwd);

  return { message: `Bundle "${bundleKey}" deleted successfully` };
}

function assertValidKey(key: string): string {
  const trimmed = key?.trim() ?? '';
  const errors = validateBundleKey(trimmed);
  if (errors.length > 0) {
    throw new Error(ErrorMessages.invalidBundleDefinition(errors));
  }
  return trimmed;
}

function assertValidDefinition(definition: BundleDefinition, config: LingoTrackerConfig): BundleDefinition {
  const cleaned = stripUndefined(definition);
  const errors = validateBundleDefinition(cleaned, config);
  if (errors.length > 0) {
    throw new Error(ErrorMessages.invalidBundleDefinition(errors));
  }
  return cleaned;
}

/**
 * Returns a copy of the definition with every `undefined` optional field
 * removed (recursively through collections and rules) so nothing spurious is
 * serialised into the config file.
 */
function stripUndefined(definition: BundleDefinition): BundleDefinition {
  const collections =
    definition.collections === 'All'
      ? ('All' as const)
      : definition.collections.map((collection) => stripCollection(collection));

  return omitUndefined({ ...definition, collections });
}

function stripCollection(collection: CollectionBundleDefinition): CollectionBundleDefinition {
  const entriesSelectionRules =
    collection.entriesSelectionRules === 'All'
      ? ('All' as const)
      : collection.entriesSelectionRules.map((rule) => omitUndefined<EntrySelectionRule>({ ...rule }));

  return omitUndefined({ ...collection, entriesSelectionRules });
}

function omitUndefined<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (fieldValue !== undefined) {
      result[field] = fieldValue;
    }
  }
  return result as T;
}
