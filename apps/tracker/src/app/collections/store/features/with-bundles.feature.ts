import { computed, inject } from '@angular/core';
import { signalStoreFeature, withState, withComputed, withMethods, withHooks, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap, switchMap, mergeMap, catchError, of, timer, takeWhile, type Observable } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import { CollectionsApiService } from '../../services/collections-api.service';
import { injectConfigWrite } from '../config-write';
import type {
  BundleDefinitionDto,
  BundleDryRunRequestDto,
  BundleDryRunResultDto,
  CreateBundleDto,
  LingoTrackerConfigDto,
  UpdateBundleDto,
} from '@simoncodes-ca/data-transfer';
import {
  isJobFinished,
  mapJobToRun,
  readPersistedRuns,
  toBundleErrorMessage,
  type BundleRunState,
} from '../bundle-runs';

export type { BundleRunState, BundleRunStatus } from '../bundle-runs';

export interface BundleEntry {
  name: string;
  definition: BundleDefinitionDto;
}

interface BundlesState {
  /** Generation run state keyed by bundle name. */
  bundleRuns: Record<string, BundleRunState>;
  /** Names actually started by the last Generate all request; not persisted. */
  bundleBatch: readonly string[];
}

const initialBundlesState: BundlesState = {
  bundleRuns: {},
  bundleBatch: [],
};

/** Polling interval for bundle generation jobs, in milliseconds. */
export const BUNDLE_JOB_POLL_INTERVAL_MS = 500;

/**
 * Session storage key for bundle run state.
 *
 * Generating a bundle whose output the dev server watches (the tracker bundle writes
 * the Tracker's own i18n assets) reloads the page mid-run, which would otherwise wipe
 * the result strip the moment it was earned. Runs are mirrored here so a reload keeps
 * the strip on screen until it is dismissed or a new run replaces it.
 */
export const BUNDLE_RUNS_STORAGE_KEY = 'lingo-tracker.bundleRuns';

