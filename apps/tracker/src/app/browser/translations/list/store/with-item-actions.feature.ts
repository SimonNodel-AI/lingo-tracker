import { inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { TranslocoService } from '@jsverse/transloco';
import { NotificationService } from '../../../../shared/notification';
import { BrowserStore } from '../../../store/browser.store';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { injectFeedback } from '../../../feedback';
import { firstValueFrom, tap } from 'rxjs';
import { TranslationEditorLauncher } from '../../../services/translation-editor-launcher';
import { injectConfirm } from '../../../../shared/confirm';
import type { ConfirmationDialogData } from '../../../../shared/components/confirmation-dialog/confirmation-dialog-data';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';

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
      const feedback = injectFeedback();
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
          const { fullKey } = translation;

          const dialogData: ConfirmationDialogData = {
            title: transloco.translate(TRACKER_TOKENS.BROWSER.DIALOG.DELETERESOURCE.TITLE),
            message: transloco.translate(TRACKER_TOKENS.BROWSER.DIALOG.DELETERESOURCE.MESSAGEX, { key: fullKey }),
            confirmButtonText: transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.DELETE),
            cancelButtonText: transloco.translate(TRACKER_TOKENS.COMMON.ACTIONS.CANCEL),
            actionType: 'destructive',
          };

          await firstValueFrom(
            browserStore
              .requestEntryDelete(fullKey, (inSession) =>
                confirm(dialogData, { canOpen: () => inSession() && !destroyRef.destroyed }).then(
                  (yes) => yes && !destroyRef.destroyed,
                ),
              )
              .pipe(
                takeUntilDestroyed(destroyRef),
                tap((outcome) => feedback.toast(outcome.feedback)),
              ),
            { defaultValue: null },
          );
        },

        translateResource(translation: ResourceSummaryDto): void {
          const { fullKey } = translation;
          store.addTranslatingKey(fullKey);

          browserStore
            .translateResource(fullKey)
            .pipe(takeUntilDestroyed(destroyRef))
            .subscribe((outcome) => {
              store.removeTranslatingKey(fullKey);
              if (outcome.kind === 'translated' || outcome.kind === 'up-to-date' || outcome.kind === 'partial') {
                store.flashRecentlyUpdated(fullKey);
              }
              outcome.feedback.forEach(feedback.toast);
            });
        },
      };
    }),
  );
}
