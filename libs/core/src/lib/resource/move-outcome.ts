import type { RunOutcome } from '../run-outcome';

/** Errors fail a completed move, even when some resources moved. Warnings alone succeed. */
export function withMoveOutcome<T extends { readonly errors: readonly string[] }>(
  result: T,
): T & { readonly outcome: RunOutcome } {
  return { ...result, outcome: result.errors.length > 0 ? 'failed' : 'succeeded' };
}
