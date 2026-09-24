import { computed, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { signalStoreFeature, withState, withComputed, withMethods, withHooks, patchState, type } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { pipe, tap, switchMap, mergeMap, catchError, of, timer, takeWhile } from 'rxjs';
import { CollectionsApiService } from '../../services/collections-api.service';
import type {
  BundleDefinitionDto,
  BundleGenerateJobDto,
  BundleGenerateJobProgressDto,
  BundleGenerateJobResultDto,
  CreateBundleDto,
  LingoTrackerConfigDto,
  UpdateBundleDto,
} from '@simoncodes-ca/data-transfer';

/** Client-side lifecycle of a bundle generation run. */
export type BundleRunStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface BundleRunState {
  status: BundleRunStatus;
  /** Server job id, present once the job has been accepted. */
  jobId?: string;
  progress?: BundleGenerateJobProgressDto;
  result?: BundleGenerateJobResultDto;
  error?: string;
  /** ISO timestamp of completion or failure. */
  finishedAt?: string;
}

export interface BundleEntry {
  name: string;
  definition: BundleDefinitionDto;
}

interface BundlesState {
  /** Generation run state keyed by bundle name. */
  bundleRuns: Record<string, BundleRunState>;
}

const initialBundlesState: BundlesState = {
  bundleRuns: {},
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

const RUN_STATUSES: readonly BundleRunStatus[] = ['idle', 'running', 'completed', 'failed'];

function isBundleRunState(value: unknown): value is BundleRunState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    RUN_STATUSES.includes((value as BundleRunState).status)
  );
}

/** Reads persisted runs, tolerating absent, unavailable or corrupt storage. */
function readPersistedRuns(): Record<string, BundleRunState> {
  try {
    const raw = globalThis.sessionStorage?.getItem(BUNDLE_RUNS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, run]) => isBundleRunState(run)));
  } catch {
    return {};
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

// TODO(step 7): replace these fallbacks with TRACKER_TOKENS.BUNDLES.TOAST.* translations.
const FALLBACK_MESSAGES = {
  create: 'Failed to create bundle.',
  update: 'Failed to update bundle.',
  delete: 'Failed to delete bundle.',
  generate: 'Failed to generate bundle.',
} as const;

/**
 * Extracts a human-readable message from an HTTP or generic error.
 * The API returns `{ message }` bodies, which `HttpErrorResponse` exposes on `error.error`.
 * An invalid bundle definition also carries `errors: string[]`; they are appended
 * (`Invalid bundle definition: a; b`) so the reason is readable.
 */
function toBundleErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      const errors: unknown = 'errors' in body ? body.errors : undefined;
      const details = Array.isArray(errors) ? errors.filter((item): item is string => typeof item === 'string') : [];
      return details.length > 0 ? `${body.message}: ${details.join('; ')}` : body.message;
    }
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function isJobFinished(job: BundleGenerateJobDto): boolean {
  return job.status === 'completed' || job.status === 'failed';
}

function toRunStatus(status: BundleGenerateJobDto['status']): BundleRunStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'running';
  }
}

function mapJobToRun(job: BundleGenerateJobDto, previous: BundleRunState | undefined): BundleRunState {
  const finished = isJobFinished(job);
  // A freshly queued job reports {current: 0, total: 0} until its first progress
  // event lands. Keep the total we seeded from the locale list so the card shows
  // "0 of 6 locales" and a sized bar from the first frame instead of a bare strip.
  const progress =
    job.progress.total > 0 || !previous?.progress?.total
      ? job.progress
      : { ...job.progress, total: previous.progress.total };
  return {
    status: toRunStatus(job.status),
    jobId: job.jobId,
    progress,
    result: job.status === 'completed' ? job.result : previous?.result,
    error: job.status === 'failed' ? job.error : undefined,
    finishedAt: finished ? (job.completedAt ?? new Date().toISOString()) : undefined,
  };
}

