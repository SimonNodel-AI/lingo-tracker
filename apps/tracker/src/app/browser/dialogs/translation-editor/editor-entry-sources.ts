import { computed } from '@angular/core';
import type { FolderPeekScope } from '../../services/folder-peek';
import type { BrowserStore } from '../../store/browser.store';
import type { KnownEntries } from './resource-entry-draft';

/** The browser and peek data the editor uses for collisions, context and tag suggestions. */
export function editorEntrySources(browserStore: InstanceType<typeof BrowserStore>, folderPeek: FolderPeekScope) {
  const rootFolders = browserStore.rootFolders;
  const knownEntries = computed<KnownEntries>(() => ({
    rootFolders: rootFolders(),
    browserFolderPath: browserStore.currentFolderPath(),
    browserEntries: browserStore.translations(),
    fetched: folderPeek.folderEntries(),
  }));
  const tagSuggestions = computed(() =>
    [...new Set(browserStore.translations().flatMap((resource) => resource.tags))].sort(),
  );
  return { rootFolders, knownEntries, tagSuggestions };
}
