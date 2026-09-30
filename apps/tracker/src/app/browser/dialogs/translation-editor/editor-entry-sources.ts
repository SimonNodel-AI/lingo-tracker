import { computed } from '@angular/core';
import type { BrowserStore } from '../../store/browser.store';

/** Tags already used by entries in the browser's current collection. */
export function editorTagSuggestions(browserStore: InstanceType<typeof BrowserStore>) {
  return computed(() => [...new Set(browserStore.translations().flatMap((resource) => resource.tags))].sort());
}
