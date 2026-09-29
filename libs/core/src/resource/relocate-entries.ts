import { validateKey } from '@simoncodes-ca/domain';
import type { Collection } from '../lib/config/open-collection';
import type { ResourceTreeEntry } from '../lib/resource/load-resource-tree';
import { resolveResourcePaths } from '../lib/resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder, type ResourceFolderEntry } from '../lib/resource/resource-folder';
import {
  reindexMutation,
  removeMutation,
  type ResourceMutation,
  upsertMutation,
} from '../lib/resource/resource-mutation';

/**
 * Entry Relocation — the one way entries move between keys, within a collection or into another.
 * `editResource` (`moveTo`), `moveResource` (one key or a pattern) and `moveFolder` all move through it.
 *
 * - **Batch**: every folder involved is opened once, and saved once, however many entries move
 *   in or out of it. Folders that receive entries are saved before folders that only lose them,
 *   so a failed write leaves an entry in both places rather than in neither.
 * - **Lossless**: values, comment, tags, checksums and statuses (`verified`, `stale`) are carried as
 *   they are. Nothing is auto-translated.
 * - **Collision policy**: a destination key is taken when an entry that is not itself moving
 *   away holds it. A taken key is a collision (the entry stays where it is) unless `override`
 *   is set, which replaces the entry there. Two entries of one batch never move to the same key:
 *   the later one is a collision. Collisions are decided before anything changes, and a key that
 *   an entry of the same batch moves away from counts as free (so `a.*` can move to `a.b`).
 * - **Locale reconciliation**: an entry moved into another collection is fitted to its locales
 *   (`ResourceFolder.setEntry` with the destination's `targetLocales`): values of locales the
 *   destination does not have are dropped, and each missing destination locale is seeded as a
 *   `new` copy of the base. The two collections must share a base locale.
 */

/** One entry to move, by full key. */
export interface Relocation {
  readonly from: string;
  readonly to: string;
}

export interface RelocateEntriesOptions {
  /** Replace an entry that holds a destination key. Default: false (the relocation is a collision). */
  readonly override?: boolean;
}

/** An entry that moved, as it is stored at its destination. */
export interface RelocatedEntry {
  readonly from: string;
  readonly to: string;
  readonly entry: ResourceTreeEntry;
}

export interface RelocationResult {
  /** The relocations done, in the order they were given. */
  readonly moved: RelocatedEntry[];
  /** The relocations not done because the destination key is taken. */
  readonly collisions: Relocation[];
  /** One message per relocation that failed (bad key, missing entry, unreadable folder), or for a failed write. */
  readonly errors: string[];
  /** A `remove` per moved key at the source, then an `upsert` per moved key at the destination. */
  readonly mutations: ResourceMutation[];
}

interface Slot {
  readonly folder: ResourceFolder;
  readonly entryKey: string;
  /** Folder path and entry key: two slots with the same id are the same entry. */
  readonly id: string;
}

interface Planned {
  readonly relocation: Relocation;
  readonly from: Slot;
  readonly to: Slot;
  readonly stored: ResourceFolderEntry;
}

/**
 * Moves entries from `source` to `destination` (the same collection, or another) by the rules above.
 * Never throws for one relocation; failures are reported in the result.
 */
