import { resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import {
  type Collection,
  computeTreeFingerprint,
  extractSubtree,
  loadResourceTree,
  type ResourceMutation,
  type ResourceTreeNode,
  type SearchResult,
  searchResourceTree,
  searchTranslations,
  type TreeFingerprint,
  treeFingerprintsMatch,
} from '@simoncodes-ca/core';
import type { CacheStatusDto } from '@simoncodes-ca/data-transfer';

/**
 * How long a disk fingerprint is trusted before it is computed again, in milliseconds.
 *
 * The scan is stat-only and costs a few milliseconds on a typical collection, but it runs
 * on read paths, so it is throttled rather than run per request.
 */
const DEFAULT_REVALIDATION_INTERVAL_MS = 2000;

/**
 * How many collections may be held in memory at once.
 *
 * Each entry holds a collection's whole tree, so the ceiling is a memory budget: several
 * tabs on different collections each keep their own index instead of evicting each other,
 * but an unbounded map would let a large workspace grow without limit. The least recently
 * used entry is dropped when the cap is reached.
 */
const DEFAULT_MAX_INDEXED_COLLECTIONS = 4;

/**
 * Result of reading a collection's tree.
 * - `ready`: the tree (or the subtree at the requested path; `null` when that path does not exist).
 * - `not-started` / `error`: the collection was not indexed (or the last attempt failed), so
 *   indexing was started by this read. Ask again shortly.
 * - `indexing`: indexing is already running.
 */
export type TreeRead =
  | { readonly status: 'ready'; readonly tree: ResourceTreeNode | null }
  | { readonly status: 'indexing' | 'not-started' | 'error' };

interface IndexEntry {
  /** The collection as it was when indexed. Its folder identifies which mutations apply. */
  readonly collection: Collection;
  status: 'indexing' | 'ready' | 'error';
  tree: ResourceTreeNode | null;
  indexedAt: Date | null;
  error?: string;
  /** Disk state as of the last index or own write, used to spot outside changes. */
  fingerprint: TreeFingerprint | null;
  /**
   * Monotonic use counter, bumped on every read and write of this entry. A counter rather
   * than a clock: several collections can be touched within the same millisecond, and
   * eviction still needs a strict order between them.
   */
  accessSequence: number;
  /** Throttle stamp for the disk fingerprint check. */
  lastRevalidationAt: number;
  /** Deferred fingerprint refresh that covers this entry's own writes. */
  pendingFingerprintRefresh: NodeJS.Timeout | null;
}

/**
 * Collection Index — the API's in-memory copy of each open collection's resource tree.
 *
 * Callers read with `tree()`, `search()` and `status()`, and report their writes with
 * `apply()`. Everything else is internal: indexing on first read, dropping the copy when
 * the disk changed outside this process, patching the tree after a write (or dropping it
 * when a patch cannot be applied), and the memory cap.
 */
@Injectable()
export class CollectionIndex {
  readonly #logger = new Logger(CollectionIndex.name);
  readonly #entries = new Map<string, IndexEntry>();
  #accessSequence = 0;

  readonly #revalidationIntervalMs = Number(
    process.env.LINGO_TRACKER_REVALIDATE_INTERVAL_MS ?? DEFAULT_REVALIDATION_INTERVAL_MS,
  );

  readonly #maxEntries = Math.max(
    1,
    Number(process.env.LINGO_TRACKER_MAX_CACHED_COLLECTIONS ?? DEFAULT_MAX_INDEXED_COLLECTIONS),
  );

  /** Reads the tree (or the subtree at `path`). Starts indexing when the collection is not indexed. */
  tree(collection: Collection, path = ''): TreeRead {
    const entry = this.#read(collection);

    if (!entry || entry.status === 'error') {
      this.#index(collection);
      return { status: entry ? 'error' : 'not-started' };
    }

    if (entry.status === 'indexing' || !entry.tree) {
      return { status: 'indexing' };
    }

    return { status: 'ready', tree: extractSubtree(entry.tree, path) };
  }

  /** Searches the indexed tree, or the disk when the collection is not indexed. Never starts indexing. */
  search(collection: Collection, query: string, maxResults: number): SearchResult[] {
    const entry = this.#read(collection);
    const options = { query, maxResults, baseLocale: collection.baseLocale };

    return entry?.status === 'ready' && entry.tree
      ? searchResourceTree({ tree: entry.tree, ...options })
      : searchTranslations({ translationsFolder: collection.translationsFolder, ...options });
  }

  /** Index state for the cache-status endpoint. Starts indexing when the collection is not indexed. */
  status(collection: Collection): CacheStatusDto {
    const entry = this.#read(collection);

    if (!entry) {
      this.#index(collection);
      return { status: 'not-started', collectionName: collection.name };
    }

    const status: CacheStatusDto = { status: entry.status, collectionName: collection.name };
    if (entry.indexedAt) status.indexedAt = entry.indexedAt.toISOString();
    if (entry.error) status.error = entry.error;
    if (entry.status === 'ready' && entry.tree) {
      status.stats = { totalKeys: countResources(entry.tree), localeCount: entry.collection.locales.length };
    }
    return status;
  }

  /**
   * Updates every indexed collection that a write changed. A collection whose tree does not
   * match what a mutation expects (or that got a `reindex`) is dropped, and the next read
   * indexes it again.
   */
  apply(mutations: readonly ResourceMutation[]): void {
    const patched = new Set<IndexEntry>();

    for (const mutation of mutations) {
      const folder = resolve(mutation.translationsFolder);

      for (const entry of [...this.#entries.values()]) {
        if (resolve(entry.collection.translationsFolder) !== folder) continue;

        if (mutation.kind === 'reindex') {
          this.#drop(entry, 'a write asked for a re-index');
          continue;
        }
        if (entry.status !== 'ready' || !entry.tree) continue;

        try {
          patchTree(entry.tree, mutation);
          entry.accessSequence = ++this.#accessSequence;
          patched.add(entry);
        } catch (error) {
          this.#drop(entry, error instanceof Error ? error.message : String(error));
        }
      }
    }

    for (const entry of patched) {
      if (this.#entries.get(entry.collection.name) === entry) this.#scheduleFingerprintRefresh(entry);
    }
  }

  /** Returns the entry for a read, after dropping it when the disk changed outside this process. */
  #read(collection: Collection): IndexEntry | undefined {
    const entry = this.#entries.get(collection.name);
    if (!entry) return undefined;

    entry.accessSequence = ++this.#accessSequence;

    if (entry.status === 'ready' && this.#changedOnDisk(entry, collection)) {
      this.#drop(entry, 'its translations folder changed on disk');
      return undefined;
    }
    return entry;
  }

  /**
   * The app holds a collection's whole tree in memory, so a CLI command, a `git checkout` or
   * a hand edit would otherwise stay invisible until a restart. Filesystem watching cannot
   * fix this portably: inotify never fires for Windows-side writes on a WSL `/mnt/c` mount,
   * and the same holds for several network and container mounts. So the check happens on
   * read, against a stat-only fingerprint, throttled so it costs almost nothing.
   */
  #changedOnDisk(entry: IndexEntry, collection: Collection): boolean {
    const now = Date.now();
    if (now - entry.lastRevalidationAt < this.#revalidationIntervalMs) return false;
    entry.lastRevalidationAt = now;

    const fingerprint = computeTreeFingerprint({ translationsFolder: collection.translationsFolder });

    // An own write is still waiting for its deferred fingerprint refresh. Adopt the
    // fingerprint now instead of reading our own change as somebody else's.
    if (entry.pendingFingerprintRefresh !== null) {
      this.#cancelFingerprintRefresh(entry);
      entry.fingerprint = fingerprint;
      return false;
    }

    return !treeFingerprintsMatch(entry.fingerprint, fingerprint);
  }

  #index(collection: Collection): void {
    const existing = this.#entries.get(collection.name);
    if (existing?.status === 'indexing') return;

    if (existing) {
      this.#cancelFingerprintRefresh(existing);
    } else {
      this.#evictLeastRecentlyUsed(collection.name);
    }

    const entry: IndexEntry = {
      collection,
      status: 'indexing',
      tree: null,
      indexedAt: null,
      fingerprint: null,
      accessSequence: ++this.#accessSequence,
      lastRevalidationAt: 0,
      pendingFingerprintRefresh: null,
    };
    this.#entries.set(collection.name, entry);

    const startedAt = Date.now();
    try {
      // Taken before the load: a write that lands mid-load then disagrees with this
      // fingerprint, which costs one extra re-index but never loses the change.
      entry.fingerprint = computeTreeFingerprint({ translationsFolder: collection.translationsFolder });
      entry.tree = loadResourceTree({
        translationsFolder: collection.translationsFolder,
        path: '',
        depth: Number.POSITIVE_INFINITY,
      });
      entry.status = 'ready';
      entry.indexedAt = new Date();
      entry.lastRevalidationAt = Date.now();
      this.#logger.log(`Indexed collection ${collection.name} in ${Date.now() - startedAt}ms`);
    } catch (error) {
      entry.status = 'error';
      entry.error = error instanceof Error ? error.message : 'Unknown error occurred';
      this.#logger.error(
        `Failed to index collection ${collection.name}: ${entry.error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  #drop(entry: IndexEntry, reason: string): void {
    this.#logger.log(`Dropping index of collection ${entry.collection.name}: ${reason}`);
    this.#cancelFingerprintRefresh(entry);
    this.#entries.delete(entry.collection.name);
  }

  /** Makes room for a new entry once the cap is reached by dropping the least recently used one. */
  #evictLeastRecentlyUsed(incomingName: string): void {
    if (this.#entries.size < this.#maxEntries) return;

    let victim: IndexEntry | undefined;
    for (const entry of this.#entries.values()) {
      if (entry.collection.name === incomingName) continue;
      if (!victim || entry.accessSequence < victim.accessSequence) victim = entry;
    }

    if (victim) this.#drop(victim, `the index holds at most ${this.#maxEntries} collections`);
  }

  /**
   * Queues a fingerprint refresh for the end of the current tick, so own writes do not later
   * read as outside changes. Bulk endpoints apply mutations once per resource in a loop, so
   * deferring collapses a whole batch into a single scan.
   */
  #scheduleFingerprintRefresh(entry: IndexEntry): void {
    if (entry.pendingFingerprintRefresh !== null) return;

    entry.pendingFingerprintRefresh = setTimeout(() => {
      entry.pendingFingerprintRefresh = null;
      entry.fingerprint = computeTreeFingerprint({ translationsFolder: entry.collection.translationsFolder });
    }, 0);

    // A pending refresh must never hold the process open on its own.
    entry.pendingFingerprintRefresh.unref?.();
  }

  #cancelFingerprintRefresh(entry: IndexEntry): void {
    if (entry.pendingFingerprintRefresh !== null) {
      clearTimeout(entry.pendingFingerprintRefresh);
      entry.pendingFingerprintRefresh = null;
    }
  }
}

