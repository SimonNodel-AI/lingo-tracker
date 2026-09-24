import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { reindexMutation, translateLocale } from '@simoncodes-ca/core';
import type { Collection, TranslateLocaleProgress } from '@simoncodes-ca/core';
import type { TranslateLocaleJobDto } from '@simoncodes-ca/data-transfer';
import { CollectionIndex } from '../cache/collection-index.service';

interface TranslationJob {
  jobId: string;
  collectionName: string;
  targetLocale: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalResources: number;
  translatedCount: number;
  failedCount: number;
  skippedCount: number;
  failures: Array<{ key: string; error: string }>;
  skippedKeys: string[];
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

@Injectable()
export class TranslationJobService {
  readonly #logger: Logger;
  readonly #index: CollectionIndex;
  readonly #jobs = new Map<string, TranslationJob>();

  constructor(logger: Logger, index: CollectionIndex) {
    this.#logger = logger;
    this.#index = index;
  }

  /**
   * Kicks off an async translate-locale job for an opened collection and returns its ID immediately.
   * The caller can poll `getJob(jobId)` to track progress.
   */
  startJob(collection: Collection, targetLocale: string): string {
    const jobId = randomUUID();

    const job: TranslationJob = {
      jobId,
      collectionName: collection.name,
      targetLocale,
      status: 'pending',
      totalResources: 0,
      translatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      failures: [],
      skippedKeys: [],
    };

    this.#jobs.set(jobId, job);

    this.#runJob(jobId, collection, targetLocale);

    return jobId;
  }

  /** Returns the current snapshot of a job as a DTO, or undefined if the job ID is unknown. */
  getJob(jobId: string): TranslateLocaleJobDto | undefined {
    const job = this.#jobs.get(jobId);

    if (!job) {
      return undefined;
    }

    return this.#toDto(job);
  }

  #runJob(jobId: string, collection: Collection, targetLocale: string): void {
    const onProgress = (progress: TranslateLocaleProgress): void => {
      const job = this.#jobs.get(jobId);

      if (!job) {
        return;
      }

      job.totalResources = progress.totalResources;
      job.translatedCount = progress.translatedCount;
      job.failedCount = progress.failedCount;
      job.skippedCount = progress.skippedCount;
    };

    const runningJob = this.#jobs.get(jobId);
    if (!runningJob) return;
    runningJob.status = 'running';
    runningJob.startedAt = new Date();

    // translateLocale writes resource files (even when it fails part-way), so the index is dropped either way.
    const reindex = (): void => this.#index.apply([reindexMutation(collection.translationsFolder)]);

    translateLocale(collection, { targetLocale, onProgress })
      .then((result) => {
        reindex();
        for (const warning of result.warnings) {
          this.#logger.warn(`Translation job ${jobId}: ${warning}`);
        }
        const completedJob = this.#jobs.get(jobId);

        if (!completedJob) {
          return;
        }

        completedJob.status = 'completed';
        completedJob.completedAt = new Date();
        completedJob.totalResources = result.totalResources;
        completedJob.translatedCount = result.translatedCount;
        completedJob.failedCount = result.failedCount;
        completedJob.skippedCount = result.skippedCount;
        completedJob.failures = [...result.failures];
        completedJob.skippedKeys = [...result.skippedKeys];
      })
      .catch((error: unknown) => {
        reindex();
        const failedJob = this.#jobs.get(jobId);

        if (!failedJob) {
          return;
        }

        failedJob.status = 'failed';
        failedJob.completedAt = new Date();

        if (error instanceof Error) {
          failedJob.error = error.message;
        } else {
          failedJob.error = 'An unexpected error occurred';
        }

        this.#logger.error(`Translation job ${jobId} failed: ${failedJob.error}`);
      });
  }

  #toDto(job: TranslationJob): TranslateLocaleJobDto {
    return {
      jobId: job.jobId,
      collectionName: job.collectionName,
      targetLocale: job.targetLocale,
      status: job.status,
      totalResources: job.totalResources,
      translatedCount: job.translatedCount,
      failedCount: job.failedCount,
      skippedCount: job.skippedCount,
      ...(job.failures.length > 0 && { failures: job.failures }),
      ...(job.skippedKeys.length > 0 && { skippedKeys: job.skippedKeys }),
      ...(job.startedAt && { startedAt: job.startedAt.toISOString() }),
      ...(job.completedAt && { completedAt: job.completedAt.toISOString() }),
    };
  }
}