export function relocateEntries(
  source: Collection,
  destination: Collection,
  relocations: readonly Relocation[],
  options: RelocateEntriesOptions = {},
): RelocationResult {
  const override = options.override ?? false;
  const crossCollection = source.translationsFolder !== destination.translationsFolder;
  const errors: string[] = [];

  if (crossCollection && source.baseLocale !== destination.baseLocale) {
    errors.push(
      `Cannot move resources from collection "${source.name}" (base locale "${source.baseLocale}") to "${destination.name}" (base locale "${destination.baseLocale}")`,
    );
    return { moved: [], collisions: [], errors, mutations: [] };
  }

  const folders = new Map<string, ResourceFolder>();
  const slot = (collection: Collection, key: string): Slot => {
    const paths = resolveResourcePaths({ key, translationsFolder: collection.translationsFolder });
    let folder = folders.get(paths.folderPath);
    if (!folder) {
      folder = openResourceFolder(paths.folderPath, { baseLocale: collection.baseLocale });
      folders.set(paths.folderPath, folder);
    }
    return { folder, entryKey: paths.entryKey, id: `${paths.folderPath}\u0000${paths.entryKey}` };
  };

  // 1. Read every entry to move.
  const planned: Planned[] = [];
  const taken = new Set<string>();
  for (const relocation of relocations) {
    const item = plan(relocation, source, destination, slot);
    if (typeof item === 'string') {
      errors.push(item);
    } else if (taken.has(item.from.id)) {
      errors.push(`Resource listed twice in one move: ${relocation.from}`);
    } else {
      taken.add(item.from.id);
      planned.push(item);
    }
  }
  let pending = planned;

  // 2. Decide the collisions. An entry that stays frees nothing, which can make another
  //    relocation collide, so repeat until no new collision is found.
  const collided = new Set<Planned>();
  const leaving = new Set(taken);
  let changed = true;
  while (changed) {
    changed = false;
    const placed = new Set<string>();
    const kept: Planned[] = [];
    for (const item of pending) {
      const takenByBatch = placed.has(item.to.id);
      const takenOnDisk = item.to.folder.has(item.to.entryKey) && !leaving.has(item.to.id);
      if (takenByBatch || (takenOnDisk && !override)) {
        collided.add(item);
        leaving.delete(item.from.id);
        changed = true;
      } else {
        placed.add(item.to.id);
        kept.push(item);
      }
    }
    pending = kept;
  }
  const collisions = planned.filter((item) => collided.has(item)).map((item) => item.relocation);

  // 3. Take every entry out, then put each one in place.
  for (const { from } of pending) {
    from.folder.remove(from.entryKey);
  }
  const fit = crossCollection ? { targetLocales: destination.targetLocales } : undefined;
  for (const { to, stored } of pending) {
    to.folder.setEntry(to.entryKey, stored.entry, stored.meta ?? {}, fit);
  }

  // 4. Save each folder once: the ones that receive entries first.
  const receiving = new Set(pending.map(({ to }) => to.folder));
  const losing = pending.map(({ from }) => from.folder).filter((folder) => !receiving.has(folder));
  try {
    for (const folder of new Set([...receiving, ...losing])) {
      folder.save();
    }
  } catch (error) {
    errors.push(`Failed to write the move: ${error instanceof Error ? error.message : String(error)}`);
    // Some folders may be written: the index reads both collections again.
    const mutations = [reindexMutation(destination.translationsFolder)];
    if (crossCollection) mutations.push(reindexMutation(source.translationsFolder));
    return { moved: [], collisions, errors, mutations };
  }

  const moved: RelocatedEntry[] = [];
  for (const { relocation, to } of pending) {
    const entry = to.folder.treeEntry(to.entryKey);
    if (entry) moved.push({ from: relocation.from, to: relocation.to, entry });
  }

  return {
    moved,
    collisions,
    errors,
    mutations: [
      ...moved.map(({ from }) => removeMutation(source.translationsFolder, from)),
      ...moved.map(({ to, entry }) => upsertMutation(destination.translationsFolder, to, entry)),
    ],
  };
}

/** The relocation's source and destination slots and the stored entry, or why it cannot move. */
function plan(
  relocation: Relocation,
  source: Collection,
  destination: Collection,
  slot: (collection: Collection, key: string) => Slot,
): Planned | string {
  const { from, to } = relocation;
  try {
    validateKey(from);
    validateKey(to);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  let fromSlot: Slot;
  try {
    fromSlot = slot(source, from);
  } catch (error) {
    return `Failed to read source file for key: ${from}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const stored = fromSlot.folder.get(fromSlot.entryKey);
  if (!stored) {
    return `Source key not found: ${from}`;
  }

  let toSlot: Slot;
  try {
    toSlot = slot(destination, to);
  } catch (error) {
    return `Failed to read destination file for key: ${to}: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (toSlot.id === fromSlot.id) {
    return `Source and destination are the same key: ${from}`;
  }

  return { relocation, from: fromSlot, to: toSlot, stored };
}
