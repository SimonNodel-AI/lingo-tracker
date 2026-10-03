/**
 * Add / update / delete bundle definitions in `.lingo-tracker.json`.
 *
 * Every operation normalises the definition and validates it (with the domain
 * Bundle Definition rules) against the opened project's config, so the check
 * and write see the same state. Key order in `config.bundles` is preserved.
 *
 * Failure order: a missing bundle (`BundleNotFoundError`), then every key and
 * definition problem (`InvalidNameError` for a blank rename target, otherwise
 * `InvalidBundleDefinitionError` with every definition problem), then a key
 * collision (`BundleAlreadyExistsError`).
 *
 * Existence is an own-property check (`findBundleDefinition`), so a key such as
 * `constructor` is an ordinary bundle name, never something on `Object.prototype`.
 */

import { type BundleDefinition, checkBundleDefinition, findBundleDefinition } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { guardedConfigWrite } from '../config/config-file-operations';
import { resolveRenameTarget } from '../config/entry-name';
import type { OpenedProject } from '../config/open-collection';
import {
  BundleAlreadyExistsError,
  BundleNotFoundError,
  InvalidBundleDefinitionError,
} from '../errors/lingo-tracker-error';

export interface UpdateBundleDefinitionOptions {
  /** Rename the bundle to this key while updating it. */
  newKey?: string;
}

export function addBundleDefinition(
  project: OpenedProject,
  key: string,
  definition: BundleDefinition,
): { message: string } {
  const bundleKey = key?.trim() ?? '';

  const configWrite = guardedConfigWrite(project);
  const config = project.sourceConfig;
  const next = (() => {
    const cleaned = assertValid(definition, config, bundleKey);

    if (findBundleDefinition(config.bundles, bundleKey)) {
      throw new BundleAlreadyExistsError(bundleKey);
    }

    // `Object.fromEntries` defines own properties, so even `__proto__` is stored as a key.
    return {
      ...config,
      bundles: Object.fromEntries([...Object.entries(config.bundles ?? {}), [bundleKey, cleaned]]),
    };
  })();
  configWrite.write(next);

  return { message: `Bundle "${bundleKey}" added successfully` };
}

export function updateBundleDefinition(
  project: OpenedProject,
  key: string,
  definition: BundleDefinition,
  options: UpdateBundleDefinitionOptions = {},
): { message: string } {
  const bundleKey = key.trim();

  const configWrite = guardedConfigWrite(project);
  const config = project.sourceConfig;
  const { next, targetKey, isRename } = (() => {
    const bundles = config.bundles ?? {};

    if (!findBundleDefinition(bundles, bundleKey)) {
      throw new BundleNotFoundError(bundleKey);
    }

    const { target: targetKey, isRename } = resolveRenameTarget(bundleKey, options.newKey);
    const cleaned = assertValid(definition, config, isRename ? targetKey : undefined);

    if (isRename && findBundleDefinition(bundles, targetKey)) {
      throw new BundleAlreadyExistsError(targetKey);
    }

    // Rebuild the record in the original order so a rename keeps its position.
    const nextBundles: Record<string, BundleDefinition> = Object.fromEntries(
      Object.entries(bundles).map(([existingKey, existingDefinition]) =>
        existingKey === bundleKey ? [targetKey, cleaned] : [existingKey, existingDefinition],
      ),
    );

    return { next: { ...config, bundles: nextBundles }, targetKey, isRename };
  })();
  configWrite.write(next);

  return isRename
    ? { message: `Bundle "${bundleKey}" renamed to "${targetKey}" and updated successfully` }
    : { message: `Bundle "${bundleKey}" updated successfully` };
}

export function deleteBundleDefinition(project: OpenedProject, key: string): { message: string } {
  const bundleKey = key.trim();

  const configWrite = guardedConfigWrite(project);
  const config = project.sourceConfig;
  const next = (() => {
    const bundles = config.bundles ?? {};

    if (!findBundleDefinition(bundles, bundleKey)) {
      throw new BundleNotFoundError(bundleKey);
    }

    const remaining = Object.fromEntries(Object.entries(bundles).filter(([existingKey]) => existingKey !== bundleKey));
    const result: LingoTrackerConfig = { ...config, bundles: remaining };

    // Drop the `bundles` key entirely when the last bundle goes, keeping the file minimal.
    if (Object.keys(remaining).length === 0) {
      delete result.bundles;
    }

    return result;
  })();
  configWrite.write(next);

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
