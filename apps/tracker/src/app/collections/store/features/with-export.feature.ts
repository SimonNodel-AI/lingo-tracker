import { computed, DestroyRef, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { patchState, signalStoreFeature, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import type { ExportRequestDto } from '@simoncodes-ca/data-transfer';
import { timer } from 'rxjs';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { SESSION_STORAGE } from '../../../shared/storage/browser-storage';
import { json, KeyedStorage } from '../../../shared/storage/keyed-storage';
import { CollectionsApiService } from '../../services/collections-api.service';
import {
  EXPORT_RUN_STORAGE_KEY,
  ExportRunController,
  type ExportRunState,
  readPersistedExportRun,
} from '../export-run-controller';

export type { ExportRunState } from '../export-run-controller';

export function withExportFeature() {
  return signalStoreFeature(
    withState<{ exportRun: ExportRunState | null }>({ exportRun: null }),
    withComputed(({ exportRun }) => ({ isExporting: computed(() => exportRun()?.status === 'running') })),
    withMethods((store) => {
      const api = inject(CollectionsApiService);
      const transloco = inject(TranslocoService);
      const controller = new ExportRunController(
        {
          start: (request) => api.startExport(request),
          getJob: (id) => api.getExportJob(id),
          // Used only after a job was accepted; a start failure stays with the dialog.
          failureMessage: () => transloco.translate(TRACKER_TOKENS.EXPORT.RUN.FAILED),
        },
        new KeyedStorage(inject(SESSION_STORAGE), EXPORT_RUN_STORAGE_KEY, json(readPersistedExportRun)),
        { now: () => new Date().toISOString(), poll: (ms) => timer(ms, ms) },
      );
      const subscription = controller.changes.subscribe((exportRun) => patchState(store, { exportRun }));
      inject(DestroyRef).onDestroy(() => {
        subscription.unsubscribe();
        controller.destroy();
      });
      return {
        dryRunExport: (body: ExportRequestDto) => api.dryRunExport(body),
        startExport: (body: ExportRequestDto) => controller.start(body),
        retryExport: () => controller.retry(),
        clearExportRun: () => controller.clear(),
        restoreExportRun: () => controller.restore(),
      };
    }),
    withHooks({ onInit: (store) => store.restoreExportRun() }),
  );
}
