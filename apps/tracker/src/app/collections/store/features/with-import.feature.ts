import { computed, DestroyRef, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { patchState, signalStoreFeature, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { JOB_RETENTION_MS, type ImportRequestDto } from '@simoncodes-ca/data-transfer';
import { timer } from 'rxjs';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { SESSION_STORAGE } from '../../../shared/storage/browser-storage';
import { json, KeyedStorage } from '../../../shared/storage/keyed-storage';
import { CollectionsApiService } from '../../services/collections-api.service';
import {
  IMPORT_RUN_STORAGE_KEY,
  ImportRunController,
  type ImportRunState,
  readPersistedImportRun,
} from '../import-run-controller';

export type { ImportRunState } from '../import-run-controller';

export function withImportFeature() {
  return signalStoreFeature(
    withState<{ importRun: ImportRunState | null }>({ importRun: null }),
    withComputed(({ importRun }) => ({ isImporting: computed(() => importRun()?.status === 'running') })),
    withMethods((store) => {
      const api = inject(CollectionsApiService);
      const transloco = inject(TranslocoService);
      const controller = new ImportRunController(
        {
          start: (request) => api.startImport(request),
          getJob: (id) => api.getImportJob(id),
          // Used only after a job was accepted; a start failure stays with the dialog.
          failureMessage: () => transloco.translate(TRACKER_TOKENS.IMPORT.TOAST.STARTFAILED),
        },
        new KeyedStorage(inject(SESSION_STORAGE), IMPORT_RUN_STORAGE_KEY, json(readPersistedImportRun)),
        { now: () => new Date().toISOString(), poll: (ms) => timer(ms, ms) },
      );
      const subscription = controller.changes.subscribe((importRun) => patchState(store, { importRun }));
      inject(DestroyRef).onDestroy(() => {
        subscription.unsubscribe();
        controller.destroy();
      });
      return {
        /** Evaluate at read time so expiry does not depend on a signal changing. */
        isImportSummaryAvailable(now = Date.now()): boolean {
          const run = store.importRun();
          if (run?.status !== 'completed' || !run.jobId?.trim() || !run.finishedAt) return false;
          const age = now - Date.parse(run.finishedAt);
          return age >= 0 && age <= JOB_RETENTION_MS;
        },
        listImportSources: (collection: string, folder?: string) => api.listImportSources(collection, folder),
        dryRunImport: (body: ImportRequestDto) => api.dryRunImport(body),
        startImport: (body: ImportRequestDto) => controller.start(body),
        retryImport: () => controller.retry(),
        clearImportRun: () => controller.clear(),
        restoreImportRun: () => controller.restore(),
      };
    }),
    withHooks({ onInit: (store) => store.restoreImportRun() }),
  );
}
