import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { splitAfterSeparators } from '../../utils/split-after-separators';

export type RunResultStatus = 'running' | 'completed' | 'failed';

/**
 * How a completed-strip clause reads. `figure` (the default for a plain string) is a
 * tabular-numeral count, `text` is plain copy and `mono` is an identifier such as a
 * folder, which may break after `.`, `_`, `-` and `/` instead of clipping.
 */
export interface RunResultClause {
  readonly text: string;
  readonly kind?: 'figure' | 'text' | 'mono';
}

interface ClauseView {
  readonly kind: 'figure' | 'text' | 'mono';
  readonly text: string;
  readonly parts: readonly string[];
}

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
 *
 * Details, Dismiss and Retry are opt-in: each renders only when its label input is set,
 * so a control never appears without an accessible name. Completed strips take all three
 * (Retry aside); failed strips take any of them.
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
  readonly clauses = input<readonly (string | RunResultClause)[]>([]);
  /** Completed: a count above zero switches to the warning tint and glyph. */
  readonly warningsCount = input(0);

  /** Failed: the error message, shown as prose after the headline. */
  readonly error = input<string | undefined>(undefined);
  /** Failed: the label of the retry button; the button is omitted without it. */
  readonly retryLabel = input<string | undefined>(undefined);

  /** Whether the details panel is open (completed or failed). */
  readonly detailsOpen = input(false);
  /** Id of the details panel, wired to `aria-controls` on the toggle. */
  readonly detailsId = input<string | undefined>(undefined);
  /** Text of the Details toggle; the toggle and the panel are omitted without it. */
  readonly detailsLabel = input<string | undefined>(undefined);
  readonly detailsAriaLabel = input<string | undefined>(undefined);
  /** Accessible name of the Dismiss button; the button is omitted without it. */
  readonly dismissAriaLabel = input<string | undefined>(undefined);

  readonly retry = output<void>();
  readonly dismiss = output<void>();
  /** The Details button was pressed; the caller flips `detailsOpen`. */
  readonly detailsToggle = output<void>();

  readonly isRunning = computed(() => this.status() === 'running');
  readonly isCompleted = computed(() => this.status() === 'completed');
  readonly isFailed = computed(() => this.status() === 'failed');
  readonly icon = computed(() => (this.isFailed() ? 'error' : this.hasWarnings() ? 'warning' : 'check_circle'));

  readonly clauseViews = computed<readonly ClauseView[]>(() =>
    this.clauses().map((clause) => {
      const { text, kind = 'figure' } = typeof clause === 'string' ? { text: clause } : clause;
      return { text, kind, parts: kind === 'mono' ? splitAfterSeparators(text) : [] };
    }),
  );

  readonly hasWarnings = computed(() => this.warningsCount() > 0);

  readonly progressPercent = computed(() => {
    const progress = this.progress();
    if (!progress || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  });
}
