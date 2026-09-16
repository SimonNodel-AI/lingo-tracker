import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CollectionsStore } from '../collections.store';
import { CollectionsApiService } from '../../services/collections-api.service';
import { getTranslocoTestingModule } from '../../../../testing/transloco-testing.module';
import { BUNDLE_JOB_POLL_INTERVAL_MS, BUNDLE_RUNS_STORAGE_KEY } from './with-bundles.feature';
import type { BundleDefinitionDto, BundleGenerateJobDto, LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';

describe('withBundlesFeature', () => {
  let store: InstanceType<typeof CollectionsStore>;

  const api = {
    getConfig: vi.fn(),
    createBundle: vi.fn(),
    updateBundle: vi.fn(),
    deleteBundle: vi.fn(),
    generateBundle: vi.fn(),
    getBundleJob: vi.fn(),
  };

  const trackerBundle: BundleDefinitionDto = {
    bundleName: '{locale}',
    dist: './apps/tracker/src/assets/i18n',
    collections: [{ name: 'trackerResources', entriesSelectionRules: 'All' }],
  };

  const mainBundle: BundleDefinitionDto = {
    bundleName: 'main.{locale}',
    dist: './dist/i18n',
    collections: 'All',
  };

  const config: LingoTrackerConfigDto = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: {},
    projectName: 'lingo-tracker',
    bundles: { tracker: trackerBundle, main: mainBundle },
  };

  const runningJob: BundleGenerateJobDto = {
    jobId: 'job-1',
    bundleName: 'tracker',
    status: 'running',
    progress: { current: 0, total: 2 },
    startedAt: '2026-09-15T10:00:00.000Z',
  };

  const completedJob: BundleGenerateJobDto = {
    ...runningJob,
    status: 'completed',
    progress: { current: 2, total: 2 },
    result: {
      filesGenerated: ['apps/tracker/src/assets/i18n/en.json', 'apps/tracker/src/assets/i18n/fr.json'],
      keysPerLocale: { en: 10, fr: 10 },
      warnings: [],
      localesProcessed: ['en', 'fr'],
    },
    completedAt: '2026-09-15T10:00:01.000Z',
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    // Runs are mirrored to session storage, which jsdom keeps between tests.
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [getTranslocoTestingModule()],
      providers: [CollectionsStore, { provide: CollectionsApiService, useValue: api }],
    }).compileComponents();

    store = TestBed.inject(CollectionsStore);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('computed', () => {
    it('derives sorted bundle entries, counts and project name from config', () => {
      api.getConfig.mockReturnValue(of(config));
      store.loadCollections();

      expect(store.bundleEntries().map((entry) => entry.name)).toEqual(['main', 'tracker']);
      expect(store.bundleEntries()[1]?.definition).toEqual(trackerBundle);
      expect(store.bundleCount()).toBe(2);
      expect(store.hasBundles()).toBe(true);
      expect(store.projectName()).toBe('lingo-tracker');
      expect(store.isAnyBundleRunning()).toBe(false);
    });

    it('is empty when config has no bundles', () => {
      expect(store.bundleEntries()).toEqual([]);
      expect(store.hasBundles()).toBe(false);
      expect(store.bundleCount()).toBe(0);
      expect(store.projectName()).toBeNull();
    });
  });

  describe('definition mutations', () => {
    it('createBundle posts the DTO and refetches config', () => {
      api.createBundle.mockReturnValue(of({ message: 'ok' }));
      api.getConfig.mockReturnValue(of(config));

      store.createBundle({ name: 'tracker', bundle: trackerBundle });

      expect(api.createBundle).toHaveBeenCalledWith({ name: 'tracker', bundle: trackerBundle });
      expect(api.getConfig).toHaveBeenCalled();
      expect(store.config()).toEqual(config);
      expect(store.isLoading()).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('createBundle surfaces the API error body message', () => {
      api.createBundle.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { message: 'A bundle named tracker already exists.' } }),
        ),
      );

      store.createBundle({ name: 'tracker', bundle: trackerBundle });

      expect(store.error()).toBe('A bundle named tracker already exists.');
      expect(store.isLoading()).toBe(false);
      expect(api.getConfig).not.toHaveBeenCalled();
    });

    it('createBundle falls back to a generic message when the error has none', () => {
      api.createBundle.mockReturnValue(throwError(() => ({ weird: true })));

      store.createBundle({ name: 'tracker', bundle: trackerBundle });

      expect(store.error()).toBe('Failed to create bundle.');
    });

    it('updateBundle sends the rename DTO and refetches config', () => {
      api.updateBundle.mockReturnValue(of({ message: 'ok' }));
      api.getConfig.mockReturnValue(of(config));

      store.updateBundle({ oldName: 'old', newName: 'tracker', bundle: trackerBundle });

      expect(api.updateBundle).toHaveBeenCalledWith('old', { name: 'tracker', bundle: trackerBundle });
      expect(store.config()).toEqual(config);
      expect(store.error()).toBeNull();
    });

    it('deleteBundle removes the bundle, its run state, and refetches config', () => {
      api.getConfig.mockReturnValue(of(config));
      api.generateBundle.mockReturnValue(of(completedJob));
      store.generateBundle('tracker');
      expect(store.bundleRuns()['tracker']?.status).toBe('completed');

      api.deleteBundle.mockReturnValue(of({ message: 'ok' }));
      const configAfterDelete = { ...config, bundles: { main: mainBundle } };
      api.getConfig.mockReturnValue(of(configAfterDelete));

      store.deleteBundle('tracker');

      expect(api.deleteBundle).toHaveBeenCalledWith('tracker');
      expect(store.config()).toEqual(configAfterDelete);
      expect(store.bundleRuns()['tracker']).toBeUndefined();
    });
  });

  describe('generateBundle', () => {
    it('marks the run as running with zero progress before the job is accepted', () => {
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(of(runningJob));

      store.generateBundle('tracker');

      const run = store.bundleRuns()['tracker'];
      expect(run?.status).toBe('running');
      expect(run?.jobId).toBe('job-1');
      expect(run?.progress).toEqual({ current: 0, total: 2 });
      expect(store.runningBundleCount()).toBe(1);
      expect(store.isAnyBundleRunning()).toBe(true);
    });

    it('drops the previous run result when the same bundle is generated again', () => {
      // A stale "Generated" strip must not sit on the card while a new run is in
      // flight, so starting a run replaces the run state instead of merging into it.
      api.generateBundle.mockReturnValue(of(completedJob));
      store.generateBundle('tracker');
      expect(store.bundleRuns()['tracker']?.result).toBeDefined();

      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(of(runningJob));

      store.generateBundle('tracker');

      const run = store.bundleRuns()['tracker'];
      expect(run?.status).toBe('running');
      expect(run?.result).toBeUndefined();
      expect(run?.finishedAt).toBeUndefined();
    });

    it('keeps the seeded locale total while the queued job still reports zero', () => {
      // The API creates the job with {current: 0, total: 0} and only fills the
      // total once generation starts, so the card would otherwise flash a bare
      // "Generating" strip with no counter and an unsized bar.
      const queued = { ...runningJob, status: 'pending' as const, progress: { current: 0, total: 0 } };
      api.getConfig.mockReturnValue(of(config));
      store.loadCollections();
      api.generateBundle.mockReturnValue(of(queued));
      api.getBundleJob.mockReturnValue(of(queued));

      store.generateBundle('tracker');

      // config declares two locales, so the strip can show "0 of 2" immediately.
      expect(store.bundleRuns()['tracker']?.progress).toEqual({ current: 0, total: 2 });
    });

    it('adopts the job total once the server reports one', () => {
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(of(runningJob));

      store.generateBundle('tracker');

      expect(store.bundleRuns()['tracker']?.progress).toEqual({ current: 0, total: 2 });
    });

    it('polls the job until it completes and stores the result', () => {
      vi.useFakeTimers();
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob
        .mockReturnValueOnce(of({ ...runningJob, progress: { current: 1, total: 2 } }))
        .mockReturnValueOnce(of(completedJob))
        .mockReturnValue(of(completedJob));

      store.generateBundle('tracker', ['en', 'fr']);
      expect(api.generateBundle).toHaveBeenCalledWith('tracker', { locales: ['en', 'fr'] });

      vi.advanceTimersByTime(BUNDLE_JOB_POLL_INTERVAL_MS);
      expect(api.getBundleJob).toHaveBeenCalledTimes(1);
      expect(store.bundleRuns()['tracker']?.status).toBe('running');
      expect(store.bundleRuns()['tracker']?.progress).toEqual({ current: 1, total: 2 });

      vi.advanceTimersByTime(BUNDLE_JOB_POLL_INTERVAL_MS);
      expect(api.getBundleJob).toHaveBeenCalledTimes(2);
      const run = store.bundleRuns()['tracker'];
      expect(run?.status).toBe('completed');
      expect(run?.result).toEqual(completedJob.result);
      expect(run?.finishedAt).toBe('2026-09-15T10:00:01.000Z');
      expect(run?.error).toBeUndefined();
      expect(store.isAnyBundleRunning()).toBe(false);

      // Polling stops once finished.
      vi.advanceTimersByTime(BUNDLE_JOB_POLL_INTERVAL_MS * 3);
      expect(api.getBundleJob).toHaveBeenCalledTimes(2);
    });

    it('does not poll when the job is already finished on acceptance', () => {
      api.generateBundle.mockReturnValue(of(completedJob));

      store.generateBundle('tracker');

      expect(api.getBundleJob).not.toHaveBeenCalled();
      expect(store.bundleRuns()['tracker']?.status).toBe('completed');
    });

    it('marks the run failed with the job error when the job fails', () => {
      vi.useFakeTimers();
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(
        of({
          ...runningJob,
          status: 'failed',
          error: 'Collection missing not found',
          completedAt: '2026-09-15T10:00:02.000Z',
        }),
      );

      store.generateBundle('tracker');
      vi.advanceTimersByTime(BUNDLE_JOB_POLL_INTERVAL_MS);

      const run = store.bundleRuns()['tracker'];
      expect(run?.status).toBe('failed');
      expect(run?.error).toBe('Collection missing not found');
      expect(run?.finishedAt).toBe('2026-09-15T10:00:02.000Z');
      expect(run?.result).toBeUndefined();
    });

    it('marks the run failed when the generate request is rejected', () => {
      api.generateBundle.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Bundle tracker not found' } })),
      );

      store.generateBundle('tracker');

      const run = store.bundleRuns()['tracker'];
      expect(run?.status).toBe('failed');
      expect(run?.error).toBe('Bundle tracker not found');
      expect(run?.finishedAt).toBeDefined();
      expect(store.error()).toBeNull();
    });

    it('ignores a second generate call while the bundle is already running', () => {
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(of(runningJob));

      store.generateBundle('tracker');
      store.generateBundle('tracker');

      expect(api.generateBundle).toHaveBeenCalledTimes(1);
    });

    it('retryBundle re-runs a failed bundle', () => {
      api.generateBundle.mockReturnValueOnce(throwError(() => new Error('boom'))).mockReturnValueOnce(of(completedJob));

      store.generateBundle('tracker');
      expect(store.bundleRuns()['tracker']?.status).toBe('failed');

      store.retryBundle('tracker');
      expect(api.generateBundle).toHaveBeenCalledTimes(2);
      expect(store.bundleRuns()['tracker']?.status).toBe('completed');
    });

    it('generateAllBundles starts a run for every configured bundle', () => {
      api.getConfig.mockReturnValue(of(config));
      store.loadCollections();
      api.generateBundle.mockImplementation((name: string) =>
        of({ ...completedJob, jobId: `job-${name}`, bundleName: name }),
      );

      store.generateAllBundles();

      expect(api.generateBundle).toHaveBeenCalledTimes(2);
      expect(api.generateBundle).toHaveBeenCalledWith('main', {});
      expect(api.generateBundle).toHaveBeenCalledWith('tracker', {});
      expect(store.bundleRuns()['main']?.jobId).toBe('job-main');
      expect(store.bundleRuns()['tracker']?.jobId).toBe('job-tracker');
    });

    it('clearBundleRun removes only the named run', () => {
      api.generateBundle.mockReturnValue(of(completedJob));
      store.generateBundle('tracker');
      store.generateBundle('main');

      store.clearBundleRun('tracker');

      expect(store.bundleRuns()['tracker']).toBeUndefined();
      expect(store.bundleRuns()['main']?.status).toBe('completed');
    });
  });

  describe('session persistence', () => {
    // Generating the tracker bundle rewrites the Tracker's own i18n assets, which makes
    // the dev server reload the page mid-run. Without mirroring, the reload would wipe
    // the result strip the instant it was earned.
    const rebuildStore = async (): Promise<void> => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [getTranslocoTestingModule()],
        providers: [CollectionsStore, { provide: CollectionsApiService, useValue: api }],
      }).compileComponents();
      store = TestBed.inject(CollectionsStore);
      // The store is lazy; touching it runs the init hook that restores the runs.
      store.bundleRuns();
    };

    it('restores a completed run after a reload', async () => {
      api.generateBundle.mockReturnValue(of(completedJob));
      store.generateBundle('tracker');
      expect(store.bundleRuns()['tracker']?.status).toBe('completed');

      await rebuildStore();

      const run = store.bundleRuns()['tracker'];
      expect(run?.status).toBe('completed');
      expect(run?.result?.keysPerLocale).toEqual({ en: 10, fr: 10 });
    });

    it('resumes polling a job that was still running when the page reloaded', async () => {
      vi.useFakeTimers();
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(of(runningJob));
      store.generateBundle('tracker');
      expect(store.bundleRuns()['tracker']?.status).toBe('running');

      // The reload drops the in-flight poller; only the persisted snapshot survives.
      api.getBundleJob.mockReturnValue(of(completedJob));
      await rebuildStore();

      expect(api.getBundleJob).toHaveBeenCalledWith('job-1');
      expect(store.bundleRuns()['tracker']?.status).toBe('completed');
      vi.useRealTimers();
    });

    it('drops a restored run whose job the API no longer knows about', async () => {
      api.generateBundle.mockReturnValue(of(runningJob));
      api.getBundleJob.mockReturnValue(of(runningJob));
      store.generateBundle('tracker');

      api.getBundleJob.mockReturnValue(throwError(() => new Error('job not found')));
      await rebuildStore();

      // A stale "Generating" strip the user cannot act on is worse than no strip.
      expect(store.bundleRuns()['tracker']).toBeUndefined();
    });

    it('dismissing a run keeps it dismissed across a reload', async () => {
      api.generateBundle.mockReturnValue(of(completedJob));
      store.generateBundle('tracker');
      store.clearBundleRun('tracker');

      await rebuildStore();

      expect(store.bundleRuns()['tracker']).toBeUndefined();
    });

    it('ignores corrupt persisted state', async () => {
      sessionStorage.setItem(BUNDLE_RUNS_STORAGE_KEY, '{ not json');

      await rebuildStore();

      expect(store.bundleRuns()).toEqual({});
    });
  });
});
