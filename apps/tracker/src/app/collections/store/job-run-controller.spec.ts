import type { ImportJobDto, ImportRequestDto } from '@simoncodes-ca/data-transfer';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, KeyedStorage, MemoryStorageAdapter } from '../../shared/storage/keyed-storage';
import {
  IMPORT_RUN_STORAGE_KEY,
  ImportRunController,
  type ImportRunState,
  readPersistedImportRun,
} from './import-run-controller';
import { JOB_POLL_INTERVAL_MS } from './job-run-controller';

const request: ImportRequestDto = { collection: 'main', files: [{ path: 'in/fr.xliff', locale: 'fr' }] };
const running: ImportJobDto = { jobId: 'job', request, status: 'running', progress: { current: 0, total: 1 } };
const completed: ImportJobDto = {
  ...running,
  status: 'completed',
  progress: { current: 1, total: 1 },
  completedAt: '2026-10-19T12:00:00Z',
  result: {
    collection: 'main',
    strategy: 'translation-service',
    files: [],
    totals: { entries: 2, imported: 2, created: 0, updated: 2, skipped: 0, failed: 0, changed: 1 },
    statusTransitions: [],
    icuAutoFixes: [],
    issues: [],
    warnings: [],
    errors: [],
    filesModified: ['fr/resource_entries.json'],
    outcome: 'succeeded',
    truncated: { issues: 0, icuAutoFixes: 0, warnings: 0, errors: 0 },
  },
};

const jobs = { start: vi.fn(), getJob: vi.fn(), failureMessage: () => 'Import failed' };
let adapter: MemoryStorageAdapter;
let storage: KeyedStorage<ImportRunState>;
let ticks: Subject<void>;
let controller: ImportRunController;
let latest: ImportRunState | null;
const poll = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  adapter = new MemoryStorageAdapter();
  storage = new KeyedStorage(() => adapter, IMPORT_RUN_STORAGE_KEY, json(readPersistedImportRun));
  ticks = new Subject<void>();
  poll.mockReturnValue(ticks);
  controller = new ImportRunController(jobs, storage, { now: () => 'now', poll });
  controller.changes.subscribe((run) => {
    latest = run;
  });
});

