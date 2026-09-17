import { Logger } from '@nestjs/common';
import type { BundleProgressEvent, GenerateBundleParams, GenerateBundleResult } from '@simoncodes-ca/core';
import { BundleJobService, JOB_RETENTION_MS, MAX_RETAINED_JOBS } from './bundle-job.service';

const mockGenerateBundle = jest.fn();

jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    generateBundle: (params: unknown) => mockGenerateBundle(params),
  };
});

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const bundleDefinition = {
  bundleName: '{locale}',
  dist: './dist/i18n',
  collections: 'All' as const,
  typeDistFile: './dist/i18n-types/main.ts',
};

const config = {
  exportFolder: 'dist/export',
  importFolder: 'dist/import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: { app: { translationsFolder: './i18n' } },
};

const makeResult = (overrides: Partial<GenerateBundleResult> = {}): GenerateBundleResult => ({
  bundleKey: 'main',
  filesGenerated: 2,
  warnings: [],
  localesProcessed: ['en', 'fr'],
  keysPerLocale: { en: 5, fr: 5 },
  typeGenerationResult: {
    bundleKey: 'main',
    typeDistFile: './dist/i18n-types/main.ts',
    keysCount: 5,
    fileGenerated: true,
  },
  ...overrides,
});

const makeParams = (bundleName = 'main') => ({ bundleName, bundleDefinition, config });

