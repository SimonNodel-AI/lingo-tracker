import { Logger } from '@nestjs/common';
import type { Collection, ResourceMutation, TranslateLocaleProgress, TranslateLocaleResult } from '@simoncodes-ca/core';
import { TranslationError } from '@simoncodes-ca/core';
import type { CollectionIndex } from '../cache/collection-index.service';
import { TranslationJobService } from './translation-job.service';

const mockTranslateLocale = jest.fn();

jest.mock('@simoncodes-ca/core', () => {
  const actual = jest.requireActual('@simoncodes-ca/core');
  return {
    ...actual,
    translateLocale: (collection: unknown, params: unknown) => mockTranslateLocale(collection, params),
  };
});

const makeSuccessResult = (overrides: Partial<TranslateLocaleResult> = {}): TranslateLocaleResult => ({
  outcome: 'failed',
  totalResources: 10,
  translatedCount: 9,
  failedCount: 1,
  skippedCount: 0,
  failures: [{ key: 'apps.button.ok', error: 'Rate limit exceeded' }],
  skippedKeys: [],
  warnings: [],
  mutations: [],
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
  termFiles: {
    protectedTerms: { path: '/nonexistent/.lingo-tracker-protected-terms.json', explicit: false },
    preferredTerminology: { path: '/nonexistent/.lingo-tracker-preferred-terminology.json', explicit: false },
  },
  readOnly: false,
  config: { translationsFolder: '/path/to/translations' },
};

const startJob = (service: TranslationJobService): string => service.startJob(collection, 'fr');
const flush = async (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

describe('TranslationJobService', () => {
  let service: TranslationJobService;
  let mockLogger: jest.Mocked<Pick<Logger, 'error' | 'log' | 'warn'>>;
  const mockIndex = { apply: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    service = new TranslationJobService(mockLogger as unknown as Logger, mockIndex as unknown as CollectionIndex);
  });

  it('runs translateLocale on the opened collection for the target locale', async () => {
    mockTranslateLocale.mockReturnValue(new Promise(() => {})); // never resolves

    startJob(service);
    await flush();

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
    await flush();

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

    await flush();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('failed');
    expect(job?.completedAt).toBeDefined();
    expect(job?.error).toBe('API quota exceeded');
  });

  it('job status becomes failed when translateLocale throws a generic Error', async () => {
    mockTranslateLocale.mockRejectedValue(new Error('Unexpected network failure'));

    const jobId = startJob(service);

    await flush();

    const job = service.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('Unexpected network failure');
  });

  it('job error is a generic message when translateLocale rejects with a non-Error', async () => {
    mockTranslateLocale.mockRejectedValue('boom');

    const jobId = startJob(service);

    await flush();

    expect(service.getJob(jobId)?.error).toBe('An unexpected error occurred');
  });

  it('keeps the failed job DTO JSON key order', async () => {
    mockTranslateLocale.mockRejectedValue(new Error('failed'));
    const jobId = startJob(service);
    await flush();

    expect(Object.keys(service.getJob(jobId) ?? {})).toEqual([
      'jobId',
      'collectionName',
      'targetLocale',
      'status',
      'totalResources',
      'translatedCount',
      'failedCount',
      'skippedCount',
      'startedAt',
      'completedAt',
      'error',
    ]);
  });

  it.each(['completes', 'fails'])('applies only reported mutations when the job %s', async (outcome) => {
    const mutation: ResourceMutation = { kind: 'reindex', translationsFolder: collection.translationsFolder };
    const mutations = [mutation];
    if (outcome === 'completes') {
      mockTranslateLocale.mockImplementationOnce(
        (_collection: Collection, params: { onWrite?: (mutation: ResourceMutation) => void }) => {
          params.onWrite?.(mutation);
          return Promise.resolve(makeSuccessResult({ mutations }));
        },
      );
    } else {
      mockTranslateLocale.mockImplementationOnce(
        (_collection: Collection, params: { onWrite?: (mutation: ResourceMutation) => void }) => {
          params.onWrite?.(mutation);
          return Promise.reject(new Error('later failure'));
        },
      );
    }

    const jobId = startJob(service);
    expect(mockIndex.apply).not.toHaveBeenCalled();

    await flush();

    expect(service.getJob(jobId)?.status).toBe(outcome === 'completes' ? 'completed' : 'failed');
    expect(mockIndex.apply).toHaveBeenCalledTimes(1);
    expect(mockIndex.apply).toHaveBeenCalledWith(mutations);
  });

  it('does not apply a mutation when no folder was written', async () => {
    mockTranslateLocale.mockResolvedValue(makeSuccessResult());

    startJob(service);
    await flush();

    expect(mockIndex.apply).not.toHaveBeenCalled();
  });

  it('does not apply a mutation when the job fails before a write', async () => {
    mockTranslateLocale.mockRejectedValue(new TranslationError('No API key', 'MISSING_API_KEY', false));

    const jobId = startJob(service);
    await flush();

    expect(service.getJob(jobId)?.status).toBe('failed');
    expect(mockIndex.apply).not.toHaveBeenCalled();
  });

  it('logs the folders translateLocale could not read', async () => {
    mockTranslateLocale.mockResolvedValue(makeSuccessResult({ warnings: ["Folder 'broken' was not translated: bad"] }));

    const jobId = startJob(service);

    await flush();

    expect(mockLogger.warn).toHaveBeenCalledWith(`Translation job ${jobId}: Folder 'broken' was not translated: bad`);
  });

  it('getJob omits optional fields when there are no failures or skipped keys', async () => {
    mockTranslateLocale.mockResolvedValue(makeSuccessResult({ failures: [], skippedKeys: [] }));

    const jobId = startJob(service);

    await flush();

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
    await flush();
  });

  it('runs two jobs for the same collection and locale one after the other', async () => {
    let resolveFirst: ((result: TranslateLocaleResult) => void) | undefined;
    mockTranslateLocale
      .mockImplementationOnce(
        () =>
          new Promise<TranslateLocaleResult>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(makeSuccessResult());

    const firstId = startJob(service);
    const secondId = startJob(service);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockTranslateLocale).toHaveBeenCalledTimes(1);
    expect(service.getJob(firstId)?.status).toBe('running');
    expect(service.getJob(secondId)?.status).toBe('pending');

    resolveFirst?.(makeSuccessResult());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockTranslateLocale).toHaveBeenCalledTimes(2);
    expect(mockTranslateLocale).toHaveBeenNthCalledWith(2, collection, expect.objectContaining({ targetLocale: 'fr' }));
    expect(service.getJob(firstId)?.status).toBe('completed');
    expect(service.getJob(secondId)?.status).toBe('completed');
  });

  it('runs the next translation after the first reports a timed-out batch', async () => {
    mockTranslateLocale
      .mockResolvedValueOnce(
        makeSuccessResult({
          translatedCount: 0,
          failedCount: 1,
          failures: [{ key: 'ok', error: 'Google Translate request timed out' }],
        }),
      )
      .mockResolvedValueOnce(makeSuccessResult());

    const firstId = startJob(service);
    const secondId = startJob(service);
    await flush();

    expect(service.getJob(firstId)?.status).toBe('completed');
    expect(service.getJob(firstId)?.failedCount).toBe(1);
    expect(service.getJob(firstId)?.failures).toEqual([{ key: 'ok', error: 'Google Translate request timed out' }]);
    expect(service.getJob(secondId)?.status).toBe('completed');
  });
});
