import { Injectable, Logger } from '@nestjs/common';
import type { BundleProgressEvent, LingoTrackerConfig } from '@simoncodes-ca/core';
import { generateBundle, validateGenerateBundleRequest } from '@simoncodes-ca/core';
import type {
  BundleGenerateJobDto,
  BundleGenerateJobProgressDto,
  BundleGenerateJobResultDto,
} from '@simoncodes-ca/data-transfer';
import { JobRegistry } from '../jobs/job-registry';
import { mapGenerateBundleResultToJobResult } from '../mappers/bundle.mapper';

export { JOB_RETENTION_MS, MAX_RETAINED_JOBS } from '../jobs/job-registry';

export interface StartBundleJobParams {
  readonly bundleName: string;
  readonly config: LingoTrackerConfig;
  readonly locales?: readonly string[];
}

interface BundleState {
  bundleName: string;
  progress: BundleGenerateJobProgressDto;
  result?: BundleGenerateJobResultDto;
}

/** Runs bundle generation through its own serial Job Registry. */
@Injectable()
export class BundleJobService {
  readonly #logger: Logger;
  readonly #jobs = new JobRegistry<
    BundleState,
    Pick<BundleGenerateJobDto, 'bundleName' | 'status' | 'progress' | 'result'>
  >(
    (state, status) => ({
      bundleName: state.bundleName,
      status,
      progress: { ...state.progress },
      ...(state.result && { result: state.result }),
    }),
    { errorBeforeTimestamps: true },
  );

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  /** Validates synchronously, then registers a pending job and returns its ID. */
  startJob(params: StartBundleJobParams): string {
    validateGenerateBundleRequest({ bundleKey: params.bundleName, config: params.config, locales: params.locales });
    return this.#jobs.start({
      initial: { bundleName: params.bundleName, progress: { current: 0, total: 0 } },
      execute: async (_jobId, update) => {
        let total = 0;
        const onProgress = (event: BundleProgressEvent): void => {
          total = event.total;
          update({ progress: { current: event.index, total: event.total, currentFile: event.file } });
        };
        const result = await generateBundle({
          bundleKey: params.bundleName,
          config: params.config,
          ...(params.locales && { locales: params.locales }),
          onProgress,
          cwd: process.cwd(),
        });
        if (result.typeOutcome.warning) this.#logger.warn(result.typeOutcome.warning);
        update({
          progress: { current: total, total },
          result: mapGenerateBundleResultToJobResult(result),
        });
      },
      onError: (jobId, message) => {
        this.#logger.error(`Bundle job ${jobId} (${params.bundleName}) failed: ${message}`);
      },
    });
  }

  getJob(jobId: string): BundleGenerateJobDto | undefined {
    return this.#jobs.get(jobId);
  }
}
