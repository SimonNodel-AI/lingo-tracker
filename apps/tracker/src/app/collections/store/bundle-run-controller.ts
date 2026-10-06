import { BehaviorSubject, catchError, defer, of, Subscription, switchMap, takeWhile, tap, type Observable } from 'rxjs';
import type { BundleGenerateJobDto } from '@simoncodes-ca/data-transfer';
import type { KeyedStorage } from '../../shared/storage/keyed-storage';
import { isJobFinished, mapJobToRun, toBundleErrorMessage, type BundleRunState } from './bundle-runs';

export const BUNDLE_JOB_POLL_INTERVAL_MS = 500;
export const BUNDLE_RUNS_STORAGE_KEY = 'lingo-tracker.bundleRuns';

export interface BundleJobs {
  generate(name: string, locales?: readonly string[]): Observable<BundleGenerateJobDto>;
  getJob(jobId: string): Observable<BundleGenerateJobDto>;
  failureMessage(): string;
}
export interface BundleTime {
  now(): string;
  poll(intervalMs: number): Observable<unknown>;
}
export interface BundleRunSnapshot {
  bundleRuns: Record<string, BundleRunState>;
  bundleBatch: readonly string[];
  batchPosition: number;
  isBatchRunning: boolean;
}

/** Owns concurrent run lifecycles; its ports require no Angular or HTTP environment. */
export class BundleRunController {
  private readonly state = new BehaviorSubject<BundleRunSnapshot>({
    bundleRuns: {},
    bundleBatch: [],
    batchPosition: 1,
    isBatchRunning: false,
  });
  readonly changes = this.state.asObservable();
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private readonly jobs: BundleJobs,
    private readonly storage: Pick<KeyedStorage<Record<string, BundleRunState>>, 'read' | 'write' | 'remove'>,
    private readonly time: BundleTime,
  ) {}

  private publish(runs: Record<string, BundleRunState>, batch = this.state.value.bundleBatch): void {
    const finished = batch.filter(
      (name) => runs[name]?.status === 'completed' || runs[name]?.status === 'failed',
    ).length;
    this.state.next({
      bundleRuns: runs,
      bundleBatch: batch,
      batchPosition: Math.min(Math.max(batch.length, 1), finished + 1),
      isBatchRunning: batch.some((name) => runs[name]?.status === 'running'),
    });
  }

  private setRun(name: string, run: BundleRunState): void {
    const runs = { ...this.state.value.bundleRuns, [name]: run };
    this.publish(runs);
    this.storage.write(runs);
  }

  private stop(name: string): void {
    this.subscriptions.get(name)?.unsubscribe();
    this.subscriptions.delete(name);
  }

  clear(name: string): void {
    this.stop(name);
    const { [name]: _removed, ...runs } = this.state.value.bundleRuns;
    this.publish(runs);
    if (Object.keys(runs).length === 0) this.storage.remove();
    else this.storage.write(runs);
  }

  private follow(name: string, initial: Observable<BundleGenerateJobDto>, resumed: boolean): void {
    this.stop(name);
    const subscription = new Subscription();
    this.subscriptions.set(name, subscription);
    const update = (job: BundleGenerateJobDto): void =>
      this.setRun(name, mapJobToRun(job, this.state.value.bundleRuns[name], this.time.now()));
    subscription.add(
      initial
        .pipe(
          tap(update),
          switchMap((job) =>
            isJobFinished(job)
              ? of(job)
              : this.time.poll(BUNDLE_JOB_POLL_INTERVAL_MS).pipe(
                  switchMap(() => this.jobs.getJob(job.jobId)),
                  tap(update),
                  takeWhile((snapshot) => !isJobFinished(snapshot), true),
                ),
          ),
          catchError((error: unknown) => {
            if (resumed) this.clear(name);
            else
              this.setRun(name, {
                ...this.state.value.bundleRuns[name],
                status: 'failed',
                error: toBundleErrorMessage(error, this.jobs.failureMessage()),
                finishedAt: this.time.now(),
              });
            return of(null);
          }),
        )
        .subscribe(),
    );
  }

  start(name: string, locales?: readonly string[], defaultLocaleCount = 0): boolean {
    if (this.state.value.bundleRuns[name]?.status === 'running') return false;
    this.setRun(name, { status: 'running', progress: { current: 0, total: locales?.length ?? defaultLocaleCount } });
    this.follow(
      name,
      defer(() => this.jobs.generate(name, locales)),
      false,
    );
    return true;
  }

  startAll(names: readonly string[], defaultLocaleCount = 0): void {
    if (this.state.value.isBatchRunning) return;
    const started = names.filter((name) => this.start(name, undefined, defaultLocaleCount));
    this.publish(this.state.value.bundleRuns, started);
  }

  restore(): void {
    const runs = this.storage.read() ?? {};
    if (Object.keys(runs).length === 0) return;
    this.publish(runs);
    for (const [name, run] of Object.entries(runs)) {
      if (run.status === 'running' && run.jobId) {
        const jobId = run.jobId;
        this.follow(
          name,
          defer(() => this.jobs.getJob(jobId)),
          true,
        );
      }
    }
  }

  destroy(): void {
    for (const name of this.subscriptions.keys()) this.stop(name);
    this.state.complete();
  }
}