/** Reads the raw storage value; unavailable storage behaves like an absent value. */
function readStoredBundleRuns(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(BUNDLE_RUNS_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Mirrors runs to session storage. Storage failures are never worth breaking a run over. */
function persistRuns(runs: Record<string, BundleRunState>): void {
  try {
    globalThis.sessionStorage?.setItem(BUNDLE_RUNS_STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // Private mode, a full quota or no storage at all: the strip simply will not
    // survive a reload, which is the behaviour we had before.
  }
}

/**
 * Adds bundle definitions and bundle generation runs to the collections store.
 *
 * The definition mutations are Config Writes (`../config-write.ts`): each returns the
 * reloaded config, or errors with the `ApiError` of the rejected write. Requires `config`
 * and `error` in the host store state.
 */
export function withBundlesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{ config: LingoTrackerConfigDto | null; error: string | null }>(),
    },
    withState(initialBundlesState),
    withComputed(({ config, bundleRuns, bundleBatch }) => {
      const bundleEntries = computed<BundleEntry[]>(() => {
        const bundles = config()?.bundles;
        if (!bundles) return [];
        return Object.entries(bundles)
          .map(([name, definition]) => ({ name, definition }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });

      const runningBundleCount = computed(
        () => Object.values(bundleRuns()).filter((run) => run.status === 'running').length,
      );

      return {
        /** Bundles from the config as a name-sorted array. */
        bundleEntries,
        hasBundles: computed(() => bundleEntries().length > 0),
        bundleCount: computed(() => bundleEntries().length),
        /** Project name reported by the API (basename of its working directory). */
        projectName: computed(() => config()?.projectName ?? null),
        batchTotal: computed(() => bundleBatch().length),
        isBatchRunning: computed(() => bundleBatch().some((name) => bundleRuns()[name]?.status === 'running')),
        /** 1-based position for the busy button, capped at the number of started bundles. */
        batchPosition: computed(() => {
          const batch = bundleBatch();
          const runs = bundleRuns();
          const finished = batch.filter((name) => {
            const status = runs[name]?.status;
            return status === 'completed' || status === 'failed';
          }).length;
          return Math.min(Math.max(batch.length, 1), finished + 1);
        }),
        runningBundleCount,
        isAnyBundleRunning: computed(() => runningBundleCount() > 0),
      };
    }),
    withMethods((store) => {
      const api = inject(CollectionsApiService);
      const transloco = inject(TranslocoService);
      const configWrite = injectConfigWrite(store);

      const writeRuns = (bundleRuns: Record<string, BundleRunState>): void => {
        patchState(store, { bundleRuns });
        persistRuns(bundleRuns);
      };

      const setRun = (name: string, run: BundleRunState): void => {
        writeRuns({ ...store.bundleRuns(), [name]: run });
      };

      const clearRun = (name: string): void => {
        const { [name]: _removed, ...remainingRuns } = store.bundleRuns();
        writeRuns(remainingRuns);
      };

      /** Polls a job to completion, writing every snapshot onto the card. */
      const pollJob = (name: string, jobId: string) =>
        timer(BUNDLE_JOB_POLL_INTERVAL_MS, BUNDLE_JOB_POLL_INTERVAL_MS).pipe(
          switchMap(() => api.getBundleJob(jobId)),
          tap((snapshot) => setRun(name, mapJobToRun(snapshot, store.bundleRuns()[name], new Date().toISOString()))),
          takeWhile((snapshot) => !isJobFinished(snapshot), true),
        );

      /**
       * Picks a run back up after a page reload. If the job has since been evicted or
       * the API restarted, the run is dropped rather than shown as a failure the user
       * can neither explain nor act on.
       */
      const resumeGeneration = rxMethod<{ name: string; jobId: string }>(
        pipe(
          mergeMap(({ name, jobId }) =>
            api.getBundleJob(jobId).pipe(
              tap((job) => setRun(name, mapJobToRun(job, store.bundleRuns()[name], new Date().toISOString()))),
              switchMap((job) => (isJobFinished(job) ? of(job) : pollJob(name, jobId))),
              catchError(() => {
                clearRun(name);
                return of(null);
              }),
            ),
          ),
        ),
      );

      const startGeneration = rxMethod<{ name: string; locales?: readonly string[] }>(
        pipe(
          // Replace, never merge: a new run must drop the previous run's result so a
          // stale "Generated" strip cannot sit on the card while this one is in flight.
          // Seeding the total from the locales this run will write also lets the card
          // show "0 of 6 locales" and a sized bar immediately, not an empty strip
          // until the first poll lands.
          tap(({ name, locales }) =>
            setRun(name, {
              status: 'running',
              progress: { current: 0, total: locales?.length ?? store.config()?.locales?.length ?? 0 },
            }),
          ),
          // mergeMap so several bundles can run and poll concurrently (Generate all).
          mergeMap(({ name, locales }) =>
            api.generateBundle(name, locales ? { locales } : {}).pipe(
              tap((job) => setRun(name, mapJobToRun(job, store.bundleRuns()[name], new Date().toISOString()))),
              switchMap((job) => (isJobFinished(job) ? of(job) : pollJob(name, job.jobId))),
              catchError((error: unknown) => {
                setRun(name, {
                  ...store.bundleRuns()[name],
                  status: 'failed',
                  error: toBundleErrorMessage(error, transloco.translate(TRACKER_TOKENS.BUNDLES.TOAST.GENERATEFAILED)),
                  finishedAt: new Date().toISOString(),
                });
                return of(null);
              }),
            ),
          ),
        ),
      );

      const tryStartGeneration = (name: string, locales?: readonly string[]): boolean => {
        if (store.bundleRuns()[name]?.status === 'running') return false;
        startGeneration({ name, locales });
        return true;
      };

      const generateBundle = (name: string, locales?: readonly string[]): void => {
        tryStartGeneration(name, locales);
      };

      return {
        /** Plans a bundle without changing config or writing output files. */
        dryRunBundle(request: BundleDryRunRequestDto): Observable<BundleDryRunResultDto> {
          return api.dryRunBundle(request);
        },
        /** Creates a bundle definition. A taken name errors with a `conflict`; a definition the rules reject with an `invalid` whose `details` are the rule messages. */
        createBundle(data: CreateBundleDto): Observable<LingoTrackerConfigDto | null> {
          return configWrite(api.createBundle(data));
        },

        /** Updates the bundle `name` names; `update.name` renames it. */
        updateBundle(name: string, update: UpdateBundleDto): Observable<LingoTrackerConfigDto | null> {
          return configWrite(api.updateBundle(name, update));
        },

        /** Deletes a bundle definition and drops its run state once the server confirms it. */
        deleteBundle(name: string): Observable<LingoTrackerConfigDto | null> {
          return configWrite(api.deleteBundle(name)).pipe(tap(() => clearRun(name)));
        },

        /**
         * Starts generation of one bundle and polls the job until it completes or fails.
         * Ignored while the same bundle is already running.
         */
        generateBundle,

        /**
         * Re-runs a bundle after a failure (or any finished run).
         */
        retryBundle(name: string): void {
          generateBundle(name);
        },

        /**
         * Starts every configured bundle that is not running and records only those starts.
         * Jobs poll independently; an immediate request failure still counts as a started run.
         * Ignored while the current batch is still running.
         */
        generateAllBundles(): void {
          if (store.isBatchRunning()) return;
          const started: string[] = [];
          for (const { name } of store.bundleEntries()) {
            if (tryStartGeneration(name)) started.push(name);
          }
          patchState(store, { bundleBatch: started });
        },

        /**
         * Removes the run state for a bundle (e.g. dismissing a result strip).
         */
        clearBundleRun(name: string): void {
          clearRun(name);
        },

        /**
         * Restores runs mirrored to session storage and picks up any job that was still
         * in flight when the page reloaded.
         */
        restoreBundleRuns(): void {
          const restored = readPersistedRuns(readStoredBundleRuns());
          if (Object.keys(restored).length === 0) return;
          patchState(store, { bundleRuns: restored });
          for (const [name, run] of Object.entries(restored)) {
            if (run.status === 'running' && run.jobId) {
              resumeGeneration({ name, jobId: run.jobId });
            }
          }
        },
      };
    }),
    withHooks({
      onInit(store) {
        store.restoreBundleRuns();
      },
    }),
  );
}