/** Applies one write to an indexed tree. Throws when the tree does not match what the write expects. */
function patchTree(tree: ResourceTreeNode, mutation: Exclude<ResourceMutation, { kind: 'reindex' }>): void {
  switch (mutation.kind) {
    case 'upsert': {
      const { folder, name } = splitKey(mutation.key);
      const resources = folderAt(tree, folder, true).resources;
      const index = resources.findIndex((resource) => resource.key === name);
      if (index >= 0) {
        resources[index] = mutation.entry;
      } else {
        resources.push(mutation.entry);
        resources.sort((a, b) => a.key.localeCompare(b.key));
      }
      return;
    }
    case 'remove': {
      const { folder, name } = splitKey(mutation.key);
      const resources = folderAt(tree, folder, false).resources;
      const index = resources.findIndex((resource) => resource.key === name);
      if (index < 0) throw new Error(`resource "${mutation.key}" is not in the index`);
      resources.splice(index, 1);
      return;
    }
    case 'add-folder':
      folderAt(tree, segmentsOf(mutation.path), true);
      return;
    case 'remove-folder': {
      const { folder, name } = splitKey(mutation.path);
      const children = folderAt(tree, folder, false).children;
      const index = children.findIndex((child) => child.name === name);
      if (index < 0) throw new Error(`folder "${mutation.path}" is not in the index`);
      children.splice(index, 1);
      return;
    }
  }
}

