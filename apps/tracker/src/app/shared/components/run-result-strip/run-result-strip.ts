import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type RunResultStatus = 'running' | 'completed' | 'failed';

/** How far a running job has got, in whole units such as locales. */
export interface RunResultProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * The result strip of a long-running job: running, completed (with or without warnings)
 * or failed. Used by the bundle card and the collections export strip.
 *
 * The component owns the anatomy, tints and separators; the caller passes every piece of
 * copy already translated. The details panel body is projected and only rendered while
 * `detailsOpen` is true, so the caller owns the open state and reacts to `detailsToggle`.
 */
@Component({
  selector: 'app-run-result-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  templateUrl: './run-result-strip.html',
  styleUrl: './run-result-strip.scss',
})
export class RunResultStrip {
  readonly status = input.required<RunResultStatus>();

  /** The bold lead clause, for example "Generating…", "Exported" or "Export failed". */
  readonly headline = input.required<string>();

  /** Running: the verb before the current item, for example "Writing". */
  readonly currentItemLabel = input<string | undefined>(undefined);
  /** Running: the item being processed, shown as a mono identifier after the label. */
  readonly currentItem = input<string | undefined>(undefined);

  /** Running: drives the progress bar. */
  readonly progress = input<RunResultProgress | undefined>(undefined);
  /** Running: the progress clause, for example "2 of 4 locales". Omitted when undefined. */
  readonly progressLabel = input<string | undefined>(undefined);

  /** Completed: summary clauses after the headline, in order. Include any warnings clause. */
  readonly clauses = input<readonly string[]>([]);
  /** Completed: a count above zero switches to the warning tint and glyph. */
  readonly warningsCount = input(0);

  /** Failed: the error message, shown as prose after the headline. */
  readonly error = input<string | undefined>(undefined);
  /** Failed: the label of the retry button. */
  readonly retryLabel = input<string | undefined>(undefined);

  /** Completed: whether the details panel is open. */
  readonly detailsOpen = input(false);
  /** Completed: id of the details panel, wired to `aria-controls` on the toggle. */
  readonly detailsId = input<string | undefined>(undefined);
  readonly detailsLabel = input<string | undefined>(undefined);
  readonly detailsAriaLabel = input<string | undefined>(undefined);
  readonly dismissAriaLabel = input<string | undefined>(undefined);

  readonly retry = output<void>();
  readonly dismiss = output<void>();
  /** The Details button was pressed; the caller flips `detailsOpen`. */
  readonly detailsToggle = output<void>();

  readonly hasWarnings = computed(() => this.warningsCount() > 0);

  readonly progressPercent = computed(() => {
    const progress = this.progress();
    if (!progress || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  });
}