/**
 * Adds bundle definitions and bundle generation runs to the collections store.
 *
 * Requires `config`, `isLoading` and `error` in the host store state.
 */
export function withBundlesFeature<_>() {
  return signalStoreFeature(
    {
      state: type<{ config: LingoTrackerConfigDto | null; isLoading: boolean; error: string | null }>(),
    },
    withState(initialBundlesState),
    withComputed(({ config, bundleRuns }) => {
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
        runningBundleCount,
        isAnyBundleRunning: computed(() => runningBundleCount() > 0),
      };
    }),
    withMethods((store) => {
      const api = inject(CollectionsApiService);

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
          tap((snapshot) => setRun(name, mapJobToRun(snapshot, store.bundleRuns()[name]))),
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
              tap((job) => setRun(name, mapJobToRun(job, store.bundleRuns()[name]))),
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
              tap((job) => setRun(name, mapJobToRun(job, store.bundleRuns()[name]))),
              switchMap((job) => (isJobFinished(job) ? of(job) : pollJob(name, job.jobId))),
              catchError((error: unknown) => {
                setRun(name, {
                  ...store.bundleRuns()[name],
                  status: 'failed',
                  error: toBundleErrorMessage(error, FALLBACK_MESSAGES.generate),
                  finishedAt: new Date().toISOString(),
                });
                return of(null);
              }),
            ),
          ),
        ),
      );

      const generateBundle = (name: string, locales?: readonly string[]): void => {
        if (store.bundleRuns()[name]?.status === 'running') return;
        startGeneration({ name, locales });
      };

      return {
        /**
         * Creates a bundle definition and reloads the configuration.
         */
        createBundle: rxMethod<CreateBundleDto>(
          pipe(
            tap(() => patchState(store, { isLoading: true, error: null })),
            switchMap((data) =>
              api.createBundle(data).pipe(
                switchMap(() => api.getConfig()),
                tap((configData) => patchState(store, { config: configData, isLoading: false, error: null })),
                catchError((error: unknown) => {
                  patchState(store, {
                    isLoading: false,
                    error: toBundleErrorMessage(error, FALLBACK_MESSAGES.create),
                  });
                  return of(null);
                }),
              ),
            ),
          ),
        ),

        /**
         * Updates (and optionally renames) a bundle definition and reloads the configuration.
         */
        updateBundle: rxMethod<{ oldName: string; newName?: string; bundle: BundleDefinitionDto }>(
          pipe(
            tap(() => patchState(store, { isLoading: true, error: null })),
            switchMap(({ oldName, newName, bundle }) => {
              const dto: UpdateBundleDto = { name: newName, bundle };
              return api.updateBundle(oldName, dto).pipe(
                switchMap(() => api.getConfig()),
                tap((configData) => patchState(store, { config: configData, isLoading: false, error: null })),
                catchError((error: unknown) => {
                  patchState(store, {
                    isLoading: false,
                    error: toBundleErrorMessage(error, FALLBACK_MESSAGES.update),
                  });
                  return of(null);
                }),
              );
            }),
          ),
        ),

        /**
         * Deletes a bundle definition, drops its run state and reloads the configuration.
         */
        deleteBundle: rxMethod<string>(
          pipe(
            tap(() => patchState(store, { isLoading: true, error: null })),
            switchMap((name) =>
              api.deleteBundle(name).pipe(
                switchMap(() => api.getConfig()),
                tap((configData) => {
                  patchState(store, { config: configData, isLoading: false, error: null });
                  clearRun(name);
                }),
                catchError((error: unknown) => {
                  patchState(store, {
                    isLoading: false,
                    error: toBundleErrorMessage(error, FALLBACK_MESSAGES.delete),
                  });
                  return of(null);
                }),
              ),
            ),
          ),
        ),

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
         * Starts generation for every configured bundle. Jobs poll independently.
         */
        generateAllBundles(): void {
          for (const { name } of store.bundleEntries()) {
            generateBundle(name);
          }
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
          const restored = readPersistedRuns();
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
