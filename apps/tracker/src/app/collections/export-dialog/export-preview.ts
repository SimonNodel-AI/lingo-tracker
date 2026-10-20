import { signal } from '@angular/core';
import type { ExportPlanDto, ExportRequestDto } from '@simoncodes-ca/data-transfer';
import {
  catchError,
  debounceTime,
  map,
  merge,
  type Observable,
  of,
  Subject,
  type Subscription,
  startWith,
  switchMap,
  tap,
} from 'rxjs';
import { apiErrorMessage } from '../../shared/api-error/api-error';
import type { ExportDraft } from './export-draft';

export interface ExportPreviewOptions {
  request: () => ExportRequestDto | undefined;
  failureMessage: () => string;
  dryRun: (request: ExportRequestDto) => Observable<ExportPlanDto>;
}

/** The caller owns the subscription, including cancellation when the dialog closes. */
export class ExportPreview {
  readonly plan = signal<ExportPlanDto | undefined>(undefined);
  readonly stale = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly status = signal<'waiting' | 'loading' | 'ready' | 'error'>('waiting');

  readonly #refresh = new Subject<void>();

  constructor(private readonly options: ExportPreviewOptions) {}

  /** Run the dry run again for the current form, e.g. after a failed one. */
  refresh(): void {
    this.#refresh.next();
  }

  connect(changes: Observable<unknown>): Subscription {
    let revision = 0;
    return merge(changes, this.#refresh)
      .pipe(
        startWith(null),
        tap(() => {
          revision += 1;
          this.stale.set(true);
        }),
        debounceTime(300),
        map(() => ({ request: this.options.request(), version: revision })),
        switchMap(({ request, version }) => {
          this.error.set(undefined);
          if (!request) return of({ version, status: 'waiting' as const, plan: undefined, error: undefined });
          this.status.set('loading');
          return this.options.dryRun(request).pipe(
            map((plan) => ({ version, status: 'ready' as const, plan, error: undefined })),
            catchError((error: unknown) =>
              of({
                version,
                status: 'error' as const,
                plan: undefined,
                error: apiErrorMessage(error, this.options.failureMessage()),
              }),
            ),
          );
        }),
      )
      .subscribe(({ version, status, plan, error }) => {
        // An older response can arrive during the debounce of a newer edit.
        if (version !== revision) return;
        this.status.set(status);
        if (status !== 'error') this.plan.set(plan);
        this.error.set(error);
        this.stale.set(false);
      });
  }
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Fixed English sample values below are example data, not UI copy. */
export function entryShape(
  draft: ExportDraft,
  example?: ExportPlanDto['exampleKey'],
): { language: 'xml' | 'json'; lines: string[] } {
  const key = example?.key ?? 'buttons.save';
  const baseValue = example?.baseValue ?? 'Save changes';
  // Neutral on purpose: a real key beside an invented translation would read as a wrong one.
  const target = '…';
  const note = 'Do not translate: LingoTracker';
  if (draft.format === 'xliff') {
    return {
      language: 'xml',
      lines: [
        `<trans-unit id="${xml(key)}">`,
        `  <source>${xml(baseValue)}</source>`,
        `  <target>${xml(target)}</target>`,
        ...(draft.protectedTermNotes ? [`  <note>${xml(note)}</note>`] : []),
        '</trans-unit>',
      ],
    };
  }
  const options = draft.json;
  const entry = {
    value: target,
    ...(options.includeBase ? { [options.basePropertyName.trim() || 'baseValue']: baseValue } : {}),
    ...(options.includeStatus ? { status: 'stale' } : {}),
    ...(options.includeComment ? { comment: 'Primary action' } : {}),
    ...(options.includeTags ? { tags: ['ui'] } : {}),
    ...(draft.protectedTermNotes ? { doNotTranslate: ['LingoTracker'] } : {}),
  };
  let shape: unknown = options.rich ? entry : target;
  const segments = options.structure === 'flat' ? [key] : key.split('.');
  for (const segment of segments.reverse()) shape = { [segment]: shape };
  return { language: 'json', lines: JSON.stringify(shape, null, 2).split('\n') };
}
