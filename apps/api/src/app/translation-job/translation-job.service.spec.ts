import { Logger } from '@nestjs/common';
import { TranslationJobService } from './translation-job.service';
import type { CollectionIndex } from '../cache/collection-index.service';
import { TranslationError } from '@simoncodes-ca/core';
import type { Collection, TranslateLocaleResult, TranslateLocaleProgress } from '@simoncodes-ca/core';

const mockTranslateLocale = jest.fn();

jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    translateLocale: (collection: unknown, params: unknown) => mockTranslateLocale(collection, params),
  };
});

const makeSuccessResult = (overrides: Partial<TranslateLocaleResult> = {}): TranslateLocaleResult => ({
  totalResources: 10,
  translatedCount: 9,
  failedCount: 1,
  skippedCount: 0,
  failures: [{ key: 'apps.button.ok', error: 'Rate limit exceeded' }],
  skippedKeys: [],
  warnings: [],
  ...overrides,
});

const collection: Collection = {
  name: 'my-collection',
  translationsFolder: '/path/to/translations',
  baseLocale: 'en',
  locales: ['en', 'fr', 'de'],
  targetLocales: ['fr', 'de'],
  translationConfig: { enabled: true, provider: 'google', apiKeyEnv: 'GOOGLE_API_KEY' },
  tags: [],
  protectedTermsFiles: { global: '/nonexistent/.lingo-tracker-protected-terms.json', globalExplicit: false },
  readOnly: false,
  config: { translationsFolder: '/path/to/translations' },
};

const startJob = (service: TranslationJobService): string => service.startJob(collection, 'fr');

describe('TranslationJobService', () => {
  let service: TranslationJobService;
  let mockLogger: jest.Mocked<Pick<Logger, 'error' | 'log' | 'warn'>>;
  const mockIndex = { apply: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    service = new TranslationJobService(mockLogger as unknown as Logger, mockIndex as unknown as CollectionIndex);
  });

  it('runs translateLocale on the opened collection for the target locale', () => {
    mockTranslateLocale.mockReturnValue(new Promise(() => {})); // never resolves

    startJob(service);

    expect(mockTranslateLocale).toHaveBeenCalledWith(
      collection,
      expect.objectContaining({ targetLocale: 'fr', onProgress: expect.any(Function) }),
    );
  });

  it('startJob returns a non-empty job ID', () => {
    mockTranslateLocale.mockReturnValue(new Promise(() => {})); // never resolves

    const jobId = startJob(service);

    expect(jobId).toBeTruthy();
    expect(typeof jobId).toBe('string');
  });

  it('getJob returns undefined for an unknown job ID', () => {
    const result = service.getJob('non-existent-id');

    expect(result).toBeUndefined();
  });

  it('getJob returns a running job immediately after startJob (before async completes)', () => {
    mockTranslateLocale.mockReturnValue(new Promise(() => {})); // never resolves

    const jobId = startJob(service);
    const job = service.getJob(jobId);

    expect(job).toBeDefined();
    expect(job?.jobId).toBe(jobId);
    expect(job?.collectionName).toBe('my-collection');
    expect(job?.targetLocale).toBe('fr');
    expect(['pending', 'running']).toContain(job?.status);
  });

  it('job status becomes completed with correct counts after async resolves', async () => {
    const result = makeSuccessResult();
    mockTranslateLocale.mockResolvedValue(result);

    const jobId = startJob(service);

    // Wait for the microtask queue to flush the resolved promise
    await Promise.resolve();
    await Promise.resolve();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('completed');
    expect(job?.totalResources).toBe(result.totalResources);
    expect(job?.translatedCount).toBe(result.translatedCount);
    expect(job?.failedCount).toBe(result.failedCount);
    expect(job?.skippedCount).toBe(result.skippedCount);
    expect(job?.failures).toEqual(result.failures);
    expect(job?.completedAt).toBeDefined();
  });

  it('job status becomes failed when translateLocale throws a TranslationError', async () => {
    mockTranslateLocale.mockRejectedValue(new TranslationError('API quota exceeded', 'QUOTA_EXCEEDED', false));

    const jobId = startJob(service);

    await Promise.resolve();
    await Promise.resolve();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('failed');
    expect(job?.completedAt).toBeDefined();
    expect(job?.error).toBe('API quota exceeded');
  });

  it('job status becomes failed when translateLocale throws a generic Error', async () => {
    mockTranslateLocale.mockRejectedValue(new Error('Unexpected network failure'));

    const jobId = startJob(service);

    await Promise.resolve();
    await Promise.resolve();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('Unexpected network failure');
  });

  it('job error is a generic message when translateLocale rejects with a non-Error', async () => {
    mockTranslateLocale.mockRejectedValue('boom');

    const jobId = startJob(service);

    await Promise.resolve();
    await Promise.resolve();

    expect(service.getJob(jobId)?.error).toBe('An unexpected error occurred');
  });

  it.each([
    ['completes', () => mockTranslateLocale.mockResolvedValue(makeSuccessResult())],
    ['fails', () => mockTranslateLocale.mockRejectedValue(new Error('Unexpected network failure'))],
  ])('drops the collection index for the translations folder when the job %s', async (_outcome, arrange) => {
    arrange();

    startJob(service);
    expect(mockIndex.apply).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();

    expect(mockIndex.apply).toHaveBeenCalledWith([{ kind: 'reindex', translationsFolder: '/path/to/translations' }]);
  });

  it('logs the folders translateLocale could not read', async () => {
    mockTranslateLocale.mockResolvedValue(makeSuccessResult({ warnings: ["Folder 'broken' was not translated: bad"] }));

    const jobId = startJob(service);

    await Promise.resolve();
    await Promise.resolve();

    expect(mockLogger.warn).toHaveBeenCalledWith(`Translation job ${jobId}: Folder 'broken' was not translated: bad`);
  });

  it('getJob omits optional fields when there are no failures or skipped keys', async () => {
    mockTranslateLocale.mockResolvedValue(makeSuccessResult({ failures: [], skippedKeys: [] }));

    const jobId = startJob(service);

    await Promise.resolve();
    await Promise.resolve();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.failures).toBeUndefined();
    expect(job?.skippedKeys).toBeUndefined();
    expect(job?.error).toBeUndefined();
  });

  it('updates job counts when onProgress is called', async () => {
    let resolveTranslation!: (result: TranslateLocaleResult) => void;

    mockTranslateLocale.mockImplementationOnce(
      (_collection: Collection, params: { onProgress?: (p: TranslateLocaleProgress) => void }) =>
        new Promise<TranslateLocaleResult>((resolve) => {
          resolveTranslation = resolve;
          params.onProgress?.({
            totalResources: 10,
            translatedCount: 3,
            failedCount: 0,
            skippedCount: 1,
            currentBatch: 1,
            totalBatches: 2,
          });
        }),
    );

    const jobId = startJob(service);

    // Give the microtask queue a tick so the async function runs up to its first await
    // (the Promise constructor callback runs synchronously, so onProgress has already been called)
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The promise has NOT resolved yet — the progress counts should reflect the onProgress call
    const jobDuringProgress = service.getJob(jobId);
    expect(jobDuringProgress?.translatedCount).toBe(3);
    expect(jobDuringProgress?.totalResources).toBe(10);

    // Clean up by resolving the translation so no unhandled promise dangles
    resolveTranslation(makeSuccessResult({ totalResources: 10, translatedCount: 10, failedCount: 0, skippedCount: 0 }));
    await Promise.resolve();
    await Promise.resolve();
  });
});
