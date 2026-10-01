/** A list edit before caller-specific normalization. */
export interface ListEdit {
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
  readonly set?: readonly string[];
}

export type ListEditProblem = 'conflict' | 'missing';

export function listEditProblem(edit: ListEdit): ListEditProblem | undefined {
  const hasAdd = (edit.add ?? []).length > 0;
  const hasRemove = (edit.remove ?? []).length > 0;
  if (edit.set !== undefined && (hasAdd || hasRemove)) return 'conflict';
  if (edit.set === undefined && !hasAdd && !hasRemove) return 'missing';
  return undefined;
}

/** Merge a checked edit; the caller supplies its own normalization. */
export function mergeListEdit(
  current: readonly string[],
  edit: ListEdit,
  normalize: (values: string[]) => string[],
): string[] {
  if (edit.set !== undefined) return normalize([...edit.set]);
  const result = [...current];
  for (const value of normalize([...(edit.add ?? [])])) {
    if (!result.includes(value)) result.push(value);
  }
  const removed = normalize([...(edit.remove ?? [])]);
  return result.filter((value) => !removed.includes(value));
}
