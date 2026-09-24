import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { BundleDefinition, BundleProgressEvent, LingoTrackerConfig } from '@simoncodes-ca/core';
import { generateBundle } from '@simoncodes-ca/core';
import type {
  BundleGenerateJobDto,
  BundleGenerateJobProgressDto,
  BundleGenerateJobResultDto,
  BundleGenerateJobStatus,
} from '@simoncodes-ca/data-transfer';
import { mapGenerateBundleResultToJobResult } from '../mappers/bundle.mapper';

export interface StartBundleJobParams {
  readonly bundleName: string;
  readonly bundleDefinition: BundleDefinition;
  readonly config: LingoTrackerConfig;
  readonly locales?: string[];
}

interface BundleJob {
  jobId: string;
  bundleName: string;
  status: BundleGenerateJobStatus;
  progress: BundleGenerateJobProgressDto;
  result?: BundleGenerateJobResultDto;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/** Finished jobs older than this are evicted on the next `startJob`. */
export const JOB_RETENTION_MS = 30 * 60 * 1000;
/** Upper bound on retained jobs; the oldest finished ones are evicted first. */
export const MAX_RETAINED_JOBS = 100;

/**
 * Runs bundle generation as fire-and-forget jobs that the caller polls.
 *
 * Jobs are queued and run one at a time: two bundles may write the same output
 * folder, and type generation reads the config from disk, so overlapping runs
 * could interleave writes.
 */
@Injectable()
export class BundleJobService {
  readonly #logger: Logger;
  readonly #jobs = new Map<string, BundleJob>();
  #queue: Promise<void> = Promise.resolve();

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  /** Registers a job, schedules it behind any running job, and returns its ID. */
  startJob(params: StartBundleJobParams): string {
    this.#evictFinishedJobs();

    const jobId = randomUUID();
    this.#jobs.set(jobId, {
      jobId,
      bundleName: params.bundleName,
      status: 'pending',
      progress: { current: 0, total: 0 },
    });

    this.#queue = this.#queue.then(() => this.#runJob(jobId, params));

    return jobId;
  }

  /** Returns the current snapshot of a job, or undefined if the job ID is unknown. */
  getJob(jobId: string): BundleGenerateJobDto | undefined {
    const job = this.#jobs.get(jobId);
    return job ? this.#toDto(job) : undefined;
  }

  async #runJob(jobId: string, params: StartBundleJobParams): Promise<void> {
    const job = this.#jobs.get(jobId);
    if (!job) return;

    job.status = 'running';
    job.startedAt = new Date();

    const onProgress = (event: BundleProgressEvent): void => {
      const running = this.#jobs.get(jobId);
      if (!running) return;
      running.progress = { current: event.index, total: event.total, currentFile: event.file };
    };

    try {
      const result = await generateBundle({
        bundleKey: params.bundleName,
        bundleDefinition: params.bundleDefinition,
        config: params.config,
        ...(params.locales && { locales: params.locales }),
        onProgress,
        cwd: process.cwd(),
      });

      const completed = this.#jobs.get(jobId);
      if (!completed) return;

      completed.status = 'completed';
      completed.completedAt = new Date();
      completed.progress = { current: completed.progress.total, total: completed.progress.total };
      completed.result = mapGenerateBundleResultToJobResult(result, params.bundleDefinition);
    } catch (error: unknown) {
      const failed = this.#jobs.get(jobId);
      if (!failed) return;

      failed.status = 'failed';
      failed.completedAt = new Date();
      failed.error = error instanceof Error ? error.message : 'An unexpected error occurred';

      this.#logger.error(`Bundle job ${jobId} (${params.bundleName}) failed: ${failed.error}`);
    }
  }

  #evictFinishedJobs(): void {
    const now = Date.now();
    const finished = [...this.#jobs.values()]
      .filter((job) => job.completedAt !== undefined)
      .sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0));

    for (const job of finished) {
      const completedAt = job.completedAt?.getTime() ?? now;
      if (now - completedAt > JOB_RETENTION_MS) {
        this.#jobs.delete(job.jobId);
      }
    }

    // `startJob` adds one more after this, so leave room for it.
    let excess = this.#jobs.size - (MAX_RETAINED_JOBS - 1);
    for (const job of finished) {
      if (excess <= 0) break;
      if (this.#jobs.delete(job.jobId)) excess--;
    }
  }

  #toDto(job: BundleJob): BundleGenerateJobDto {
    return {
      jobId: job.jobId,
      bundleName: job.bundleName,
      status: job.status,
      progress: { ...job.progress },
      ...(job.result && { result: job.result }),
      ...(job.error !== undefined && { error: job.error }),
      ...(job.startedAt && { startedAt: job.startedAt.toISOString() }),
      ...(job.completedAt && { completedAt: job.completedAt.toISOString() }),
    };
  }
}
