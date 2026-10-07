import type { Collection } from '../config/open-collection';
import type { TerminologyFinding, TerminologyFindings } from '../config/project-terms';
import { ResourceAlreadyExistsError } from '../errors/lingo-tracker-error';
import type { AddResourceOptions, AddResourceParams } from './add-resource';
import { type AddPreflight, commitPrepared, type PreparedAdd, preflightAdd, prepareAdd } from './resource-entry';
import { resolveCheckedResourceKey } from './resource-key';
import { resolveMutationSink } from './resource-mutation';

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
  const resolved: AddPreflight[] = [];
  const prepared: PreparedAdd[] = [];

  for (const item of items) {
    const key = resolveCheckedResourceKey(item.key, item.targetFolder);
    const candidate = preflightAdd(collection, key, item, onExisting);
    if (batchKeys.has(key)) throw new ResourceAlreadyExistsError(key);
    batchKeys.add(key);
    resolved.push(candidate);
  }
  for (const candidate of resolved) {
    prepared.push(await prepareAdd(candidate, options));
  }
  // No await separates this check from the write loop, so a late conflict writes nothing.
  for (const candidate of prepared) {
    candidate.recheck();
  }

  let entriesCreated = 0;
  const skippedLocales = new Set<string>();
  const findings: TerminologyFinding[] = [];
  const problems = new Set<string>();
  for (const candidate of prepared) {
    const result = commitPrepared(candidate, resolveMutationSink(collection, options));
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
