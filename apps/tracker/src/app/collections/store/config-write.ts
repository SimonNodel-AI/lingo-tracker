import { patchState, type WritableStateSource } from '@ngrx/signals';
import type { LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';
import { type Observable, switchMap, tap } from 'rxjs';
import type { CollectionsApiService } from '../services/collections-api.service';

/** The store state a Config Write lands in. */
export interface ConfigWriteState {
  config: LingoTrackerConfigDto | null;
  /** Message of a failed config load; a successful write clears it, as the config is fresh again. */
  error: string | null;
}

/**
 * Config Write: one write to `.lingo-tracker.json` through the API, then the config as it
 * now is. Every collection, bundle and global-config mutation of `CollectionsStore` is one
 * of these, so a caller learns the outcome the same way for all of them: the Observable
 * resolves with the reloaded config once the store holds it, or errors with the `ApiError`
 * of the rejected write (a `conflict` for a taken name, an `invalid` whose `details` carry
 * the rule messages, anything else), in which case the store is untouched. The Observable
 * is cold: nothing is sent until the caller subscribes, and the caller owns the reaction —
 * a dialog that stays open on a rejection, a toast on real success.
 */
export function configWrite(
  store: WritableStateSource<ConfigWriteState>,
  api: Pick<CollectionsApiService, 'getConfig'>,
  write: Observable<unknown>,
): Observable<LingoTrackerConfigDto> {
  return write.pipe(
    switchMap(() => api.getConfig()),
    tap((config) => patchState(store, { config, error: null })),
  );
}
