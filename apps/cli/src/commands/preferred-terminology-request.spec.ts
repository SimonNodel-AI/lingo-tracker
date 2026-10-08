import { describe, expect, it } from 'vitest';
import {
  InvalidProjectTermsEditError,
  isProtectedTermsEditProblem,
  isPreferredTerminologyEditProblem,
} from '@simoncodes-ca/core';
import { preferredTerminologyRequestFromFlags } from './preferred-terminology-request';

describe('preferredTerminologyRequestFromFlags', () => {
  it('narrows each command to its own problem codes and rejects unknown codes', () => {
    expect(isProtectedTermsEditProblem('protected-file-path')).toBe(true);
    expect(isPreferredTerminologyEditProblem('protected-file-path')).toBe(false);
    expect(isPreferredTerminologyEditProblem('preferred-incomplete-flags')).toBe(true);
    expect(isProtectedTermsEditProblem('preferred-incomplete-flags')).toBe(false);
    expect(isProtectedTermsEditProblem('unknown')).toBe(false);
    expect(isPreferredTerminologyEditProblem(undefined)).toBe(false);
  });
  it('builds rule and list requests without CLI wording', () => {
    expect(
      preferredTerminologyRequestFromFlags({ list: true, add: 'Old', preferred: 'New', reason: 'Use this' }),
    ).toEqual({ list: true, upsert: { discouraged: 'Old', preferred: 'New', reason: 'Use this' } });
    expect(preferredTerminologyRequestFromFlags({ remove: 'Old' })).toEqual({ list: false, remove: 'Old' });
  });

  it('reports typed incomplete groups in the existing refusal order', () => {
    const inputs = [
      [{ add: 'Old', remove: 'Other' }, 'preferred-conflict'],
      [{ preferred: 'New', list: true }, 'preferred-orphan-flags'],
      [{ add: 'Old' }, 'preferred-incomplete-flags'],
    ] as const;
    for (const [flags, problem] of inputs) {
      try {
        preferredTerminologyRequestFromFlags(flags);
        throw new Error('Expected refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidProjectTermsEditError);
        expect((error as InvalidProjectTermsEditError).problem).toBe(problem);
      }
    }
    // With neither an action nor list, structured validation still owns the missing-edit refusal.
    expect(preferredTerminologyRequestFromFlags({ preferred: 'New' })).toEqual({ list: false });
  });
});
