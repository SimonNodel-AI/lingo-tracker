import type { FolderNodeDto, ResourceSummaryDto, ResourceTreeDto } from '@simoncodes-ca/data-transfer';
import type { Collection, FolderChild, ResourceTreeEntry, ResourceTreeNode } from '@simoncodes-ca/core';
import { buildResourceSummary, resolveResourceKey } from '@simoncodes-ca/domain';

/** Maps a tree node to its DTO. Every resource becomes a Resource Summary of `collection`. */
export function mapResourceTreeToDto(node: ResourceTreeNode, collection: Collection): ResourceTreeDto {
  const path = node.folderPathSegments.join('.');
  return {
    path,
    resources: node.resources.map((entry) => mapResourceEntryToSummary(entry, path, collection)),
    children: node.children.map((child) => mapFolderChildToDto(child, collection)),
  };
}

/**
 * Maps a stored entry to its Resource Summary.
 *
 * @param entry - The entry; its `key` is relative to `folderPath` (a single segment, or a
 *   sub-path for entries collected from nested folders).
 * @param folderPath - Dot-delimited folder `entry.key` is relative to; `''` for the root.
 */
export function mapResourceEntryToSummary(
  entry: ResourceTreeEntry,
  folderPath: string,
  collection: Collection,
): ResourceSummaryDto {
  return buildResourceSummary(resolveResourceKey(entry.key, folderPath), entry, collection);
}

function mapFolderChildToDto(child: FolderChild, collection: Collection): FolderNodeDto {
  return {
    name: child.name,
    fullPath: child.fullPathSegments.join('.'),
    loaded: child.loaded,
    tree: child.tree ? mapResourceTreeToDto(child.tree, collection) : undefined,
  };
}
