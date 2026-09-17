/**
 * Pure validation for bundle keys and bundle definitions.
 *
 * Every function returns the full list of problems found (never throws) so
 * callers can surface all messages at once, e.g. in a form.
 */

import type { BundleDefinition, CollectionBundleDefinition, EntrySelectionRule } from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { validateJavaScriptIdentifier } from './type-generation/key-transformer';

const BUNDLE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const VALID_TAG_OPERATORS: ReadonlySet<string> = new Set(['All', 'Any']);
const VALID_MERGE_STRATEGIES: ReadonlySet<string> = new Set(['merge', 'override']);

/**
 * Validates the key used to identify a bundle in `config.bundles`.
 * The key also seeds the generated TypeScript constant name, so it is limited
 * to letters, digits, hyphens and underscores.
 */
export function validateBundleKey(key: string): string[] {
  const errors: string[] = [];
  const trimmed = key?.trim() ?? '';

  if (trimmed.length === 0) {
    errors.push('Bundle name is required.');
    return errors;
  }

  if (!BUNDLE_KEY_PATTERN.test(trimmed)) {
    errors.push('Bundle name may only contain letters, numbers, hyphens and underscores.');
  }

  return errors;
}

/**
 * Validates a bundle definition against the current configuration.
 * Returns every applicable message; an empty array means the definition is valid.
 */
export function validateBundleDefinition(definition: BundleDefinition, config: LingoTrackerConfig): string[] {
  const errors: string[] = [];

  const bundleName = definition.bundleName?.trim() ?? '';
  if (bundleName.length === 0) {
    errors.push('bundleName is required.');
  } else if (!bundleName.includes('{locale}')) {
    errors.push('bundleName must include the {locale} placeholder so each locale gets its own file.');
  }

  if (!definition.dist || definition.dist.trim().length === 0) {
    errors.push('dist (output folder) is required.');
  }

  if (definition.collections !== 'All') {
    if (!Array.isArray(definition.collections) || definition.collections.length === 0) {
      errors.push("collections must be 'All' or a non-empty array of collection definitions.");
    } else {
      validateCollections(definition.collections, config, errors);
    }
  }

  if (definition.typeDistFile !== undefined && !definition.typeDistFile.endsWith('.ts')) {
    errors.push(`typeDistFile must end with a .ts extension, but got: ${definition.typeDistFile}`);
  }

  if (definition.tokenConstantName !== undefined) {
    const identifierError = validateJavaScriptIdentifier(definition.tokenConstantName);
    if (identifierError) {
      errors.push(`tokenConstantName is invalid: ${identifierError}`);
    }
  }

  return errors;
}

function validateCollections(
  collections: CollectionBundleDefinition[],
  config: LingoTrackerConfig,
  errors: string[],
): void {
  const seenPrefixes = new Map<string, Set<string | undefined>>();

  collections.forEach((collectionDef, index) => {
    const label = collectionDef.name ? `Collection '${collectionDef.name}'` : `Collection at index ${index}`;

    if (!collectionDef.name || collectionDef.name.trim().length === 0) {
      errors.push(`Collection at index ${index} is missing a name.`);
    } else if (!config.collections?.[collectionDef.name]) {
      errors.push(`${label} does not exist in the configuration.`);
    }

    const rules = collectionDef.entriesSelectionRules;
    if (rules !== 'All') {
      if (!Array.isArray(rules) || rules.length === 0) {
        errors.push(`${label}: entriesSelectionRules must be 'All' or a non-empty array of rules.`);
      } else {
        rules.forEach((rule, ruleIndex) => {
          validateRule(rule, ruleIndex, label, errors);
        });
      }
    }

    if (collectionDef.mergeStrategy !== undefined && !VALID_MERGE_STRATEGIES.has(collectionDef.mergeStrategy)) {
      errors.push(`${label}: mergeStrategy must be 'merge' or 'override', but got: ${collectionDef.mergeStrategy}`);
    }

    if (collectionDef.name) {
      const prefixes = seenPrefixes.get(collectionDef.name) ?? new Set<string | undefined>();
      const prefix = collectionDef.bundledKeyPrefix || undefined;
      if (prefixes.has(prefix)) {
        errors.push(
          prefix
            ? `${label} is included more than once with the same bundledKeyPrefix '${prefix}'.`
            : `${label} is included more than once without a bundledKeyPrefix.`,
        );
      }
      prefixes.add(prefix);
      seenPrefixes.set(collectionDef.name, prefixes);
    }
  });
}

function validateRule(rule: EntrySelectionRule, ruleIndex: number, label: string, errors: string[]): void {
  if (!rule.matchingPattern || rule.matchingPattern.trim().length === 0) {
    errors.push(`${label}: rule at index ${ruleIndex} is missing a matchingPattern.`);
  }

  if (rule.matchingTagOperator !== undefined && !VALID_TAG_OPERATORS.has(rule.matchingTagOperator)) {
    errors.push(
      `${label}: rule at index ${ruleIndex} has an invalid matchingTagOperator '${rule.matchingTagOperator}' (expected 'All' or 'Any').`,
    );
  }
}
