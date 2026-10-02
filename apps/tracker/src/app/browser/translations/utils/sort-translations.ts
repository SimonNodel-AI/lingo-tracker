import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import type { StatusCounts } from '@simoncodes-ca/domain';
import { STATUS_DISPLAY_ORDER } from '../../../shared/translation-status/translation-status-presentation';

export type SortField = 'key' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface TranslationStatusRecord<T extends ResourceSummaryDto> {
  readonly item: T;
  readonly counts: StatusCounts;
}

const VERIFIED_RANK = STATUS_DISPLAY_ORDER.indexOf('verified');

/**
 * Sort rank of an item: the position, in the display order (new first), of the
 * earliest display status its locales carry (a locale with no metadata is `new`).
 * Locales with no status rank as verified.
 * Status sort puts `new` work first (STATUS_DISPLAY_ORDER), while rows show the
 * worst locale first (STATUS_PRECEDENCE, `stale` first), a difference that remains
 * an open product question.
 */
function statusRank(counts: StatusCounts): number {
  const rank = STATUS_DISPLAY_ORDER.findIndex((status) => counts[status] > 0);
  return rank === -1 ? VERIFIED_RANK : rank;
}

/**
 * Sorts status-scope records by full key, or by their counted statuses (then full
 * key). Computes each status rank once without reading the resource's targets.
 */
export function sortTranslationRecords<T extends ResourceSummaryDto>(
  records: readonly TranslationStatusRecord<T>[],
  field: SortField,
  direction: SortDirection,
): TranslationStatusRecord<T>[] {
  const sortedRecords = records.map((record) => ({
    record,
    rank: field === 'status' ? statusRank(record.counts) : 0,
  }));

  sortedRecords.sort((recordA, recordB) => {
    if (recordA.rank !== recordB.rank) {
      return recordA.rank - recordB.rank;
    }

    return recordA.record.item.fullKey.localeCompare(recordB.record.item.fullKey, undefined, {
      sensitivity: 'base',
    });
  });

  if (direction === 'desc') {
    sortedRecords.reverse();
  }

  return sortedRecords.map(({ record }) => record);
}
