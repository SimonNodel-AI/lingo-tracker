import { resolveAllReferences } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { applyICUAutoFixToResources } from './apply-icu-auto-fix';
import { openImportSession, sessionResult } from './import-session';
import { validateImportResources } from './import-validation';
import { loadBaseLocaleValues } from './load-base-locale-values';
import { normalizeTranslocoSyntaxInResources } from './normalize-transloco-syntax';
import { processResourceGroup } from './process-resource-group';
import { groupResourcesByFolder } from './resource-grouping';
import type { ImportedResource, ImportResult, ImportRunOptions } from './types';

/**
 * Imports resources into a collection for one locale, and reports what changed.
 *
 * The resources come from a format adapter (`parseJsonImport`, `parseXliffImport`) or any other
 * source. The run:
 * 1. Applies the strategy defaults, and refuses a base-locale import unless the strategy is `migration`.
 * 2. Resolves Transloco references (`{{t('key')}}`, `{{key}}`) between the resources (`migration` only).
 * 3. Converts Transloco `{{ name }}` placeholders to ICU `{name}`.
 * 4. Repairs placeholders that differ from the stored base value (ICU auto-fix).
 * 5. Drops invalid resources: bad keys, hierarchical conflicts, empty values. Duplicate keys warn.
 * 6. Applies the resources one folder at a time, with the strategy's rules for creation,
 *    status, comments, tags, protected terms, and preferred terminology.
 *
 * Nothing is written in a dry run; the result says what would change.
 *
 * @throws {Error} The locale is the collection's base locale and the strategy is not `migration`.
 */
export function importResources(
  collection: Collection,
  resources: readonly ImportedResource[],
  options: ImportRunOptions,
): ImportResult {
  const session = openImportSession(collection, options);
  const { strategy, dryRun, verbose, onProgress } = session.options;
  const { translationsFolder } = collection;

  let prepared = [...resources];
  if (strategy === 'migration') {
    onProgress?.('Resolving Transloco-style references...');
    prepared = resolveAllReferences(prepared, true, session.warnings);
  }

  // Before any ICU parsing or auto-fixing, so later steps see one placeholder syntax.
  prepared = normalizeTranslocoSyntaxInResources(prepared);

  if (verbose) onProgress?.('Checking for ICU placeholder issues...');
  const baseValues = loadBaseLocaleValues(prepared, translationsFolder);
  const autoFix = applyICUAutoFixToResources({
    resources: prepared,
    getBaseValue: (key) => baseValues.get(key),
    verbose,
    onProgress: verbose ? onProgress : undefined,
  });
  session.icuAutoFixes.push(...autoFix.autoFixes);
  session.icuAutoFixErrors.push(...autoFix.autoFixErrors);

  const validation = validateImportResources(autoFix.resources, { skipEmptyValues: true, warnOnLongKeys: true });
  session.warnings.push(...validation.warnings);
  session.errors.push(...validation.errors);
  session.changes.push(...validation.failedChanges);

  for (const group of groupResourcesByFolder(validation.validResources, translationsFolder).values()) {
    if (verbose) {
      for (const { resource } of group.resources) onProgress?.(`Processing: ${resource.key}`);
    }
    processResourceGroup(session, group);
  }

  const result = sessionResult(session);
  onProgress?.(
    dryRun
      ? `Dry run complete: would import ${result.resourcesUpdated} resources`
      : `Import complete: ${result.resourcesUpdated} resources imported`,
  );
  return result;
}
