import type { Collection } from '../config/open-collection';
import type { TerminologyFinding, TerminologyFindings } from '../config/project-terms';
import { ResourceAlreadyExistsError } from '../errors/lingo-tracker-error';
import type { OpenTranslatorOptions } from '../translation/translator';
import {
  type AddResourceParams,
  type PreparedResourceAdd,
  prepareResourceAdd,
  writePreparedResourceAdd,
} from './add-resource';
import { assertCollectionLocales } from './locale-seeding';
import { validateAndResolvePaths } from './resource-file-paths';
import { openResourceFolder } from './resource-folder';
import type { ResourceMutation } from './resource-mutation';

export interface AddResourcesResult {
  readonly entriesCreated: number;
  readonly created: boolean;
  readonly skippedLocales: string[];
  readonly terminology: TerminologyFindings;
  readonly mutations: ResourceMutation[];
}

/**
 * Prepares every item before writing any entry, then writes in input order. Preflight
 * refuses malformed keys and target-folder addresses, unknown locales, duplicate
 * resolved keys within the batch, unreadable folder JSON, and translation failures.
 * An existing exact key is replaced, as with `addResource`. Preflight reads folders
 * but does not create them or check whether the eventual write is possible.
 *
 * A filesystem failure during writing (for example, an existing regular file in a
 * folder path or insufficient permissions) can therefore occur after earlier items
 * were written. Every earlier completed item remains saved in both
 * JSON files. The failing item may have created its folder and may have written
 * `resource_entries.json` without `tracker_meta.json`. There is no rollback and no
 * result or mutations are returned on that failure. The Collection Index receives no
 * mutations for those writes and catches up through disk-fingerprint revalidation.
 */
export async function addResources(
  collection: Collection,
  items: readonly AddResourceParams[],
  options: OpenTranslatorOptions = {},
): Promise<AddResourcesResult> {
  const batchKeys = new Set<string>();
  const prepared: PreparedResourceAdd[] = [];

  for (const item of items) {
    const paths = validateAndResolvePaths({
      key: item.key,
      targetFolder: item.targetFolder,
      translationsFolder: collection.translationsFolder,
    });
    assertCollectionLocales(
      collection,
      (item.translations ?? []).map(({ locale }) => locale),
    );
    const key = paths.resolvedKey;
    if (batchKeys.has(key)) throw new ResourceAlreadyExistsError(key);
    // Read existing JSON before writing; folder creation and writability are checked during the write.
    openResourceFolder(paths.folderPath, { baseLocale: collection.baseLocale });
    const candidate = await prepareResourceAdd(collection, item, options);
    batchKeys.add(key);
    prepared.push(candidate);
  }

  let entriesCreated = 0;
  const skippedLocales = new Set<string>();
  const findings: TerminologyFinding[] = [];
  const problems = new Set<string>();
  const mutations: ResourceMutation[] = [];
  for (const candidate of prepared) {
    const result = writePreparedResourceAdd(collection, candidate);
    if (result.created) entriesCreated++;
    for (const locale of result.skippedLocales ?? []) skippedLocales.add(locale);
    findings.push(...result.terminology.findings);
    for (const problem of result.terminology.problems) problems.add(problem);
    mutations.push(...result.mutations);
  }

  return {
    entriesCreated,
    created: entriesCreated > 0,
    skippedLocales: [...skippedLocales],
    terminology: { findings, problems: [...problems] },
    mutations,
  };
}
