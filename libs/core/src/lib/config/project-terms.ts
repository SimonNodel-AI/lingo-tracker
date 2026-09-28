/**
 * Project Terms — the terms and rules in force for an opened collection: its protected terms
 * (the global file united with the collection's own) and the project's preferred terminology,
 * read from the paths `openCollection` resolved into `Collection.termFiles`.
 *
 * Reading never throws. A term file that is missing where the config names it, or that exists
 * but cannot be used, is a {@link TermFileProblem}; the lists read as if the file were empty.
 * Each consumer decides what a problem means for it: the Translator and an import refuse to run
 * unguarded on a broken protected-terms file ({@link requireProtectedTerms}); a write's
 * terminology check reports the problem next to its findings; export and validate warn.
 *
 * @module project-terms
 */

import { effectiveProtectedTerms, findPreferredTermFindings, type PreferredTermRule } from '@simoncodes-ca/domain';
import { ProtectedTermsFileError } from '../errors/lingo-tracker-error';
import type { Collection } from './open-collection';
import { readPreferredTerminologyFile } from './preferred-terminology-file';
import { readProtectedTermsFile } from './protected-terms-file';
import type { TermFileRead } from './term-file';

/** A term file that could not be used as configured. */
export interface TermFileProblem {
  readonly file: 'protected-terms' | 'preferred-terminology';
  /** `error`: the file exists but cannot be used. `warning`: the config names a file that does not exist. */
  readonly severity: 'error' | 'warning';
  readonly filePath: string;
  readonly message: string;
}

/** A discouraged term in a base value, with the rule that flagged it. */
export interface TerminologyFinding {
  /** The full key of the resource whose base value was checked. */
  readonly key: string;
  /** The discouraged term, as spelled in the rule. */
  readonly discouraged: string;
  /** The suggested replacement, as spelled in the rule. */
  readonly preferred: string;
  /** Why the preferred term is preferred, when the rule says. */
  readonly reason?: string;
  /** The suggestion as one line, e.g. `consider "Investment" instead of "Expenditure"`. */
  readonly message: string;
}

/** The advisory outcome of checking a written base value against the preferred terminology. */
export interface TerminologyFindings {
  /** One finding per rule the value breaks, however often the term occurs. */
  readonly findings: readonly TerminologyFinding[];
  /** Rule-file problems that limited the check, as messages ready to print (see {@link describeTermFileProblem}). */
  readonly problems: readonly string[];
}

export interface ProjectTerms {
  /** The protected terms in force: the global list united with the collection's own, normalized and deduped. */
  readonly protectedTerms: readonly string[];
  /** The preferred-terminology rules, in file order. */
  readonly preferredTerminology: readonly PreferredTermRule[];
  /** Every term file that could not be used as configured. */
  readonly problems: readonly TermFileProblem[];
  /**
   * Checks a base value stored under `key` against the preferred terminology. Advisory: the
   * value is stored either way. The rule-file problems ride along, so a caller that renders the
   * findings also tells the user when the check ran against no rules.
   */
  checkBaseValue(key: string, baseValue: string): TerminologyFindings;
}

/**
 * Reads the Project Terms of an opened collection. Reads every file once; nothing is cached, so
 * a long-lived process sees a hand edit or `git pull` on its next operation.
 */
export function readProjectTerms(collection: Pick<Collection, 'termFiles'>): ProjectTerms {
  const { termFiles } = collection;
  const global = readProtectedTermsFile(termFiles.protectedTerms);
  const own = termFiles.collectionProtectedTerms && readProtectedTermsFile(termFiles.collectionProtectedTerms);
  const preferred = readPreferredTerminologyFile(termFiles.preferredTerminology);

  const problems = [
    ...problemsOf('protected-terms', global),
    ...(own ? problemsOf('protected-terms', own) : []),
    ...problemsOf('preferred-terminology', preferred),
  ];
  const preferredTerminology = preferred.value;
  const terminologyProblems = problems
    .filter((problem) => problem.file === 'preferred-terminology')
    .map(describeTermFileProblem);

  return {
    protectedTerms: effectiveProtectedTerms(global.value, own?.value),
    preferredTerminology,
    problems,
    checkBaseValue: (key, baseValue) => ({
      findings: findPreferredTermFindings(baseValue, preferredTerminology).map(({ rule }) => ({
        key,
        discouraged: rule.discouraged,
        preferred: rule.preferred,
        ...(rule.reason ? { reason: rule.reason } : {}),
        message: describePreferredTermRule(rule),
      })),
      problems: terminologyProblems,
    }),
  };
}

/**
 * The protected terms, for a consumer that guards values with them and has no advisory channel.
 *
 * @throws {ProtectedTermsFileError} A protected-terms file exists but is not a JSON array of
 *   strings. Running with an empty list would let altered brand names through unnoticed.
 */
export function requireProtectedTerms(terms: ProjectTerms): readonly string[] {
  const broken = terms.problems.find((problem) => problem.file === 'protected-terms' && problem.severity === 'error');
  if (broken) {
    throw new ProtectedTermsFileError(broken.filePath, broken.message);
  }
  return terms.protectedTerms;
}

/**
 * A problem as one printable line. A broken file says the check it disabled was skipped
 * (`Preferred terminology checks skipped: <why>`); a missing named file is its own message.
 */
export function describeTermFileProblem(problem: TermFileProblem): string {
  if (problem.severity === 'warning') {
    return problem.message;
  }
  const check = problem.file === 'protected-terms' ? 'Protected terms checks' : 'Preferred terminology checks';
  return `${check} skipped: ${problem.message}`;
}

/**
 * The suggestion as one line, e.g. `consider "Investment" instead of "Expenditure"`.
 * Every surface (add, edit, import, validate, the API) words it the same way.
 */
export function describePreferredTermRule(rule: PreferredTermRule): string {
  return `consider "${rule.preferred}" instead of "${rule.discouraged}"`;
}

function problemsOf(file: TermFileProblem['file'], read: TermFileRead<unknown>): TermFileProblem[] {
  if (read.error !== undefined) {
    return [{ file, severity: 'error', filePath: read.filePath, message: read.error }];
  }
  if (read.warning !== undefined) {
    return [{ file, severity: 'warning', filePath: read.filePath, message: read.warning }];
  }
  return [];
}
