import type {
  ExportJobDto,
  ExportJobProgressDto,
  ExportJobResultDto,
  ExportRequestDto,
} from '@simoncodes-ca/data-transfer';
import {
  BehaviorSubject,
  catchError,
  defer,
  EMPTY,
  finalize,
  type Observable,
  of,
  Subscription,
  tap,
  throwError,
} from 'rxjs';
import type { KeyedStorage } from '../../shared/storage/keyed-storage';
import { toBundleErrorMessage } from './bundle-runs';
import type { BundleTime } from './bundle-run-controller';
import { followJob } from './job-polling';

export const EXPORT_RUN_STORAGE_KEY = 'lingo-tracker.exportRun';
export const EXPORT_JOB_POLL_INTERVAL_MS = 500;

export interface ExportRunState {
  status: 'running' | 'completed' | 'failed';
  jobId?: string;
  request: ExportRequestDto;
  progress?: ExportJobProgressDto;
  result?: ExportJobResultDto;
  error?: string;
  finishedAt?: string;
}

/** Absent or corrupt storage is ignored, as with persisted bundle runs. */
export function readPersistedExportRun(raw: string | null | undefined): ExportRunState | undefined {
  try {
    const run: unknown = JSON.parse(raw ?? 'null');
    if (typeof run !== 'object' || run === null || !('status' in run) || !('request' in run)) return undefined;
    if (!['running', 'completed', 'failed'].includes(String(run.status))) return undefined;
    const request = run.request;
    if (typeof request !== 'object' || request === null || !('format' in request)) return undefined;
    if (request.format !== 'json' && request.format !== 'xliff') return undefined;
    if ('jobId' in run && typeof run.jobId !== 'string') return undefined;
    return run as ExportRunState;
  } catch {
    return undefined;
  }
}

interface ExportJobs {
  start(request: ExportRequestDto): Observable<ExportJobDto>;
  getJob(id: string): Observable<ExportJobDto>;
  failureMessage(): string;
}

/** One export run; request failures remain observable to the submitting dialog. */
export class ExportRunController {
  private readonly state = new BehaviorSubject<ExportRunState | null>(null);
  readonly changes = this.state.asObservable();
  private subscription = new Subscription();

  constructor(
    private readonly jobs: ExportJobs,
    private readonly storage: Pick<KeyedStorage<ExportRunState>, 'read' | 'write' | 'remove'>,
    private readonly time: BundleTime,
  ) {}

  private publish(run: ExportRunState): void {
    this.state.next(run);
    this.storage.write(run);
  }

  private fail(error: unknown, request: ExportRequestDto): void {
    this.publish({
      ...this.state.value,
      request,
      status: 'failed',
      error: toBundleErrorMessage(error, this.jobs.failureMessage()),
      finishedAt: this.time.now(),
    });
  }

  private follow(initial: Observable<ExportJobDto>, resumed: boolean): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
    this.subscription.add(
      followJob(initial, {
        getJob: (id) => this.jobs.getJob(id),
        jobId: (job) => job.jobId,
        isFinished: (job) => job.status === 'completed' || job.status === 'failed',
        poll: (ms) => this.time.poll(ms),
        intervalMs: EXPORT_JOB_POLL_INTERVAL_MS,
      })
        .pipe(
          tap((job) =>
            this.publish({
              status: job.status === 'pending' ? 'running' : job.status,
              jobId: job.jobId,
              request: job.request,
              progress: job.progress,
              result: job.result,
              error: job.error,
              finishedAt:
                job.status === 'completed' || job.status === 'failed'
                  ? (job.completedAt ?? this.time.now())
                  : undefined,
            }),
          ),
          catchError((error: unknown) => {
            const run = this.state.value;
            if (resumed) this.clear();
            else if (run) this.fail(error, run.request);
            return EMPTY;
          }),
        )
        .subscribe(),
    );
  }

  start(request: ExportRequestDto): Observable<ExportJobDto> {
    return defer(() => {
      if (this.state.value?.status === 'running') return EMPTY;
      const previous = this.state.value;
      const pending: ExportRunState = { status: 'running', request };
      let accepted = false;
      const restorePrevious = (): void => {
        if (!accepted && this.state.value === pending) this.state.next(previous);
      };
      // The busy state belongs to the dialog until the server accepts a job.
      // Keep the previous persisted run intact during the start request.
      this.state.next(pending);
      return defer(() => this.jobs.start(request)).pipe(
        tap((job) => {
          accepted = true;
          this.follow(of(job), false);
        }),
        catchError((error: unknown) => {
          restorePrevious();
          return throwError(() => error);
        }),
        finalize(restorePrevious),
      );
    });
  }

  retry(): ExportRequestDto | undefined {
    return this.state.value?.request;
  }

  clear(): void {
    this.subscription.unsubscribe();
    this.state.next(null);
    this.storage.remove();
  }

  restore(): void {
    const run = this.storage.read();
    if (!run) return;
    this.subscription.unsubscribe();
    this.state.next(run);
    if (run.status === 'running') {
      const id = run.jobId;
      if (id)
        this.follow(
          defer(() => this.jobs.getJob(id)),
          true,
        );
      else this.clear();
    }
  }

  destroy(): void {
    this.subscription.unsubscribe();
    this.state.complete();
  }
}
