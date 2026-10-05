import { of, Subject, throwError, timer } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type { BundleGenerateJobDto } from '@simoncodes-ca/data-transfer';
import { KeyedStorage, MemoryStorageAdapter, json } from '../../shared/storage/keyed-storage';
import { ApiError } from '../../shared/api-error/api-error';
import { BundleRunController, type BundleRunSnapshot } from './bundle-run-controller';
import { readPersistedRuns, type BundleRunState } from './bundle-runs';

const running: BundleGenerateJobDto = {
  jobId: 'job',
  bundleName: 'main',
  status: 'running',
  progress: { current: 0, total: 0 },
};
const completed: BundleGenerateJobDto = {
  ...running,
  status: 'completed',
  progress: { current: 2, total: 2 },
  result: { filesGenerated: [], keysPerLocale: {}, warnings: ['opaque warning'], localesProcessed: ['en', 'fr'] },
};

function setup() {
  const clock = new TestScheduler(() => undefined);
  clock.maxFrames = 1500;
  const adapter = new MemoryStorageAdapter();
  const storage = new KeyedStorage<Record<string, BundleRunState>>(() => adapter, 'runs', json(readPersistedRuns));
  const jobs = {
    generate: vi.fn((_name: string, _locales?: readonly string[]) => of(running)),
    getJob: vi.fn((_id: string) => of(completed)),
    failureMessage: () => 'Generation failed',
  };
  const controller = new BundleRunController(jobs, storage, {
    now: () => new Date(clock.now()).toISOString(),
    poll: (ms) => timer(ms, ms, clock),
  });
  let state: BundleRunSnapshot = { bundleRuns: {}, bundleBatch: [], batchPosition: 1, isBatchRunning: false };
  controller.changes.subscribe((next) => {
    state = next;
  });
  return { controller, jobs, storage, adapter, clock, state: () => state };
}

