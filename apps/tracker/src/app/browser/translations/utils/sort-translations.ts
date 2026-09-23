import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { countByStatus, summaryTarget } from '@simoncodes-ca/domain';
import { STATUS_DISPLAY_ORDER } from '../../../shared/translation-status/translation-status-presentation';

export type SortField = 'key' | 'status';
export type SortDirection = 'asc' | 'desc';

const VERIFIED_RANK = STATUS_DISPLAY_ORDER.indexOf('verified');

/**
 * Sort rank of an item: the position, in the display order (new first), of the
 * earliest status its locales carry. Locales with no status rank as verified.
 */
function statusRank(item: ResourceSummaryDto, locales: string[]): number {
  const counts = countByStatus(locales.map((locale) => summaryTarget(item, locale)?.status));
  const rank = STATUS_DISPLAY_ORDER.findIndex((status) => counts[status] > 0);
  return rank === -1 ? VERIFIED_RANK : rank;
}

/** Sorts by full key, or by status (then full key). Full keys order a folder list the same as its entry keys. */
export function sortTranslations<T extends ResourceSummaryDto>(
  items: T[],
  field: SortField,
  direction: SortDirection,
  selectedLocales: string[],
): T[] {
  const sortedItems = [...items];

  sortedItems.sort((itemA, itemB) => {
    if (field === 'key') {
      return itemA.fullKey.localeCompare(itemB.fullKey, undefined, {
        sensitivity: 'base',
      });
    }

    // Sort by status
    const statusA = statusRank(itemA, selectedLocales);
    const statusB = statusRank(itemB, selectedLocales);

    if (statusA !== statusB) {
      return statusA - statusB;
    }

    // Secondary sort by key for ties
    return itemA.fullKey.localeCompare(itemB.fullKey, undefined, {
      sensitivity: 'base',
    });
  });

  if (direction === 'desc') {
    sortedItems.reverse();
  }

  return sortedItems;
}
