import { Injectable, Logger } from '@nestjs/common';
import { type OpenedProject, prepareExportRun, writePreparedExport } from '@simoncodes-ca/core';
import type {
  ExportJobDto,
  ExportJobProgressDto,
  ExportJobResultDto,
  ExportRequestDto,
} from '@simoncodes-ca/data-transfer';
import { JobRegistry } from '../jobs/job-registry';
import { mapExportRequestToRunOptions, mapExportRunResultToJobResult } from '../mappers/export.mapper';

export { JOB_RETENTION_MS, MAX_RETAINED_JOBS } from '../jobs/job-registry';

export interface StartExportJobParams {
  readonly project: OpenedProject;
  readonly request: ExportRequestDto;
}

interface ExportState {
  request: ExportRequestDto;
  progress: ExportJobProgressDto;
  result?: ExportJobResultDto;
}

/** Prepares before answering the POST, then writes through one serial queue. */
@Injectable()
export class ExportJobService {
  readonly #logger: Logger;
  readonly #jobs = new JobRegistry<ExportState, Pick<ExportJobDto, 'request' | 'status' | 'progress' | 'result'>>(
    (state, status) => ({
      status,
      progress: { ...state.progress },
      request: state.request,
      ...(state.result && { result: state.result }),
    }),
    { jobName: 'Export' },
  );

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  startJob(params: StartExportJobParams): ExportJobDto {
    const { collections, options } = mapExportRequestToRunOptions(params.request, params.project);
    const prepared = prepareExportRun(collections, options);
    const total = prepared.files.length;
    return this.#jobs.start({
      initial: { request: params.request, progress: { current: 0, total } },
      execute: async (_jobId, update) => {
        const result = await writePreparedExport(prepared, {
          onLocale: ({ index, total, fileName }) => {
            update({ progress: { current: index, total, currentFile: fileName } });
          },
        });
        update({
          progress: { current: total, total },
          result: mapExportRunResultToJobResult(result, params.project.projectRoot),
        });
      },
      onError: (jobId, message) => this.#logger.error(`Export job ${jobId} failed: ${message}`),
    });
  }

  getJob(jobId: string): ExportJobDto {
    return this.#jobs.get(jobId);
  }
}
