import type { RunOutcome } from '../run-outcome';
import { describeFolderProblem } from './collection-folders';
import type { PruneResult } from './folder-pruning';
import type { RelocationResult } from './relocate-entries';

export interface MoveResult {
  readonly outcome: RunOutcome;
  /** Number of source folders removed; present for folder selections and batches containing them. */
  readonly foldersDeleted?: number;
  movedCount: number;
  warnings: string[];
  errors: string[];
}

/** Accumulates completed moves; malformed input is thrown before reporting. */
export class MoveReport {
  private movedCount = 0;
  private readonly warnings: string[] = [];
  private readonly errors: string[] = [];
  private foldersDeleted = 0;

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  merge(result: RelocationResult | MoveResult): void {
    if ('moved' in result) {
      this.movedCount += result.moved.length;
      for (const { to } of result.collisions) {
        this.warn(`Destination key already exists: ${to}. Use override option to force move.`);
      }
    } else {
      this.movedCount += result.movedCount;
      this.foldersDeleted += result.foldersDeleted ?? 0;
      this.warnings.push(...result.warnings);
    }
    this.errors.push(...result.errors);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  fail(message: string): void {
    this.errors.push(message);
  }

  /** Counts only removal of the source itself, preserving folder move diagnostics. */
  prune(source: string, result: PruneResult, empty: boolean): void {
    if (result.removed.includes(source)) {
      this.foldersDeleted++;
      return;
    }
    const resources = result.kept
      .filter((folder) => folder.reason === 'entries')
      .flatMap((folder) => folder.entries ?? []);
    if (resources.length > 0) this.warn(`Source folder kept: it has resources again: ${resources.join(', ')}`);
    if (result.problems.length > 0) {
      this.pruningFailed(result.problems.map((problem) => describeFolderProblem(problem)).join(', '), empty);
      return;
    }
    const leftovers = result.kept
      .filter((folder) => folder.reason === 'content')
      .flatMap((folder) => folder.entries ?? []);
    if (leftovers.length > 0) {
      this.warn(`Source folder kept: holds content that is not part of the collection: ${leftovers.join(', ')}`);
    }
  }

  pruningFailed(error: unknown, empty: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    if (empty) this.fail(`Failed to delete empty source folder: ${message}`);
    else this.warn(`Resources moved but failed to delete source folder: ${message}`);
  }

  finish(): MoveResult;
  finish(folder: true): MoveResult & { foldersDeleted: number };
  finish(folder?: true): MoveResult & { foldersDeleted?: number } {
    return {
      movedCount: this.movedCount,
      warnings: [...this.warnings],
      errors: [...this.errors],
      outcome: this.hasErrors ? 'failed' : 'succeeded',
      ...(folder ? { foldersDeleted: this.foldersDeleted } : {}),
    };
  }
}
