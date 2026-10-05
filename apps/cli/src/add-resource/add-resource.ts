import type { AddResourceResult, Collection } from '@simoncodes-ca/core';
import { addResource, ResourceAlreadyExistsError } from '@simoncodes-ca/core';
import { parseTranslationInputs, TRANSLATION_STATUSES, type TranslationInput } from '@simoncodes-ca/domain';
import { type Ask, defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, confirmOrCancel, missingTextQuestions, printTerminologyFindings } from '../utils';

export interface AddResourceOptions {
  collection?: string;
  key?: string;
  value?: string;
  comment?: string;
  tags?: string[];
  targetFolder?: string;
  override?: boolean;
  /** Raw `--translations` JSON: an array of `{ locale, value, status }`. Parsed in `run`. */
  translations?: string;
}

export const addResourceCommand = defineCommand<AddResourceOptions>()({
  name: 'Add resource',
  collection: 'writable',
  commaListAnswers: ['tags'],
  prompts: (options) =>
    missingTextQuestions(options, [
      { name: 'key', message: 'Resource key (dot-delimited, e.g., apps.common.buttons.ok)', required: true },
      { name: 'value', message: 'Base value (source text)', required: true },
      { name: 'comment', message: 'Comment (optional, press enter to skip)' },
      { name: 'tags', message: 'Tags (optional, comma-separated)' },
      { name: 'targetFolder', message: 'Target folder (optional, dot-delimited override)' },
    ]),
  required: ['key', 'value'],
  run: async ({ collection, answers, interactive, ask }) => {
    const { key, value } = answers;
    const targetFolder = answers.targetFolder || undefined;

    const translations = answers.translations
      ? parseTranslations(answers.translations)
      : interactive
        ? await promptForTranslations(collection, value, ask)
        : undefined;

    const tagsArray = answers.tags ?? [];

    // Locales without a supplied translation are seeded by core (auto-translated or copied as `new`).
    const params = {
      key,
      baseValue: value,
      comment: answers.comment || undefined,
      tags: tagsArray.length > 0 ? tagsArray : undefined,
      targetFolder,
      translations,
    };
    let result: AddResourceResult;
    try {
      result = await addResource(collection, params, { onExisting: answers.override ? 'replace' : 'fail' });
    } catch (error) {
      if (!(error instanceof ResourceAlreadyExistsError) || answers.override) throw error;
      if (!interactive) {
        ConsoleFormatter.error(error.message, ['Use --override to replace it, or edit-resource to change it.']);
        return { exitCode: 1 };
      }
      await confirmOrCancel({
        ask,
        interactive,
        message: `Resource "${error.key}" already exists. Override?`,
      });
      result = await addResource(collection, params, { onExisting: 'replace' });
    }

    ConsoleFormatter.success(`Resource added: ${result.resolvedKey}`);
    if (result.created) {
      ConsoleFormatter.indent('(newly created)');
    }

    // Advisory: the value is stored either way (core checked the stored, ICU-normalized form).
    printTerminologyFindings(result.terminology);
  },
});

/** Parses `--translations`; each item needs a locale and value, with an optional status. */
function parseTranslations(raw: string): TranslationInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid --translations JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return checkedTranslations(parsed);
}

function checkedTranslations(raw: unknown): TranslationInput[] {
  const result = parseTranslationInputs(raw);
  if (result.success === false) {
    const location = result.index === null ? '' : `item ${result.index}: `;
    throw new Error(`Invalid --translations: ${location}${result.reason}`);
  }
  return result.translations;
}

/** Interactive only: offers a translation and a status for each target locale. */
async function promptForTranslations(
  collection: Collection,
  baseValue: string,
  ask: Ask,
): Promise<TranslationInput[] | undefined> {
  if (collection.targetLocales.length === 0) {
    return undefined;
  }

  const shouldAddTranslations = await ask({
    type: 'confirm',
    name: 'value',
    message: 'Add translations for other locales?',
    initial: false,
  });
  if (shouldAddTranslations.value !== true) {
    return undefined;
  }

  const translations: unknown[] = [];
  for (const locale of collection.targetLocales) {
    const translationPrompt = await ask({
      type: 'text',
      name: 'value',
      message: `Translation for ${locale} (press enter to use base value)`,
    });

    const statusPrompt = await ask({
      type: 'select',
      name: 'value',
      message: `Status for ${locale}`,
      choices: TRANSLATION_STATUSES.map((status) => ({ title: status, value: status })),
      initial: TRANSLATION_STATUSES.indexOf('translated'),
    });
    translations.push({
      locale,
      value:
        typeof translationPrompt.value === 'string' && translationPrompt.value ? translationPrompt.value : baseValue,
      status: statusPrompt.value,
    });
  }
  return checkedTranslations(translations);
}