describe('BundleRunController', () => {
  it('seeds progress, suppresses duplicate starts, polls to completion and stops polling', () => {
    const h = setup();
    expect(h.controller.start('main', ['en', 'fr'])).toBe(true);
    expect(h.jobs.generate).toHaveBeenCalledWith('main', ['en', 'fr']);
    expect(h.state().bundleRuns['main']?.progress?.total).toBe(2);
    expect(h.controller.start('main')).toBe(false);
    h.clock.flush();
    expect(h.jobs.getJob).toHaveBeenCalledTimes(1);
    expect(h.state().bundleRuns['main']).toMatchObject({
      status: 'completed',
      result: completed.result,
      finishedAt: new Date(500).toISOString(),
    });
    expect(h.storage.read()).toEqual(h.state().bundleRuns);
    h.controller.destroy();
  });

  it('replaces a previous result, supports immediate terminal jobs and dismissal', () => {
    const h = setup();
    h.jobs.generate.mockReturnValue(of(completed));
    h.controller.start('main');
    h.jobs.generate.mockReturnValue(of(running));
    h.controller.start('main', [], 6);
    expect(h.state().bundleRuns['main']?.result).toBeUndefined();
    expect(h.state().bundleRuns['main']?.progress?.total).toBe(0);
    h.controller.destroy();
    h.clock.flush();
    expect(h.jobs.getJob).not.toHaveBeenCalled();
    h.controller.clear('main');
    expect(h.storage.read()).toBeUndefined();
  });

  it('records request and poll errors using the injected time and preserves rule details', () => {
    const h = setup();
    h.jobs.generate.mockReturnValue(
      throwError(
        () =>
          new ApiError({ kind: 'invalid', status: 400, serverMessage: 'Invalid bundle definition', details: ['rule'] }),
      ),
    );
    h.controller.start('request');
    expect(h.state().bundleRuns['request']).toMatchObject({
      status: 'failed',
      error: 'Invalid bundle definition: rule',
      finishedAt: new Date(0).toISOString(),
    });
    h.jobs.generate.mockReturnValue(of(running));
    h.jobs.getJob.mockReturnValue(throwError(() => new Error('poll failed')));
    h.controller.start('poll', undefined, 6);
    h.clock.flush();
    expect(h.state().bundleRuns['poll']).toMatchObject({ status: 'failed', finishedAt: new Date(500).toISOString() });
    h.controller.destroy();
  });

  it('resumes persisted jobs immediately, polls active ones and drops unknown restored jobs', () => {
    const h = setup();
    h.storage.write({ main: { status: 'running', jobId: 'job' }, old: { status: 'completed' } });
    h.jobs.getJob.mockReturnValue(of(running));
    h.controller.restore();
    expect(h.jobs.getJob).toHaveBeenCalledWith('job');
    expect(h.state().bundleBatch).toEqual([]);
    h.jobs.getJob.mockReturnValue(of(completed));
    h.clock.flush();
    expect(h.state().bundleRuns['main']?.status).toBe('completed');
    h.jobs.getJob.mockReturnValue(throwError(() => new Error('evicted')));
    h.storage.write({ main: { status: 'running', jobId: 'missing' }, old: { status: 'completed' } });
    h.controller.restore();
    expect(h.state().bundleRuns['main']).toBeUndefined();
    expect(h.storage.read()).toEqual({ old: { status: 'completed' } });
    h.controller.destroy();
  });

  it('leaves live runs intact when persisted data is absent or corrupt', () => {
    const h = setup();
    h.jobs.generate.mockReturnValue(of(completed));
    h.controller.start('main');
    const before = h.state().bundleRuns;
    h.storage.remove();
    h.controller.restore();
    expect(h.state().bundleRuns).toBe(before);
    h.adapter.setItem('runs', '{corrupt');
    h.controller.restore();
    expect(h.state().bundleRuns).toBe(before);
    h.controller.destroy();
  });

  it('skips running bundles, tracks batch progress and refuses to replace an active batch', () => {
    const h = setup();
    h.controller.start('already');
    h.jobs.generate.mockImplementation((name) => of({ ...running, jobId: name }));
    h.controller.startAll(['already', 'first', 'second'], 2);
    expect(h.state().bundleBatch).toEqual(['first', 'second']);
    expect(h.state().batchPosition).toBe(1);
    h.controller.startAll(['third']);
    expect(h.jobs.generate).toHaveBeenCalledTimes(3);
    h.jobs.getJob.mockImplementation((id) => of(id === 'first' ? completed : running));
    h.clock.schedule(() => {
      expect(h.state().batchPosition).toBe(2);
      expect(h.state().isBatchRunning).toBe(true);
      h.jobs.getJob.mockReturnValue(of({ ...running, status: 'failed', error: 'failed' }));
    }, 501);
    h.clock.flush();
    expect(h.state().isBatchRunning).toBe(false);
    expect(h.state().batchPosition).toBe(2);
    h.controller.startAll([]);
    expect(h.state().bundleBatch).toEqual([]);
    expect(h.state().batchPosition).toBe(1);
    h.controller.destroy();
  });

  it('counts synchronous failures as batch starts and cancels pending requests on destroy', () => {
    const h = setup();
    h.jobs.generate.mockReturnValue(throwError(() => new Error('rejected')));
    h.controller.startAll(['first', 'second']);
    expect(h.state()).toMatchObject({ bundleBatch: ['first', 'second'], batchPosition: 2, isBatchRunning: false });
    const pending = new Subject<BundleGenerateJobDto>();
    h.jobs.generate.mockReturnValue(pending);
    h.controller.start('pending');
    h.controller.destroy();
    pending.next(completed);
    expect(h.state().bundleRuns['pending']?.status).toBe('running');
  });
  it('cancels only the cleared bundle and prevents its run from returning to storage', () => {
    const h = setup();
    h.jobs.generate.mockImplementation((name) => of({ ...running, jobId: name }));
    h.controller.start('deleted');
    h.controller.start('remaining');
    h.controller.clear('deleted');
    h.clock.flush();
    expect(h.jobs.getJob).toHaveBeenCalledTimes(1);
    expect(h.jobs.getJob).toHaveBeenCalledWith('remaining');
    expect(h.state().bundleRuns['deleted']).toBeUndefined();
    expect(h.storage.read()?.['deleted']).toBeUndefined();
    expect(h.state().bundleRuns['remaining']?.status).toBe('completed');
    h.controller.clear('remaining');
    expect(h.adapter.getItem('runs')).toBeNull();
    h.controller.destroy();
  });

  it('drops a resumed run when a later poll fails and preserves other persisted runs', () => {
    const h = setup();
    h.storage.write({ main: { status: 'running', jobId: 'job' }, other: { status: 'completed' } });
    h.jobs.getJob.mockReturnValueOnce(of(running)).mockReturnValue(throwError(() => new Error('evicted during poll')));
    h.controller.restore();
    expect(h.state().bundleRuns['main']?.status).toBe('running');
    h.clock.flush();
    expect(h.jobs.getJob).toHaveBeenCalledTimes(2);
    expect(h.state().bundleRuns['main']).toBeUndefined();
    expect(h.storage.read()).toEqual({ other: { status: 'completed' } });
    h.controller.destroy();
  });

  it('replaces the previous subscription when resuming the same bundle again', () => {
    const h = setup();
    h.jobs.getJob.mockReturnValue(of(running));
    h.storage.write({ main: { status: 'running', jobId: 'job' } });
    h.controller.restore();
    h.controller.restore();
    h.jobs.getJob.mockClear();
    h.jobs.getJob.mockReturnValue(of(completed));
    h.clock.flush();
    expect(h.jobs.getJob).toHaveBeenCalledTimes(1);
    h.controller.destroy();
  });
});
