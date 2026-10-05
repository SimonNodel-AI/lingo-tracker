import { InvalidProjectTermsEditError } from '../errors/lingo-tracker-error';
import type { ProjectTermsUpdate } from './update-project-terms';

export interface PreferredTerminologyFlags {
  readonly list?: boolean;
  readonly add?: string;
  readonly preferred?: string;
  readonly reason?: string;
  readonly remove?: string;
}

/** Convert CLI flag values to a structured request, preserving incomplete-group refusal order. */
export function preferredTerminologyRequestFromFlags(
  options: PreferredTerminologyFlags,
): NonNullable<ProjectTermsUpdate['preferredTerminology']> {
  if (options.add !== undefined && options.remove !== undefined && options.preferred === undefined) {
    throw new InvalidProjectTermsEditError(
      'Only one preferred terminology edit can be applied at a time',
      'preferred-conflict',
    );
  }
  if (
    options.add === undefined &&
    (options.preferred !== undefined || options.reason !== undefined) &&
    (options.remove !== undefined || options.list === true)
  ) {
    throw new InvalidProjectTermsEditError(
      'Preferred terminology rule fields need a discouraged term',
      'preferred-orphan-flags',
    );
  }
  if (options.add !== undefined && options.preferred === undefined) {
    throw new InvalidProjectTermsEditError(
      'A preferred terminology upsert needs a preferred term',
      'preferred-incomplete-flags',
    );
  }
  return {
    list: options.list === true,
    ...(options.add !== undefined &&
      options.preferred !== undefined && {
        upsert: { discouraged: options.add, preferred: options.preferred, reason: options.reason },
      }),
    ...(options.remove !== undefined && { remove: options.remove }),
  };
}
