import { Logger } from '@nestjs/common';
import { JOB_RETENTION_MS, JobRegistry, MAX_RETAINED_JOBS } from './job-registry';

interface State {
  value: number;
}

const makeRegistry = (): JobRegistry<State, State & { status: 'pending' | 'running' | 'completed' | 'failed' }> =>
  new JobRegistry((state, status) => ({ ...state, status }));

describe('JobRegistry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns a pending snapshot immediately and starts the next job only after the first settles', async () => {
    const registry = makeRegistry();
    let resolveFirst: (() => void) | undefined;
    const firstRun = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondRun = jest.fn(async () => {});
    const firstId = registry.start({ initial: { value: 1 }, execute: firstRun });
    const secondId = registry.start({ initial: { value: 2 }, execute: secondRun });

    expect(registry.get(firstId)).toEqual({ jobId: firstId, status: 'pending', value: 1 });
    await jest.advanceTimersByTimeAsync(0);
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).not.toHaveBeenCalled();
    expect(registry.get(secondId)?.status).toBe('pending');

    resolveFirst?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(registry.get(firstId)?.status).toBe('completed');
    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(registry.get(secondId)?.status).toBe('completed');
  });

  it('continues after a rejected run and records its error', async () => {
    const registry = makeRegistry();
    const firstId = registry.start({
      initial: { value: 1 },
      execute: async () => {
        throw new Error('failed');
      },
    });
    const next = jest.fn(async (_id: string, update: (patch: Partial<State>) => void) => update({ value: 3 }));
    const secondId = registry.start({ initial: { value: 2 }, execute: next });
    await jest.advanceTimersByTimeAsync(0);
    expect(registry.get(firstId)?.error).toBe('failed');
    expect(registry.get(firstId)?.status).toBe('failed');
    expect(next).toHaveBeenCalledTimes(1);
    expect(registry.get(secondId)?.value).toBe(3);
    expect(registry.get(secondId)?.status).toBe('completed');
  });

  it('runs three jobs in FIFO order as each predecessor settles', async () => {
    const registry = makeRegistry();
    const order: number[] = [];
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    registry.start({
      initial: { value: 1 },
      execute: () => {
        order.push(1);
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      },
    });
    registry.start({
      initial: { value: 2 },
      execute: () => {
        order.push(2);
        return new Promise<void>((resolve) => {
          resolveSecond = resolve;
        });
      },
    });
    registry.start({
      initial: { value: 3 },
      execute: async () => {
        order.push(3);
      },
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);
    resolveFirst?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1, 2]);
    resolveSecond?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs the next job after a timed-out run rejects', async () => {
    const registry = makeRegistry();
    const firstId = registry.start({
      initial: { value: 1 },
      execute: () => new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('timed out')), 25)),
    });
    const secondRun = jest.fn(async () => {});
    const secondId = registry.start({ initial: { value: 2 }, execute: secondRun });

    await jest.advanceTimersByTimeAsync(25);
    expect(registry.get(firstId)?.status).toBe('failed');
    expect(registry.get(secondId)?.status).toBe('completed');
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('logs an error reporter failure and keeps running later jobs', async () => {
    const logError = jest.spyOn(Logger, 'error').mockImplementation(() => {});
    try {
      const registry = makeRegistry();
      const firstId = registry.start({
        initial: { value: 1 },
        execute: async () => {
          throw new Error('run failed');
        },
        onError: () => {
          throw new Error('report failed');
        },
      });
      const secondId = registry.start({ initial: { value: 2 }, execute: async () => {} });

      await jest.advanceTimersByTimeAsync(0);
      expect(logError).toHaveBeenCalledWith(`Job ${firstId} error reporter failed`, expect.any(Error));
      expect(registry.get(firstId)?.status).toBe('failed');
      expect(registry.get(secondId)?.status).toBe('completed');
    } finally {
      logError.mockRestore();
    }
  });

  it('evicts old finished jobs on the next start and returns undefined for their IDs', async () => {
    const registry = makeRegistry();
    const oldId = registry.start({ initial: { value: 1 }, execute: async () => {} });
    await jest.advanceTimersByTimeAsync(0);
    jest.advanceTimersByTime(JOB_RETENTION_MS + 1);
    registry.start({ initial: { value: 2 }, execute: async () => {} });
    expect(registry.get(oldId)).toBeUndefined();
  });

  it('keeps a recently finished job when evicting one past the age limit', async () => {
    const registry = makeRegistry();
    const oldId = registry.start({ initial: { value: 1 }, execute: async () => {} });
    await jest.advanceTimersByTimeAsync(0);
    jest.advanceTimersByTime(JOB_RETENTION_MS - 10);
    const recentId = registry.start({ initial: { value: 2 }, execute: async () => {} });
    await jest.advanceTimersByTimeAsync(0);
    jest.advanceTimersByTime(11);
    registry.start({ initial: { value: 3 }, execute: async () => {} });

    expect(registry.get(oldId)).toBeUndefined();
    expect(registry.get(recentId)?.status).toBe('completed');
  });

  it('evicts the oldest finished job when the retained count reaches the cap', async () => {
    const registry = makeRegistry();
    const ids: string[] = [];
    for (let index = 0; index < MAX_RETAINED_JOBS; index++) {
      ids.push(registry.start({ initial: { value: index }, execute: async () => {} }));
      await jest.advanceTimersByTimeAsync(1);
    }
    registry.start({ initial: { value: 101 }, execute: async () => {} });
    expect(registry.get(ids[0])).toBeUndefined();
    expect(registry.get(ids[1])).toBeDefined();
  });

  it('never evicts queued or running jobs even after the age and count limits', async () => {
    const registry = makeRegistry();
    const runningId = registry.start({ initial: { value: 1 }, execute: () => new Promise<void>(() => {}) });
    await jest.advanceTimersByTimeAsync(0);
    const queuedId = registry.start({ initial: { value: 2 }, execute: async () => {} });
    jest.advanceTimersByTime(JOB_RETENTION_MS * 2);
    for (let index = 0; index < MAX_RETAINED_JOBS; index++) {
      registry.start({ initial: { value: index }, execute: async () => {} });
    }
    expect(registry.get(runningId)?.status).toBe('running');
    expect(registry.get(queuedId)?.status).toBe('pending');
  });

  it('evicts only the oldest finished job when active jobs fill the remaining cap', async () => {
    const registry = makeRegistry();
    const oldestId = registry.start({ initial: { value: 1 }, execute: async () => {} });
    await jest.advanceTimersByTimeAsync(1);
    const recentId = registry.start({ initial: { value: 2 }, execute: async () => {} });
    await jest.advanceTimersByTimeAsync(1);
    const runningId = registry.start({ initial: { value: 3 }, execute: () => new Promise<void>(() => {}) });
    await jest.advanceTimersByTimeAsync(0);
    const queuedIds: string[] = [];
    for (let index = 0; index < MAX_RETAINED_JOBS - 3; index++) {
      queuedIds.push(registry.start({ initial: { value: index }, execute: async () => {} }));
    }

    const extraId = registry.start({ initial: { value: 101 }, execute: async () => {} });
    expect(registry.get(oldestId)).toBeUndefined();
    expect(registry.get(recentId)?.status).toBe('completed');
    expect(registry.get(runningId)?.status).toBe('running');
    expect(queuedIds.every((id) => registry.get(id)?.status === 'pending')).toBe(true);
    expect(registry.get(extraId)?.status).toBe('pending');
  });
});