describe('BundleJobService', () => {
  let service: BundleJobService;
  let logger: jest.Mocked<Pick<Logger, 'error' | 'log' | 'warn'>>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    service = new BundleJobService(logger as unknown as Logger);
  });

  it('startJob returns an ID and getJob exposes the pending job', () => {
    mockGenerateBundle.mockReturnValue(new Promise(() => {}));

    const jobId = service.startJob(makeParams());
    const job = service.getJob(jobId);

    expect(typeof jobId).toBe('string');
    expect(job?.jobId).toBe(jobId);
    expect(job?.bundleName).toBe('main');
    expect(job?.status).toBe('pending');
    expect(job?.progress).toEqual({ current: 0, total: 0 });
  });

  it('getJob returns undefined for an unknown ID', () => {
    expect(service.getJob('nope')).toBeUndefined();
  });

  it('passes the bundle params, locales and an onProgress callback to generateBundle', async () => {
    mockGenerateBundle.mockResolvedValue(makeResult());

    service.startJob({ ...makeParams(), locales: ['fr'] });
    await flush();

    expect(mockGenerateBundle).toHaveBeenCalledTimes(1);
    const params = mockGenerateBundle.mock.calls[0][0] as GenerateBundleParams;
    expect(params.bundleKey).toBe('main');
    expect(params.bundleDefinition).toBe(bundleDefinition);
    expect(params.config).toBe(config);
    expect(params.locales).toEqual(['fr']);
    expect(typeof params.onProgress).toBe('function');
  });

  it('omits locales from the core call when none were requested', async () => {
    mockGenerateBundle.mockResolvedValue(makeResult());

    service.startJob(makeParams());
    await flush();

    const params = mockGenerateBundle.mock.calls[0][0] as GenerateBundleParams;
    expect('locales' in params).toBe(false);
  });

  it('reflects onProgress events in the job snapshot while running', async () => {
    let capturedProgress: ((event: BundleProgressEvent) => void) | undefined;
    mockGenerateBundle.mockImplementation((params: GenerateBundleParams) => {
      capturedProgress = params.onProgress;
      return new Promise(() => {});
    });

    const jobId = service.startJob(makeParams());
    await flush();

    expect(service.getJob(jobId)?.status).toBe('running');
    expect(service.getJob(jobId)?.startedAt).toEqual(expect.any(String));

    capturedProgress?.({ locale: 'fr', index: 2, total: 3, file: 'dist/i18n/fr.json' });

    expect(service.getJob(jobId)?.progress).toEqual({ current: 2, total: 3, currentFile: 'dist/i18n/fr.json' });
  });

  it('marks the job completed with the mapped result and ISO timestamps', async () => {
    mockGenerateBundle.mockImplementation(async (params: GenerateBundleParams) => {
      params.onProgress?.({ locale: 'en', index: 1, total: 2, file: 'dist/i18n/en.json' });
      params.onProgress?.({ locale: 'fr', index: 2, total: 2, file: 'dist/i18n/fr.json' });
      return makeResult({ warnings: ['careful'] });
    });

    const jobId = service.startJob(makeParams());
    await flush();

    const job = service.getJob(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.progress).toEqual({ current: 2, total: 2 });
    expect(job?.result?.localesProcessed).toEqual(['en', 'fr']);
    expect(job?.result?.keysPerLocale).toEqual({ en: 5, fr: 5 });
    expect(job?.result?.warnings).toEqual(['careful']);
    expect(job?.result?.typeDistFile).toBe('dist/i18n-types/main.ts');
    expect(job?.result?.typesKeysCount).toBe(5);
    expect(job?.result?.filesGenerated).toHaveLength(3);
    expect(job?.error).toBeUndefined();
    expect(() => new Date(job?.startedAt ?? '').toISOString()).not.toThrow();
    expect(() => new Date(job?.completedAt ?? '').toISOString()).not.toThrow();
  });

  it('marks the job failed with the error message and logs it', async () => {
    mockGenerateBundle.mockRejectedValue(new Error('disk full'));

    const jobId = service.startJob(makeParams());
    await flush();

    const job = service.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('disk full');
    expect(job?.result).toBeUndefined();
    expect(job?.completedAt).toEqual(expect.any(String));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('uses a fallback message when the rejection is not an Error', async () => {
    mockGenerateBundle.mockRejectedValue('boom');

    const jobId = service.startJob(makeParams());
    await flush();

    expect(service.getJob(jobId)?.error).toBe('An unexpected error occurred');
  });

  it('runs jobs one at a time, in order', async () => {
    let resolveFirst: ((value: GenerateBundleResult) => void) | undefined;
    mockGenerateBundle
      .mockImplementationOnce(
        () =>
          new Promise<GenerateBundleResult>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(makeResult({ bundleKey: 'second' }));

    const firstId = service.startJob(makeParams('first'));
    const secondId = service.startJob(makeParams('second'));
    await flush();

    expect(mockGenerateBundle).toHaveBeenCalledTimes(1);
    expect(service.getJob(firstId)?.status).toBe('running');
    expect(service.getJob(secondId)?.status).toBe('pending');

    resolveFirst?.(makeResult());
    await flush();

    expect(mockGenerateBundle).toHaveBeenCalledTimes(2);
    expect(service.getJob(firstId)?.status).toBe('completed');
    expect(service.getJob(secondId)?.status).toBe('completed');
  });

  it('keeps running the queue after a failed job', async () => {
    mockGenerateBundle.mockRejectedValueOnce(new Error('first failed')).mockResolvedValueOnce(makeResult());

    const firstId = service.startJob(makeParams('first'));
    const secondId = service.startJob(makeParams('second'));
    await flush();

    expect(service.getJob(firstId)?.status).toBe('failed');
    expect(service.getJob(secondId)?.status).toBe('completed');
  });

  describe('eviction', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('evicts finished jobs older than the retention window on the next startJob', async () => {
      mockGenerateBundle.mockResolvedValue(makeResult());

      const oldId = service.startJob(makeParams());
      await jest.advanceTimersByTimeAsync(0);
      expect(service.getJob(oldId)?.status).toBe('completed');

      jest.advanceTimersByTime(JOB_RETENTION_MS + 1000);

      const newId = service.startJob(makeParams());

      expect(service.getJob(oldId)).toBeUndefined();
      expect(service.getJob(newId)).toBeDefined();
    });

    it('keeps recently finished jobs', async () => {
      mockGenerateBundle.mockResolvedValue(makeResult());

      const recentId = service.startJob(makeParams());
      await jest.advanceTimersByTimeAsync(0);

      jest.advanceTimersByTime(JOB_RETENTION_MS - 1000);
      service.startJob(makeParams());

      expect(service.getJob(recentId)?.status).toBe('completed');
    });

    it('never evicts a job that has not finished', async () => {
      mockGenerateBundle.mockReturnValue(new Promise(() => {}));

      const stuckId = service.startJob(makeParams());
      await jest.advanceTimersByTimeAsync(0);

      jest.advanceTimersByTime(JOB_RETENTION_MS * 2);
      service.startJob(makeParams());

      expect(service.getJob(stuckId)?.status).toBe('running');
    });

    it('caps retained jobs by evicting the oldest finished ones first', async () => {
      mockGenerateBundle.mockResolvedValue(makeResult());

      const ids: string[] = [];
      for (let index = 0; index < MAX_RETAINED_JOBS; index++) {
        ids.push(service.startJob(makeParams()));
        await jest.advanceTimersByTimeAsync(1);
      }

      expect(ids.every((id) => service.getJob(id)?.status === 'completed')).toBe(true);

      const extraId = service.startJob(makeParams());

      expect(service.getJob(ids[0])).toBeUndefined();
      expect(service.getJob(ids[1])).toBeDefined();
      expect(service.getJob(extraId)).toBeDefined();
    });
  });
});
