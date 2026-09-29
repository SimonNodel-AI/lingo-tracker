import { inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { TranslocoService } from '@jsverse/transloco';
import { NotificationService } from '../../../../shared/notification';
import { BrowserStore } from '../../../store/browser.store';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { apiErrorMessage } from '../../../../shared/api-error/api-error';
import { TranslationEditorLauncher } from '../../../services/translation-editor-launcher';
import { injectConfirm } from '../../../../shared/confirm';
import type { ConfirmationDialogData } from '../../../../shared/components/confirmation-dialog/confirmation-dialog-data';
import type { ResourceSummaryDto, TranslateResourceResponseDto } from '@simoncodes-ca/data-transfer';

export function withItemActions() {
  return signalStoreFeature(
    {
      state: type<{ translatingKeys: Set<string>; recentlyUpdatedKey: string | undefined }>(),
      methods: type<{
        addTranslatingKey: (key: string) => void;
        removeTranslatingKey: (key: string) => void;
        flashRecentlyUpdated: (key: string) => void;
      }>(),
    },
    withMethods((store) => {
      const browserStore = inject(BrowserStore);
      const confirm = injectConfirm();
      const launcher = inject(TranslationEditorLauncher);
      const destroyRef = inject(DestroyRef);
      const notifications = inject(NotificationService);
      const transloco = inject(TranslocoService);

      return {
        copyKey(translation: ResourceSummaryDto): void {
          if (!navigator.clipboard?.writeText) {
            notifications.error(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.COPYFAILED));
            return;
          }
          navigator.clipboard
            .writeText(translation.fullKey)
            .then(() => notifications.success(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.COPIEDTOCLIPBOARD)))
            .catch(() => notifications.error(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.COPYFAILED)));
        },

        /** Opens the editor on a row; a save that keeps the entry in this list flashes its row. */
        editTranslation(translation: ResourceSummaryDto): void {
          void launcher.openEdit(translation).then((outcome) => {
            if (outcome.kind === 'saved') store.flashRecentlyUpdated(outcome.fullKey);
          });
        },

        async deleteTranslation(translation: ResourceSummaryDto): Promise<void> {
          // Last line of defence for every caller. A read-only collection must
          // never reach the confirmation dialog: asking the user to confirm a
          // deletion the API will refuse is a promise the UI cannot keep.
          const collectionName = browserStore.selectedCollection();
          if (!collectionName || browserStore.isReadOnly()) return;

          const { fullKey } = translation;

          const dialogData: ConfirmationDialogData = {
            title: transloco.translate(TRACKER_TOKENS.BROWSER.DIALOG.DELETERESOURCE.TITLE),
            message: transloco.translate(TRACKER_TOKENS.BROWSER.DIALOG.DELETERESOURCE.MESSAGEX, { key: fullKey }),
            confirmButtonText: transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.DELETE),
            cancelButtonText: transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.CANCEL),
            actionType: 'destructive',
          };

          if (!(await confirm(dialogData, { canOpen: () => !destroyRef.destroyed })) || destroyRef.destroyed) return;
          browserStore
            .deleteResource(collectionName, fullKey)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (response) => {
                if (response.entriesDeleted > 0) {
                  notifications.success(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.RESOURCEDELETED));
                } else {
                  notifications.error(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.DELETEFAILED));
                }
              },
              error: (error: unknown) => {
                const message = apiErrorMessage(error, transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.DELETEFAILED));
                notifications.error(message);
              },
            });
        },

        translateResource(translation: ResourceSummaryDto): void {
          const collectionName = browserStore.selectedCollection();
          if (!collectionName || browserStore.isReadOnly()) return;
          const { fullKey } = translation;
          store.addTranslatingKey(fullKey);

          browserStore
            .translateResource(collectionName, fullKey)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe({
              next: (response: TranslateResourceResponseDto) => {
                store.removeTranslatingKey(fullKey);
                store.flashRecentlyUpdated(fullKey);

                const { translatedCount, skippedLocales } = response;
                if (translatedCount > 0) {
                  const successMessage =
                    translatedCount === 1
                      ? transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.LOCALETRANSLATED)
                      : transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.LOCALESTRANSLATEDX, {
                          count: translatedCount,
                        });
                  notifications.success(successMessage);
                } else if (skippedLocales.length === 0) {
                  notifications.info(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.ALLLOCALESUPTODATE));
                }
                if (skippedLocales.length > 0) {
                  notifications.warning(
                    transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.SKIPPEDLOCALESX, {
                      locales: skippedLocales.join(', '),
                    }),
                  );
                }
              },
              error: (error: unknown) => {
                store.removeTranslatingKey(fullKey);
                const message = apiErrorMessage(
                  error,
                  transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.TRANSLATEFAILED),
                );
                notifications.error(message);
              },
            });
        },
      };
    }),
  );
}