describe('JobRunController with import jobs', () => {
  it('persists accepted progress, polls inclusively to completion and restores the result without polling', () => {
    jobs.start.mockReturnValue(of({ ...running, status: 'pending' }));
    jobs.getJob.mockReturnValue(of(completed));
    const accepted = vi.fn();
    controller.start(request).subscribe(accepted);
    expect(accepted).toHaveBeenCalledOnce();
    expect(latest).toMatchObject({ status: 'running', jobId: 'job', request });
    expect(storage.read()).toEqual(latest);
    expect(poll).toHaveBeenCalledWith(JOB_POLL_INTERVAL_MS);
    ticks.next();
    expect(latest).toMatchObject({ status: 'completed', result: completed.result, finishedAt: completed.completedAt });
    ticks.next();
    expect(jobs.getJob).toHaveBeenCalledExactlyOnceWith('job');
    controller.destroy();
    const restored = new ImportRunController(jobs, storage, { now: () => 'now', poll });
    restored.changes.subscribe((run) => {
      latest = run;
    });
    restored.restore();
    expect(latest).toEqual(storage.read());
    expect(restored.retry()).toEqual(request);
    expect(jobs.getJob).toHaveBeenCalledTimes(1);
    restored.destroy();
  });

  it('restores active runs immediately and resumes polling', () => {
    storage.write({ status: 'running', jobId: 'job', request });
    jobs.getJob.mockReturnValueOnce(of(running)).mockReturnValueOnce(of(completed));
    controller.restore();
    expect(jobs.getJob).toHaveBeenCalledWith('job');
    ticks.next();
    expect(latest?.status).toBe('completed');
    expect(jobs.start).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('persists terminal job failures and keeps their request for retry', () => {
    jobs.start.mockReturnValue(of(running));
    jobs.getJob.mockReturnValue(of({ ...running, status: 'failed', error: 'Read failed' }));
    controller.start(request).subscribe();
    ticks.next();
    expect(latest).toMatchObject({ status: 'failed', error: 'Read failed', finishedAt: 'now' });
    expect(storage.read()).toEqual(latest);
    expect(controller.retry()).toEqual(request);
    controller.destroy();
  });

  it('persists polling errors for a newly accepted run', () => {
    jobs.start.mockReturnValue(of(running));
    jobs.getJob.mockReturnValue(throwError(() => new Error('Job lost')));
    controller.start(request).subscribe();
    ticks.next();
    expect(latest).toMatchObject({ status: 'failed', error: 'Job lost', finishedAt: 'now' });
    expect(storage.read()).toEqual(latest);
    controller.destroy();
  });

  it('removes a vanished restored job', () => {
    storage.write({ status: 'running', jobId: 'gone', request });
    jobs.getJob.mockReturnValue(throwError(() => new Error('gone')));
    controller.restore();
    expect(latest).toBeNull();
    expect(storage.read()).toBeUndefined();
    controller.destroy();
  });

  it('clears persisted runs and stops polling', () => {
    jobs.start.mockReturnValue(of(running));
    controller.start(request).subscribe();
    controller.clear();
    ticks.next();
    expect(latest).toBeNull();
    expect(storage.read()).toBeUndefined();
    expect(controller.retry()).toBeUndefined();
    expect(jobs.getJob).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('ignores corrupt storage and drops interrupted starts without a job id', () => {
    adapter.setItem(IMPORT_RUN_STORAGE_KEY, '{bad');
    controller.restore();
    expect(latest).toBeNull();
    storage.write({ status: 'running', request });
    controller.restore();
    expect(latest).toBeNull();
    expect(storage.read()).toBeUndefined();
    expect(jobs.getJob).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('guards the persisted status, job id, collection and files', () => {
    for (const raw of [
      undefined,
      null,
      '{bad',
      'null',
      '[]',
      '{}',
      JSON.stringify({ status: 'pending', request }),
      JSON.stringify({ status: 'running', jobId: 1, request }),
      JSON.stringify({ status: 'running', request: null }),
      JSON.stringify({ status: 'running', request: { collection: 1, files: [] } }),
      JSON.stringify({ status: 'running', request: { collection: 'main', files: {} } }),
      JSON.stringify({ status: 'running', request: { collection: 'main' } }),
    ])
      expect(readPersistedImportRun(raw)).toBeUndefined();
    for (const status of ['running', 'completed', 'failed']) {
      const run = { status, jobId: 'job', request, ...(status === 'completed' ? { result: completed.result } : {}) };
      expect(readPersistedImportRun(JSON.stringify(run))).toEqual(run);
    }
    controller.destroy();
  });
  it('rejects empty files and malformed file entries', () => {
    for (const files of [
      [],
      [null],
      [{}],
      [{ path: 'fr.xlf' }],
      [{ locale: 'fr' }],
      [{ path: 1, locale: 'fr' }],
      [{ path: 'fr.xlf', locale: null }],
      [{ path: 'fr.xlf', locale: 'fr', format: 'yaml' }],
      [{ path: 'fr.xlf', locale: 'fr', format: null }],
      [request.files[0], null],
    ]) {
      expect(
        readPersistedImportRun(JSON.stringify({ status: 'running', jobId: 'job', request: { ...request, files } })),
      ).toBeUndefined();
    }
    for (const format of [undefined, 'xliff', 'json']) {
      const run = {
        status: 'running',
        jobId: 'job',
        request: { ...request, files: [{ path: 'fr.xlf', locale: 'fr', format }] },
      };
      expect(readPersistedImportRun(JSON.stringify(run))).toEqual(run);
    }
    controller.destroy();
  });

  it('rejects completed runs without an object result, object totals or array files', () => {
    for (const result of [
      undefined,
      null,
      [],
      {},
      { files: [] },
      { totals: {} },
      { totals: null, files: [] },
      { totals: [], files: [] },
      { totals: {}, files: {} },
    ]) {
      expect(
        readPersistedImportRun(JSON.stringify({ status: 'completed', jobId: 'job', request, result })),
      ).toBeUndefined();
    }
    controller.destroy();
  });

  it('rejects missing or empty job ids, including completed runs', () => {
    for (const status of ['pending', 'running', 'completed', 'failed']) {
      for (const jobId of [undefined, null, '', '  ', 1]) {
        expect(
          readPersistedImportRun(JSON.stringify({ status, jobId, request, result: completed.result })),
        ).toBeUndefined();
      }
    }
    controller.destroy();
  });

  it('does not restore or poll malformed completed runs', () => {
    for (const run of [
      { status: 'completed', jobId: 'job', request },
      { status: 'completed', request, result: completed.result },
    ]) {
      adapter.setItem(IMPORT_RUN_STORAGE_KEY, JSON.stringify(run));
      controller.restore();
      expect(latest).toBeNull();
      expect(controller.retry()).toBeUndefined();
    }
    expect(jobs.getJob).not.toHaveBeenCalled();
    controller.destroy();
  });
});