/** Walks to the folder at `segments`. With `create`, missing folders are added (as on disk). */
function folderAt(tree: ResourceTreeNode, segments: readonly string[], create: boolean): ResourceTreeNode {
  let node = tree;

  for (let depth = 0; depth < segments.length; depth++) {
    const name = segments[depth];
    const fullPathSegments = segments.slice(0, depth + 1);
    let child = node.children.find((candidate) => candidate.name === name);

    if (!child && create) {
      child = {
        name,
        fullPathSegments,
        loaded: true,
        tree: { folderPathSegments: fullPathSegments, resources: [], children: [] },
      };
      node.children.push(child);
      node.children.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (!child?.tree) throw new Error(`folder "${fullPathSegments.join('.')}" is not in the index`);
    node = child.tree;
  }

  return node;
}

function segmentsOf(path: string): string[] {
  return path.split('.').filter((segment) => segment.length > 0);
}

/** Splits `a.b.c` into the folder `['a', 'b']` and the name `c`. */
function splitKey(key: string): { folder: string[]; name: string } {
  const segments = segmentsOf(key);
  return { folder: segments.slice(0, -1), name: segments[segments.length - 1] ?? '' };
}

function countResources(node: ResourceTreeNode): number {
  return node.children.reduce(
    (total, child) => total + (child.tree ? countResources(child.tree) : 0),
    node.resources.length,
  );
}
