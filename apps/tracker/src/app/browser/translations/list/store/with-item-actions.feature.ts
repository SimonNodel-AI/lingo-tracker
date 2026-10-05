import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { TRACKER_TOKENS } from '../../../../../i18n-types/tracker-resources';
import { copyToClipboard } from '../../../../shared/clipboard';
import { injectConfirmedWrite } from '../../../../shared/confirmed-write';
import { NotificationService } from '../../../../shared/notification';
import { injectFeedback } from '../../../feedback';
import { TranslationEditorLauncher } from '../../../services/translation-editor-launcher';
import { BrowserStore } from '../../../store/browser.store';

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
      const write = injectConfirmedWrite();
      const launcher = inject(TranslationEditorLauncher);
      const destroyRef = inject(DestroyRef);
      const notifications = inject(NotificationService);
      const feedback = injectFeedback();
      const transloco = inject(TranslocoService);

      return {
        copyKey(translation: ResourceSummaryDto): void {
          void copyToClipboard(translation.fullKey).then((outcome) => {
            if (outcome === 'copied') {
              notifications.success(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.COPIEDTOCLIPBOARD));
            } else {
              notifications.error(transloco.translate(TRACKER_TOKENS.BROWSER.TOAST.COPYFAILED));
            }
          });
        },

        /** Opens the editor on a row; a save that keeps the entry in this list flashes its row. */
        editTranslation(translation: ResourceSummaryDto): void {
          void launcher.openEdit(translation).then((outcome) => {
            if (outcome.kind === 'saved') store.flashRecentlyUpdated(outcome.fullKey);
          });
        },

        deleteTranslation(translation: ResourceSummaryDto): Promise<void> {
          const { fullKey } = translation;
          const confirm = write.confirmDestructive({
            title: TRACKER_TOKENS.BROWSER.DIALOG.DELETERESOURCE.TITLE,
            message: { token: TRACKER_TOKENS.BROWSER.DIALOG.DELETERESOURCE.MESSAGEX, params: { key: fullKey } },
            cancelButtonText: TRACKER_TOKENS.COMMON.ACTIONS.CANCEL,
          });
          return write.runWrite(browserStore.requestEntryDelete(fullKey, confirm));
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
