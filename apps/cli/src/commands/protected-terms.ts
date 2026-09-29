import {
  displayTermPath,
  editProtectedTerms,
  loadConfig,
  readProtectedTermsTarget,
  setCollectionProtectedTermsFile,
  setGlobalProtectedTermsFile,
} from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface ProtectedTermsOptions {
  collection?: string;
  add?: string[];
  remove?: string[];
  set?: string;
  list?: boolean;
  /** Path to the protected terms file for this scope. An empty string clears the pointer. */
  file?: string;
}

export const protectedTermsCommand = defineCommand<ProtectedTermsOptions>()({
  name: 'Protected terms',
  // `--collection` is optional: absent means the global scope, so the runner opens nothing.
  collection: 'none',
  run: async ({ config, cwd, answers: options }) => {
    const hasAdd = (options.add ?? []).length > 0;
    const hasRemove = (options.remove ?? []).length > 0;
    const hasSet = options.set !== undefined;
    const hasList = options.list === true;
    const hasFile = options.file !== undefined;

    if (hasSet && (hasAdd || hasRemove)) {
      throw new Error('--set cannot be combined with --add or --remove');
    }
    if (!hasAdd && !hasRemove && !hasSet && !hasList && !hasFile) {
      throw new Error('Provide at least one of --add, --remove, --set, --list, or --file');
    }

    const collectionName = options.collection;
    const target = { collection: collectionName };

    // --file runs first so --file x.json --add Foo writes Foo into the new file.
    if (hasFile) {
      const pointer = options.file?.trim() || undefined;
      const change = collectionName
        ? setCollectionProtectedTermsFile(collectionName, pointer, { cwd })
        : setGlobalProtectedTermsFile(pointer, { cwd });
      ConsoleFormatter.success(change.message);
    }

    // Re-read only after a pointer change; otherwise use the config already loaded by the runner.
    const currentConfig = hasFile ? loadConfig({ cwd }) : config;
    const view = readProtectedTermsTarget(currentConfig, target, cwd);
    // A named file that does not exist reads as empty; print its warning before a later write can fail.
    for (const warning of view.warnings) ConsoleFormatter.warning(warning);

    if (hasList) {
      ConsoleFormatter.section('Protected Terms');
      if (collectionName) {
        ConsoleFormatter.keyValue('Scope', `Collection "${collectionName}" (global + collection)`);
        ConsoleFormatter.keyValue('Global file', displayTermPath(view.globalFilePath, cwd));
        ConsoleFormatter.keyValue('Global', view.globalTerms.join(', ') || '(none)');
        ConsoleFormatter.keyValue(
          'Collection file',
          view.collectionFilePath ? displayTermPath(view.collectionFilePath, cwd) : '(none)',
        );
        ConsoleFormatter.keyValue('Collection-specific', view.collectionTerms.join(', ') || '(none)');
        ConsoleFormatter.keyValue('Effective', view.effectiveTerms.join(', ') || '(none)');
      } else {
        ConsoleFormatter.keyValue('Scope', 'Global');
        ConsoleFormatter.keyValue('File', displayTermPath(view.globalFilePath, cwd));
        ConsoleFormatter.keyValue('Terms', view.globalTerms.join(', ') || '(none)');
      }
    }

    if (hasAdd || hasRemove || hasSet) {
      const result = editProtectedTerms(target, view, options, { cwd });
      const scopeLabel = collectionName ? `Collection "${collectionName}"` : 'Global';
      const where = `(${displayTermPath(result.filePath, cwd)})`;
      ConsoleFormatter.success(
        result.terms.length === 0
          ? `${scopeLabel} protected terms cleared ${where}`
          : `${scopeLabel} protected terms updated: ${result.terms.join(', ')} ${where}`,
      );
    }
  },
});
