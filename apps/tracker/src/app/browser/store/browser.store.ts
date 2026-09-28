import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap, switchMap, catchError, of } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { NotificationService } from '../../shared/notification';
import { BrowserApiService } from '../services/browser-api.service';
import { apiErrorMessage } from '../../shared/api-error/api-error';
import { initialRootState } from './root-state';
import { withSearchFeature } from './features/with-search.feature';
import { withCacheStatusFeature } from './features/with-cache-status.feature';
import { withFilterFeature } from './features/with-filter.feature';
import { withViewPreferencesFeature } from './features/with-view-preferences.feature';
import { withTranslationsFeature } from './features/with-translations.feature';
import { withFolderTreeFeature } from './features/with-folder-tree.feature';
import { withEntryWritesFeature } from './features/with-entry-writes.feature';
import { withBrowserSessionFeature } from './features/with-browser-session.feature';
import { splitResolvedKey } from '@simoncodes-ca/domain';
import { captureSession, withinSession } from './session-guard';

export const BrowserStore = signalStore(
  { providedIn: 'root' },
  withState(initialRootState),
  withSearchFeature(),
  withFilterFeature(),
  withTranslationsFeature(),
  withEntryWritesFeature(),
  withFolderTreeFeature(),
  withCacheStatusFeature(),
  withViewPreferencesFeature(),
  withBrowserSessionFeature(),
  withComputed((store) => ({
    /**
     * Combined disable signal for editing affordances: true when an operation is in
     * progress/search is active (`isDisabled`) OR the collection is read-only.
     */
    effectiveDisabled: computed(() => store.isDisabled() || store.isReadOnly()),
  })),
  withMethods((store) => {
    const api = inject(BrowserApiService);
    const notifications = inject(NotificationService);
    const transloco = inject(TranslocoService);

    return {
      setDisabled(disabled: boolean): void {
        patchState(store, { isDisabled: disabled });
      },

      clearError(): void {
        patchState(store, { error: null });
      },

      moveResource: rxMethod<{ sourceKey: string; destinationFolderPath: string }>(
        pipe(
          tap(() => patchState(store, { isDisabled: true, error: null })),
          switchMap(({ sourceKey, destinationFolderPath }) => {
            const inSession = captureSession(store);
            const collection = store.selectedCollection();
            if (!collection) {
              patchState(store, { isDisabled: false });
              return of(null);
            }

            const sourceFolderPath = splitResolvedKey(sourceKey).folderPath.join('.');

            if (sourceFolderPath === destinationFolderPath) {
              notifications.info(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.RESOURCEALREADYINFOLDER));
              patchState(store, { isDisabled: false });
              return of(null);
            }

            const entryName = splitResolvedKey(sourceKey).entryKey;
            const destinationKey = destinationFolderPath ? `${destinationFolderPath}.${entryName}` : entryName;

            const currentTranslations = store.translations();
            const optimisticTranslations = currentTranslations.filter((r) => r.fullKey !== sourceKey);
            patchState(store, { translations: optimisticTranslations });

            return api.moveResource(collection, sourceKey, destinationKey).pipe(
              withinSession(inSession),
              tap(() => {
                notifications.success(
                  transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.RESOURCEMOVEDX, {
                    name: entryName,
                    folder: destinationFolderPath || 'root',
                  }),
                );
                patchState(store, { isDisabled: false });

                store.loadRootFolders();
                store.selectFolder(store.currentFolderPath());
              }),
              catchError((error: unknown) => {
                const errorMessage = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.MOVERESOURCEFAILED),
                );
                patchState(store, {
                  translations: currentTranslations,
                  isDisabled: false,
                  error: errorMessage,
                });
                notifications.error(errorMessage);
                return of(null);
              }),
            );
          }),
        ),
      ),
    };
  }),
);
