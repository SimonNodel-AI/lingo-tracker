import { translocoToICU } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import type { TerminologyFinding, TerminologyFindings } from '../config/project-terms';
import { readProjectTerms } from '../config/project-terms';
import { ResourceAlreadyExistsError } from '../errors/lingo-tracker-error';
import type { OpenTranslatorOptions } from '../translation/translator';
import { type AddResourceOptions, type AddResourceParams, resolveAddKey } from './add-resource';
import { seedLocales, withTranslatorProblems } from './locale-seeding';
import {
  assertAddable,
  commitAdd,
  type EntryAddChanges,
  type EntryAddResult,
  type ExistingResourcePolicy,
  validateAddChanges,
} from './resource-entry';
import { resolveResourcePaths } from './resource-file-paths';
import { type MutationSinkOptions, resolveMutationSink } from './resource-mutation';

interface ResolvedResourceAdd {
  readonly params: AddResourceParams;
  readonly resolvedKey: string;
}

interface PreparedResourceAdd {
  readonly resolvedKey: string;
  readonly changes: EntryAddChanges;
  readonly skippedLocales?: string[];
  readonly terminology: TerminologyFindings;
}

export interface AddResourcesResult {
  readonly entriesCreated: number;
  readonly created: boolean;
  readonly skippedLocales: string[];
  readonly terminology: TerminologyFindings;
}

/**
 * Resolves every item before translation, prepares every item before writing, then
 * writes in input order. Preflight refuses malformed keys and target-folder addresses,
 * unknown locales, duplicate resolved keys within the batch, unreadable folder JSON,
 * existing exact keys unless `onExisting` is `replace`, and translation failures.
 * Preflight reads folders but does not create them or check whether a later write can succeed.
 *
 * A filesystem failure during writing (for example, an existing regular file in a
 * folder path or insufficient permissions) can therefore occur after earlier items
 * were written. Every earlier completed item remains saved in both
 * JSON files. The failing item may have created its folder and may have written
 * `resource_entries.json` without `tracker_meta.json`. There is no rollback or result on
 * failure. Every earlier item's `upsert` was already delivered through `onMutation`;
 * the failing folder delivers a `reindex` if its save started.
 */
export async function addResources(
  collection: Collection,
  items: readonly AddResourceParams[],
  options: AddResourceOptions = {},
): Promise<AddResourcesResult> {
  const onExisting = options.onExisting ?? 'fail';
  const batchKeys = new Set<string>();
  const resolved: ResolvedResourceAdd[] = [];
  const prepared: PreparedResourceAdd[] = [];

  for (const item of items) {
    const key = resolveAddKey(item);
    // Preserve folder-policy refusal before locale/status diagnostics or folder reads.
    resolveResourcePaths({ key, translationsFolder: collection.translationsFolder });
    validateAddChanges(collection, item);
    assertAddable(collection, key, onExisting);
    const candidate = { params: item, resolvedKey: key };
    if (batchKeys.has(key)) throw new ResourceAlreadyExistsError(key);
    batchKeys.add(key);
    resolved.push(candidate);
  }
  for (const candidate of resolved) {
    prepared.push(await prepareEntryAdd(collection, candidate, options));
  }
  // No await separates this check from the write loop, so a late conflict writes nothing.
  for (const candidate of prepared) {
    assertAddable(collection, candidate.resolvedKey, onExisting);
  }

  let entriesCreated = 0;
  const skippedLocales = new Set<string>();
  const findings: TerminologyFinding[] = [];
  const problems = new Set<string>();
  for (const candidate of prepared) {
    const result = writePreparedAdd(collection, candidate, onExisting, options);
    if (result.created) entriesCreated++;
    for (const locale of result.skippedLocales ?? []) skippedLocales.add(locale);
    findings.push(...result.terminology.findings);
    for (const problem of result.terminology.problems) problems.add(problem);
  }

  return {
    entriesCreated,
    created: entriesCreated > 0,
    skippedLocales: [...skippedLocales],
    terminology: { findings, problems: [...problems] },
  };
}

async function prepareEntryAdd(
  collection: Collection,
  resolved: ResolvedResourceAdd,
  options: OpenTranslatorOptions,
): Promise<PreparedResourceAdd> {
  const { params, resolvedKey } = resolved;
  const supplied = (params.translations ?? []).filter(({ locale }) => locale !== collection.baseLocale);
  const baseValue = translocoToICU(params.baseValue);
  const seeding = await seedLocales(collection, { baseValue, supplied: supplied.map(({ locale }) => locale) }, options);
  return {
    resolvedKey,
    changes: { ...params, baseValue, translations: [...supplied, ...seeding.translations] },
    ...(seeding.skippedLocales !== undefined && { skippedLocales: seeding.skippedLocales }),
    terminology: withTranslatorProblems(
      readProjectTerms(collection).checkBaseValue(resolvedKey, baseValue),
      seeding.problems,
    ),
  };
}

function writePreparedAdd(
  collection: Collection,
  prepared: PreparedResourceAdd,
  onExisting: ExistingResourcePolicy,
  options: MutationSinkOptions,
): EntryAddResult {
  const committed = commitAdd(
    collection,
    prepared.resolvedKey,
    prepared.changes,
    onExisting,
    resolveMutationSink(collection, options),
  );
  return {
    ...committed,
    ...(prepared.skippedLocales !== undefined && { skippedLocales: prepared.skippedLocales }),
    terminology: prepared.terminology,
  };
}
