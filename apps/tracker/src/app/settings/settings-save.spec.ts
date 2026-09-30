import { describe, expect, it } from 'vitest';
import { ApiError } from '../shared/api-error/api-error';
import { PreferredTerminologyDraft } from './preferred-terminology-draft';
import { ProtectedTermsDraft } from '../shared/protected-terms/protected-terms-draft';
import { assembleSettingsPayload, extractRuleErrors, isPreferredTermRuleErrorDto } from './settings-save';

describe('settings save helpers', () => {
  it('includes only changed lists and records submitted rule indexes', () => {
    const terms = new ProtectedTermsDraft();
    terms.seed(['iPhone']);
    const terminology = new PreferredTerminologyDraft();
    terminology.seed([{ discouraged: 'E-mail', preferred: 'email' }]);
    expect(assembleSettingsPayload(terms, terminology)).toEqual({});
    terms.addValue('C++');
    expect(assembleSettingsPayload(terms, terminology)).toEqual({ protectedTerms: ['C++', 'iPhone'] });
    const row = terminology.rows()[0];
    expect(row).toBeDefined();
    if (!row) return;
    terminology.updateField(row.id, 'preferred', 'Email');
    expect(assembleSettingsPayload(terms, terminology)).toEqual({
      protectedTerms: ['C++', 'iPhone'],
      preferredTerminology: [{ discouraged: 'E-mail', preferred: 'Email' }],
    });
    terminology.applyServerErrors([{ index: 0, field: 'preferred', code: 'self-mapping', message: 'invalid' }]);
    expect(terminology.rowViews()[0]?.errors.preferred?.code).toBe('self-mapping');
  });

  it('accepts only shaped rule errors from invalid API details', () => {
    const valid = { index: 0, field: 'preferred', code: 'self-mapping', message: 'invalid' };
    expect(isPreferredTermRuleErrorDto(valid)).toBe(true);
    expect(isPreferredTermRuleErrorDto({ index: 0, field: 'preferred' })).toBe(false);
    expect(
      extractRuleErrors(
        new ApiError({ kind: 'invalid', status: 400, details: [valid, 'bad', { ...valid, index: '0' }] }),
      ),
    ).toEqual([valid]);
  });

  it('ignores details of other refusals and non-API errors', () => {
    const details = [{ index: 0, field: 'preferred', code: 'empty', message: 'invalid' }];
    expect(extractRuleErrors(new ApiError({ kind: 'conflict', status: 409, details }))).toEqual([]);
    expect(extractRuleErrors(new Error('offline'))).toEqual([]);
  });
});
