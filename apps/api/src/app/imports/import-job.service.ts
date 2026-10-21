import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  detectImportFormat,
  inspectImportSource,
  LingoTrackerError,
  type OpenedProject,
  type RunImportOptions,
  runImport,
} from '@simoncodes-ca/core';
import type {
  ImportJobDto,
  ImportJobProgressDto,
  ImportJobResultDto,
  ImportPlanDto,
  ImportRequestDto,
} from '@simoncodes-ca/data-transfer';
import { JobRegistry } from '../jobs/job-registry';
import {
  type ImportFileRun,
  mapImportRequestToRunOptions,
  mapImportRunToJobResult,
  mapImportRunToPlan,
} from '../mappers/import.mapper';

export { JOB_RETENTION_MS, MAX_RETAINED_JOBS } from '../jobs/job-registry';
export interface StartImportJobParams {
  readonly project: OpenedProject;
  readonly request: ImportRequestDto;
}
interface ImportState {
  request: ImportRequestDto;
  progress: ImportJobProgressDto;
  result?: ImportJobResultDto;
  summaries: readonly (() => string)[];
}
type ImportSnapshot = ImportJobDto & { readonly summaries: readonly (() => string)[] };

/** One serial import queue, with source preflight before a pending job can be returned. */
@Injectable()
export class ImportJobService {
  readonly #logger: Logger;
  readonly #jobs = new JobRegistry<
    ImportState,
    Pick<ImportSnapshot, 'request' | 'status' | 'progress' | 'result' | 'summaries'>
  >(
    (state, status) => ({
      status,
      request: state.request,
      progress: { ...state.progress },
      summaries: state.summaries,
      ...(state.result && { result: state.result }),
    }),
    { jobName: 'Import' },
  );
  constructor(logger: Logger) {
    this.#logger = logger;
  }

  startJob({ project, request }: StartImportJobParams): ImportJobDto {
    const { collection, options } = mapImportRequestToRunOptions(request, project);
    const formats = options.map((option) => this.inspect(option));
    const total = options.length;
    return this.toDto(
      this.#jobs.start({
        initial: { request, progress: { current: 0, total }, summaries: [] },
        execute: async (_id, update) => {
          const runs: ImportFileRun[] = [];
          const summaries: (() => string)[] = [];
          for (const [index, option] of options.entries()) {
            const file = request.files[index];
            const format = formats[index];
            if (!file || !format) throw new Error('Missing import file');
            update({ progress: { current: index, total, currentFile: file.path, currentLocale: file.locale } });
            // Keep the caller's path in the core summary while resolving it against project cwd.
            const completed = await this.runFile(collection, { ...option, source: file.path }, file, format);
            runs.push(completed);
            summaries.push(
              completed.run?.summary ??
                (() =>
                  `## ${file.path}\n\n**Locale**: ${file.locale}\n\n**Source error**: ${completed.sourceProblem}\n`),
            );
            update({ progress: { current: index + 1, total }, summaries: [...summaries] });
          }
          update({ result: mapImportRunToJobResult(request, runs, project.projectRoot) });
        },
        onError: (id, message) => this.#logger.error(`Import job ${id} failed: ${message}`),
      }),
    );
  }

  async dryRun({ project, request }: StartImportJobParams): Promise<ImportPlanDto> {
    const { collection, options } = mapImportRequestToRunOptions(request, project);
    const runs: ImportFileRun[] = [];
    for (const [index, option] of options.entries()) {
      const file = request.files[index];
      if (!file) throw new Error('Missing import file');
      let format = option.format;
      try {
        format ??= detectImportFormat(option.source);
      } catch {
        // The plan requires a format even when detection fails; runImport supplies the sourceProblem.
      }
      runs.push(await this.runFile(collection, { ...option, source: file.path, dryRun: true }, file, format ?? 'json'));
    }
    return mapImportRunToPlan(request, runs);
  }

  getJob(id: string): ImportJobDto {
    return this.toDto(this.#jobs.get(id));
  }

  getSummary(id: string): string {
    const job = this.#jobs.get(id);
    if (job.status === 'pending' || job.status === 'running')
      throw new ConflictException('Import job is still running');
    return `# Import run: ${job.request.collection}\n\n${job.summaries.map((summary) => summary()).join('\n\n---\n\n')}`;
  }

  private toDto(snapshot: ImportSnapshot): ImportJobDto {
    const { summaries: _summaries, ...dto } = snapshot;
    return dto;
  }

  private inspect(option: RunImportOptions): 'json' | 'xliff' {
    try {
      const inspected = inspectImportSource(option.source, option.cwd ?? process.cwd());
      return option.format ?? inspected.format;
    } catch (error) {
      if (
        option.format !== undefined &&
        error instanceof LingoTrackerError &&
        error.code === 'IMPORT_SOURCE_ERROR' &&
        'stage' in error &&
        error.stage === 'format'
      )
        return option.format;
      throw error;
    }
  }

  private async runFile(
    collection: Parameters<typeof runImport>[0],
    option: RunImportOptions,
    file: ImportFileRun['file'],
    format: ImportFileRun['format'],
  ): Promise<ImportFileRun> {
    let large = false;
    let run: Awaited<ReturnType<typeof runImport>>;
    try {
      run = await runImport(collection, {
        ...option,
        onWarning: () => {
          large = true;
        },
      });
    } catch (error) {
      if (error instanceof LingoTrackerError && error.code === 'IMPORT_SOURCE_ERROR') {
        return { file, format, sourceProblem: error.message, large };
      }
      // A failed write can leave partial changes. Invalidate through the collection's sink.
      if (!option.dryRun) collection.onMutation({ kind: 'reindex', translationsFolder: collection.translationsFolder });
      throw error;
    }
    // Core import uses unreported folder saves; bridge its file report to the route's mutation sink.
    if (!option.dryRun && run.result.filesModified.length > 0) {
      collection.onMutation({ kind: 'reindex', translationsFolder: collection.translationsFolder });
    }
    return { file, format: run.format, run, large };
  }
}
