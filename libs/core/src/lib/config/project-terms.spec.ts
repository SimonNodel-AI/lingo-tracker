import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerCollection } from '../../config/lingo-tracker-collection';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { ProtectedTermsFileError } from '../errors/lingo-tracker-error';
import { type Collection, openCollection } from './open-collection';
import { DEFAULT_PREFERRED_TERMINOLOGY_FILENAME } from './preferred-terminology-file';
import { DEFAULT_PROTECTED_TERMS_FILENAME } from './protected-terms-file';
import { describeTermFileProblem, readProjectTerms, requireProtectedTerms } from './project-terms';

const rules = [
  { discouraged: 'Expenditure', preferred: 'Investment', reason: 'Finance style guide' },
  { discouraged: 'e-mail', preferred: 'email' },
];

describe('Project Terms', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'lingo-project-terms-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const write = (relativePath: string, contents: unknown): string => {
    const filePath = join(cwd, relativePath);
    writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
    return filePath;
  };

  const open = (
    overrides: Partial<LingoTrackerConfig> = {},
    collection: LingoTrackerCollection = { translationsFolder: 'i18n' },
  ): Collection =>
    openCollection(
      {
        exportFolder: 'dist',
        importFolder: 'import',
        baseLocale: 'en',
        locales: ['en', 'fr'],
        collections: { app: collection },
        ...overrides,
      },
      'app',
      { cwd },
    );

  it('reads empty lists and no problems when no file exists', () => {
    const terms = readProjectTerms(open());

    expect(terms.protectedTerms).toEqual([]);
    expect(terms.preferredTerminology).toEqual([]);
    expect(terms.problems).toEqual([]);
  });

  it("unites the global protected terms with the collection's own, deduped", () => {
    write('global.json', ['SimonCodes', 'iPhone']);
    write('own.json', ['iPhone', 'Node.js']);
    write(DEFAULT_PREFERRED_TERMINOLOGY_FILENAME, rules);

    const terms = readProjectTerms(
      open({ protectedTermsFile: 'global.json' }, { translationsFolder: 'i18n', protectedTermsFile: 'own.json' }),
    );

    expect(terms.protectedTerms).toEqual(['SimonCodes', 'iPhone', 'Node.js']);
    expect(terms.preferredTerminology).toEqual(rules);
    expect(terms.problems).toEqual([]);
  });

  it('reports each named file that does not exist as a warning', () => {
    const terms = readProjectTerms(
      open(
        { protectedTermsFile: 'global.json', preferredTerminologyFile: 'rules.json' },
        { translationsFolder: 'i18n', protectedTermsFile: 'own.json' },
      ),
    );

    expect(terms.problems).toEqual([
      {
        file: 'protected-terms',
        severity: 'warning',
        filePath: join(cwd, 'global.json'),
        message: `Protected terms file not found: ${join(cwd, 'global.json')}. Treating as an empty list.`,
      },
      {
        file: 'protected-terms',
        severity: 'warning',
        filePath: join(cwd, 'own.json'),
        message: `Protected terms file not found: ${join(cwd, 'own.json')}. Treating as an empty list.`,
      },
      {
        file: 'preferred-terminology',
        severity: 'warning',
        filePath: join(cwd, 'rules.json'),
        message: `Preferred terminology file not found: ${join(cwd, 'rules.json')}. Treating as an empty list.`,
      },
    ]);
    expect(describeTermFileProblem(terms.problems[2])).toBe(
      `Preferred terminology file not found: ${join(cwd, 'rules.json')}. Treating as an empty list.`,
    );
  });

  it('reports a broken file as an error, reads it as empty, and describes the skipped check', () => {
    const protectedPath = write(DEFAULT_PROTECTED_TERMS_FILENAME, '["iPhone",');
    const rulesPath = write(DEFAULT_PREFERRED_TERMINOLOGY_FILENAME, '{ "rules": [] }');

    const terms = readProjectTerms(open());

    expect(terms.protectedTerms).toEqual([]);
    expect(terms.preferredTerminology).toEqual([]);
    expect(terms.problems).toEqual([
      expect.objectContaining({ file: 'protected-terms', severity: 'error', filePath: protectedPath }),
      expect.objectContaining({ file: 'preferred-terminology', severity: 'error', filePath: rulesPath }),
    ]);
    expect(describeTermFileProblem(terms.problems[0])).toBe(
      `Protected terms checks skipped: Protected terms file is not valid JSON: ${protectedPath} (${jsonError('["iPhone",')})`,
    );
    expect(describeTermFileProblem(terms.problems[1])).toBe(
      `Preferred terminology checks skipped: Preferred terminology file must contain a JSON array of rules: ${rulesPath}`,
    );
  });

  it('reads the files again on every call, so an edit on disk is seen at once', () => {
    write(DEFAULT_PROTECTED_TERMS_FILENAME, ['iPhone']);
    const collection = open();
    expect(readProjectTerms(collection).protectedTerms).toEqual(['iPhone']);

    write(DEFAULT_PROTECTED_TERMS_FILENAME, ['Android', 'Pixel']);

    expect(readProjectTerms(collection).protectedTerms).toEqual(['Android', 'Pixel']);
  });

  describe('checkBaseValue', () => {
    it('returns one finding per rule the value breaks, under the key, with the rule-file problems', () => {
      write(DEFAULT_PREFERRED_TERMINOLOGY_FILENAME, rules);

      const result = readProjectTerms(open()).checkBaseValue(
        'budget.title',
        'Expenditure and more expenditure, by e-mail',
      );

      expect(result).toEqual({
        findings: [
          {
            key: 'budget.title',
            discouraged: 'Expenditure',
            preferred: 'Investment',
            reason: 'Finance style guide',
            message: 'consider "Investment" instead of "Expenditure"',
          },
          {
            key: 'budget.title',
            discouraged: 'e-mail',
            preferred: 'email',
            message: 'consider "email" instead of "e-mail"',
          },
        ],
        problems: [],
      });
    });

    it('returns no findings and the described problem when the rule file is broken', () => {
      const rulesPath = write(DEFAULT_PREFERRED_TERMINOLOGY_FILENAME, 'not json');
      write(DEFAULT_PROTECTED_TERMS_FILENAME, '["broken",');

      const result = readProjectTerms(open()).checkBaseValue('budget.title', 'Expenditure');

      expect(result.findings).toEqual([]);
      // Only the rule file limits this check; the protected-terms problem belongs to other consumers.
      expect(result.problems).toEqual([
        `Preferred terminology checks skipped: Preferred terminology file is not valid JSON: ${rulesPath} (${jsonError('not json')})`,
      ]);
    });
  });

  describe('requireProtectedTerms', () => {
    it('returns the terms when every protected-terms file is usable, missing named files included', () => {
      write(DEFAULT_PROTECTED_TERMS_FILENAME, ['iPhone']);
      write(DEFAULT_PREFERRED_TERMINOLOGY_FILENAME, 'not json');
      const terms = readProjectTerms(open({}, { translationsFolder: 'i18n', protectedTermsFile: 'absent.json' }));

      expect(requireProtectedTerms(terms)).toEqual(['iPhone']);
    });

    it('throws ProtectedTermsFileError, naming the file, when a protected-terms file is broken', () => {
      const filePath = write(DEFAULT_PROTECTED_TERMS_FILENAME, '["iPhone", 42]');

      expect(() => requireProtectedTerms(readProjectTerms(open()))).toThrow(
        expect.objectContaining({ code: 'INVALID_PROTECTED_TERMS_FILE', filePath }),
      );
      expect(() => requireProtectedTerms(readProjectTerms(open()))).toThrow(ProtectedTermsFileError);
    });
  });
});

/** Node's own message for the malformed JSON, so the assertion does not depend on the engine's wording. */
function jsonError(text: string): string {
  try {
    JSON.parse(text);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
