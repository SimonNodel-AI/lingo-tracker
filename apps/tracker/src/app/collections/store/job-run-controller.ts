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

export interface JobSnapshot<Request> {
  readonly jobId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed';
  readonly request: Request;
  readonly progress?: unknown;
  readonly result?: unknown;
  readonly error?: string;
  readonly completedAt?: string;
}

export interface JobRunState<Request, Job extends JobSnapshot<Request>> {
  status: 'running' | 'completed' | 'failed';
  jobId?: string;
  request: Request;
  progress?: Job['progress'];
  result?: Job['result'];
  error?: string;
  finishedAt?: string;
}

export const JOB_POLL_INTERVAL_MS = 500;

export interface Jobs<Request, Job> {
  start(request: Request): Observable<Job>;
  getJob(id: string): Observable<Job>;
  failureMessage(): string;
}

/** One job run; request failures remain observable to the submitting dialog. */
export class JobRunController<Request, Job extends JobSnapshot<Request>> {
  private readonly state = new BehaviorSubject<JobRunState<Request, Job> | null>(null);
  readonly changes = this.state.asObservable();
  private subscription = new Subscription();

  constructor(
    private readonly jobs: Jobs<Request, Job>,
    private readonly storage: Pick<KeyedStorage<JobRunState<Request, Job>>, 'read' | 'write' | 'remove'>,
    private readonly time: BundleTime,
  ) {}

  private publish(run: JobRunState<Request, Job>): void {
    this.state.next(run);
    this.storage.write(run);
  }

  private fail(error: unknown, request: Request): void {
    this.publish({
      ...this.state.value,
      request,
      status: 'failed',
      error: toBundleErrorMessage(error, this.jobs.failureMessage()),
      finishedAt: this.time.now(),
    });
  }

  private follow(initial: Observable<Job>, resumed: boolean): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
    this.subscription.add(
      followJob(initial, {
        getJob: (id) => this.jobs.getJob(id),
        jobId: (job) => job.jobId,
        isFinished: (job) => job.status === 'completed' || job.status === 'failed',
        poll: (ms) => this.time.poll(ms),
        intervalMs: JOB_POLL_INTERVAL_MS,
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

  start(request: Request): Observable<Job> {
    return defer(() => {
      if (this.state.value?.status === 'running') return EMPTY;
      const previous = this.state.value;
      const pending: JobRunState<Request, Job> = { status: 'running', request };
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

  retry(): Request | undefined {
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
