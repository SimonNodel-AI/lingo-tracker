import { basename } from 'node:path';
import { effectiveProtectedTerms } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CollectionNotFoundError, ProtectedTermsFileError } from '../errors/lingo-tracker-error';
import type { OpenedProject } from './open-collection';
import { loadPreferredTerminology, type LoadPreferredTerminologyResult } from './preferred-terminology-file';
import {
  requireProtectedTermsFile,
  resolveCollectionProtectedTermsFilePath,
  resolveGlobalProtectedTermsFile,
  type ResolvedProtectedTerms,
} from './protected-terms-file';
import type { ProtectedTermsView } from './set-protected-terms';
import type { TermFileProblem } from './project-terms';

/** The project config and all term scopes, read for one API response or CLI preview. */
export interface ProjectTermsView {
  readonly config: LingoTrackerConfig;
  readonly projectName: string;
  readonly protectedTerms: ResolvedProtectedTerms;
  readonly preferredTerminology: LoadPreferredTerminologyResult;
  readonly problems: readonly TermFileProblem[];
}

/** Reads each configured scope without throwing for malformed term files or caching across requests. */
export function readProjectTermsView(project: OpenedProject): ProjectTermsView {
  const { sourceConfig: config, projectRoot: cwd } = project;
  const problems: TermFileProblem[] = [];
  const read = (path: string, explicit: boolean) => {
    try {
      const result = requireProtectedTermsFile({ path, explicit });
      if (result.warning !== undefined) {
        problems.push({ file: 'protected-terms', severity: 'warning', filePath: path, message: result.warning });
      }
      return result.terms;
    } catch (error) {
      if (!(error instanceof ProtectedTermsFileError)) throw error;
      problems.push({ file: 'protected-terms', severity: 'error', filePath: error.filePath, message: error.message });
      return [];
    }
  };
  const collections: ResolvedProtectedTerms['collections'] = {};
  // Keep the prior API refusal order: collection files before the global file.
  for (const [name, collection] of Object.entries(config.collections)) {
    const filePath = resolveCollectionProtectedTermsFilePath(collection, cwd);
    collections[name] = { terms: filePath === undefined ? [] : read(filePath, true), filePath };
  }
  const globalFile = resolveGlobalProtectedTermsFile(config, cwd);
  const globalTerms = read(globalFile.path, globalFile.explicit);
  const preferredTerminology = loadPreferredTerminology(config, cwd);
  const { error, warning, filePath } = preferredTerminology;
  if (error !== undefined)
    problems.push({ file: 'preferred-terminology', severity: 'error', filePath, message: error });
  else if (warning !== undefined)
    problems.push({ file: 'preferred-terminology', severity: 'warning', filePath, message: warning });
  return {
    config,
    projectName: basename(cwd),
    protectedTerms: { globalTerms, globalFilePath: globalFile.path, collections },
    preferredTerminology,
    problems,
  };
}

/** Select a CLI scope from the snapshot; unrelated malformed files do not block it. */
export function protectedTermsTargetView(
  snapshot: ProjectTermsView,
  target: { readonly collection?: string },
): ProtectedTermsView {
  const { protectedTerms: resolved } = snapshot;
  const name = target.collection;
  if (name && snapshot.config.collections[name] === undefined) throw new CollectionNotFoundError(name);
  const own = name ? resolved.collections[name] : undefined;
  const paths = [resolved.globalFilePath, own?.filePath];
  const problems = snapshot.problems.filter(
    (problem) => problem.file === 'protected-terms' && paths.includes(problem.filePath),
  );
  // The CLI previously read global before collection terms.
  for (const path of paths) {
    const broken = problems.find((problem) => problem.filePath === path && problem.severity === 'error');
    if (broken !== undefined) throw new ProtectedTermsFileError(broken.filePath, broken.message);
  }
  const collectionTerms = own?.terms ?? [];
  return {
    globalTerms: resolved.globalTerms,
    collectionTerms,
    globalFilePath: resolved.globalFilePath,
    collectionFilePath: own?.filePath,
    effectiveTerms: effectiveProtectedTerms(resolved.globalTerms, collectionTerms),
    storedTerms: [...(name ? collectionTerms : resolved.globalTerms)],
    warnings: [
      ...new Set(
        paths.flatMap((path) =>
          problems
            .filter((problem) => problem.filePath === path && problem.severity === 'warning')
            .map((problem) => problem.message),
        ),
      ),
    ],
  };
}
