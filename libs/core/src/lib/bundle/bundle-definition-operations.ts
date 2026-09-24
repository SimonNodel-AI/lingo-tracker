/**
 * Add / update / delete bundle definitions in `.lingo-tracker.json`.
 *
 * Every operation normalises the definition and validates it (with the domain
 * Bundle Definition rules) against the freshly read config inside the
 * `updateConfig` updater, so the check and the write see the same state. Key
 * order in `config.bundles` is preserved on update and rename.
 *
 * Failure order: a missing bundle (`BundleNotFoundError`), then every key and
 * definition problem at once (`InvalidBundleDefinitionError`), then a key
 * collision (`BundleAlreadyExistsError`).
 *
 * Existence is an own-property check (`findBundleDefinition`), so a key such as
 * `constructor` is an ordinary bundle name, never something on `Object.prototype`.
 */

import { type BundleDefinition, checkBundleDefinition, findBundleDefinition } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { updateConfig } from '../config/config-file-operations';
import {
  BundleAlreadyExistsError,
  BundleNotFoundError,
  InvalidBundleDefinitionError,
} from '../errors/lingo-tracker-error';

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
  const bundleKey = key?.trim() ?? '';

  updateConfig((config) => {
    const cleaned = assertValid(definition, config, bundleKey);

    if (findBundleDefinition(config.bundles, bundleKey)) {
      throw new BundleAlreadyExistsError(bundleKey);
    }

    // `Object.fromEntries` defines own properties, so even `__proto__` is stored as a key.
    return {
      ...config,
      bundles: Object.fromEntries([...Object.entries(config.bundles ?? {}), [bundleKey, cleaned]]),
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
  const newKey = options.newKey?.trim();
  const targetKey = newKey ?? bundleKey;
  const isRename = targetKey !== bundleKey;

  updateConfig((config) => {
    const bundles = config.bundles ?? {};

    if (!findBundleDefinition(bundles, bundleKey)) {
      throw new BundleNotFoundError(bundleKey);
    }

    const cleaned = assertValid(definition, config, newKey);

    if (isRename && findBundleDefinition(bundles, targetKey)) {
      throw new BundleAlreadyExistsError(targetKey);
    }

    // Rebuild the record in the original order so a rename keeps its position.
    const nextBundles: Record<string, BundleDefinition> = Object.fromEntries(
      Object.entries(bundles).map(([existingKey, existingDefinition]) =>
        existingKey === bundleKey ? [targetKey, cleaned] : [existingKey, existingDefinition],
      ),
    );

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

    if (!findBundleDefinition(bundles, bundleKey)) {
      throw new BundleNotFoundError(bundleKey);
    }

    const remaining = Object.fromEntries(Object.entries(bundles).filter(([existingKey]) => existingKey !== bundleKey));
    const next: LingoTrackerConfig = { ...config, bundles: remaining };

    // Drop the `bundles` key entirely when the last bundle goes, keeping the file minimal.
    if (Object.keys(remaining).length === 0) {
      delete next.bundles;
    }

    return next;
  }, options.cwd);

  return { message: `Bundle "${bundleKey}" deleted successfully` };
}

/** Runs the domain `checkBundleDefinition`; throws one `InvalidBundleDefinitionError` with every problem. */
function assertValid(definition: BundleDefinition, config: LingoTrackerConfig, key?: string): BundleDefinition {
  const check = checkBundleDefinition(definition, Object.keys(config.collections ?? {}), key);
  if (check.errors.length > 0) {
    throw new InvalidBundleDefinitionError(check.errors);
  }
  return check.definition;
}
