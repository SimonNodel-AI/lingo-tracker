import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import {
  CollectionRenameBundleConflictError,
  CollectionRequiredByBundleError,
} from '../lib/errors/lingo-tracker-error';

/** Update explicit bundle references in the in-memory config before its single write. */
export function renameBundleCollectionReferences(config: LingoTrackerConfig, oldName: string, newName: string): void {
  if (oldName === newName) return;
  const bundles = Object.entries(config.bundles ?? {});
  const conflicting = bundles
    .filter(
      ([, bundle]) => Array.isArray(bundle?.collections) && bundle.collections.some((entry) => entry?.name === newName),
    )
    .map(([bundleName]) => bundleName);
  if (conflicting.length > 0) throw new CollectionRenameBundleConflictError(oldName, newName, conflicting);

  if (config.bundles === undefined) return;
  config.bundles = Object.fromEntries(
    bundles.map(([bundleName, bundle]) => [
      bundleName,
      Array.isArray(bundle?.collections)
        ? {
            ...bundle,
            collections: bundle.collections.map((entry) =>
              entry?.name === oldName ? { ...entry, name: newName } : entry,
            ),
          }
        : bundle,
    ]),
  );
}

/** Check every bundle before removing any reference from the in-memory config. */
export function removeBundleCollectionReferences(config: LingoTrackerConfig, name: string): void {
  const blocked = Object.entries(config.bundles ?? {})
    .filter(
      ([, bundle]) =>
        Array.isArray(bundle?.collections) &&
        bundle.collections.length > 0 &&
        bundle.collections.every((entry) => entry?.name === name),
    )
    .map(([bundleName]) => bundleName);
  if (blocked.length > 0) throw new CollectionRequiredByBundleError(name, blocked);

  if (config.bundles === undefined) return;
  config.bundles = Object.fromEntries(
    Object.entries(config.bundles).map(([bundleName, bundle]) => [
      bundleName,
      Array.isArray(bundle?.collections)
        ? { ...bundle, collections: bundle.collections.filter((entry) => entry?.name !== name) }
        : bundle,
    ]),
  );
}
