import { countByStatus, type TranslationStatus } from '@simoncodes-ca/domain';
import { STATUS_DISPLAY_ORDER } from '../../../shared/translation-status/translation-status-presentation';

export type SortField = 'key' | 'status';
export type SortDirection = 'asc' | 'desc';

const VERIFIED_RANK = STATUS_DISPLAY_ORDER.indexOf('verified');

/**
 * Sort rank of an item: the position, in the display order (new first), of the
 * earliest status its locales carry. Locales with no status rank as verified.
 */
function statusRank(statuses: Record<string, TranslationStatus | undefined>, locales: string[]): number {
  const counts = countByStatus(locales.map((locale) => statuses[locale]));
  const rank = STATUS_DISPLAY_ORDER.findIndex((status) => counts[status] > 0);
  return rank === -1 ? VERIFIED_RANK : rank;
}

export function sortTranslations<
  T extends {
    key: string;
    status?: Record<string, TranslationStatus | undefined>;
  },
>(items: T[], field: SortField, direction: SortDirection, selectedLocales: string[]): T[] {
  const sortedItems = [...items];

  sortedItems.sort((itemA, itemB) => {
    if (field === 'key') {
      return itemA.key.localeCompare(itemB.key, undefined, {
        sensitivity: 'base',
      });
    }

    // Sort by status
    const statusA = statusRank(itemA.status ?? {}, selectedLocales);
    const statusB = statusRank(itemB.status ?? {}, selectedLocales);

    if (statusA !== statusB) {
      return statusA - statusB;
    }

    // Secondary sort by key for ties
    return itemA.key.localeCompare(itemB.key, undefined, {
      sensitivity: 'base',
    });
  });

  if (direction === 'desc') {
    sortedItems.reverse();
  }

  return sortedItems;
}
