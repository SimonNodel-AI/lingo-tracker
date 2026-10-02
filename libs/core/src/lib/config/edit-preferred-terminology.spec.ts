import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { editPreferredTerminology } from './preferred-terminology-file';
import { PreferredTerminologyValidationError } from '../errors/lingo-tracker-error';

const config = {};

describe('editPreferredTerminology', () => {
  const tempDir = useTempDir('preferred-edit-');
  const filePath = () => join(tempDir(), '.lingo-tracker-preferred-terminology.json');
  const seed = (rules: unknown) => writeFileSync(filePath(), `${JSON.stringify(rules)}\n`);
  const stored = () => JSON.parse(readFileSync(filePath(), 'utf8'));

  it('adds a trimmed rule and writes the sorted file', () => {
    seed([{ discouraged: 'Zoo', preferred: 'Park' }]);
    const result = editPreferredTerminology(
      config,
      { upsert: { discouraged: ' Expenditure ', preferred: ' Investment ' } },
      tempDir(),
    );
    expect(result.action).toBe('added');
    expect(result.changedRule).toEqual({ discouraged: 'Expenditure', preferred: 'Investment' });
    expect(stored()).toEqual([
      { discouraged: 'Expenditure', preferred: 'Investment' },
      { discouraged: 'Zoo', preferred: 'Park' },
    ]);
  });

  it('upserts case insensitively and drops an old reason when omitted', () => {
    seed([{ discouraged: 'Email', preferred: 'Mail', reason: 'old' }]);
    const result = editPreferredTerminology(
      config,
      { upsert: { discouraged: 'email', preferred: 'electronic mail' } },
      tempDir(),
    );
    expect(result.action).toBe('updated');
    expect(stored()).toEqual([{ discouraged: 'email', preferred: 'electronic mail' }]);
  });

  it('removes a rule case insensitively', () => {
    seed([{ discouraged: 'Email', preferred: 'Inbox' }]);
    const result = editPreferredTerminology(config, { remove: ' EMAIL ' }, tempDir());
    expect(result.action).toBe('removed');
    expect(stored()).toEqual([]);
  });

  it('reports a missing rule with the file path and leaves the file unchanged', () => {
    seed([{ discouraged: 'Email', preferred: 'Inbox' }]);
    const before = readFileSync(filePath(), 'utf8');
    expect(() => editPreferredTerminology(config, { remove: 'Missing' }, tempDir())).toThrow(
      'No preferred terminology rule for "Missing"',
    );
    expect(readFileSync(filePath(), 'utf8')).toBe(before);
  });

  it('returns row errors and leaves the file unchanged for an invalid upsert', () => {
    seed([{ discouraged: 'Email', preferred: 'Inbox' }]);
    const before = readFileSync(filePath(), 'utf8');
    let thrown: unknown;
    try {
      editPreferredTerminology(config, { upsert: { discouraged: 'Expenditure', preferred: '' } }, tempDir());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreferredTerminologyValidationError);
    const validation = thrown as PreferredTerminologyValidationError;
    expect(validation.errors).toEqual([expect.objectContaining({ index: 1, field: 'preferred', code: 'empty' })]);
    expect(validation.submittedRules?.[1]?.discouraged).toBe('Expenditure');
    expect(readFileSync(filePath(), 'utf8')).toBe(before);
  });

  it('sets the list without reading a malformed old file', () => {
    writeFileSync(filePath(), '{broken');
    const result = editPreferredTerminology(
      config,
      { set: [{ discouraged: 'Expenditure', preferred: 'Investment' }] },
      tempDir(),
    );
    expect(result.rules).toEqual([{ discouraged: 'Expenditure', preferred: 'Investment' }]);
    expect(result.error).toBeUndefined();
    expect(stored()).toEqual(result.rules);
  });

  it('validates a replacement before creating a file', () => {
    expect(() =>
      editPreferredTerminology(config, { set: [{ discouraged: 'Email', preferred: 'email' }] }, tempDir()),
    ).toThrow(PreferredTerminologyValidationError);
    expect(existsSync(filePath())).toBe(false);
  });

  it('rejects a non-array replacement before creating a file', () => {
    expect(() => editPreferredTerminology(config, { set: { discouraged: 'Email' } } as never, tempDir())).toThrow(
      'Preferred terminology replacement must be an array of rules',
    );
    expect(existsSync(filePath())).toBe(false);
  });

  it('reports invalid replacement rows before a malformed file pointer', () => {
    expect(() =>
      editPreferredTerminology(
        { preferredTerminologyFile: 42 as never },
        { set: [{ discouraged: 'Email', preferred: 'email' }] },
        tempDir(),
      ),
    ).toThrow(PreferredTerminologyValidationError);
  });
});
