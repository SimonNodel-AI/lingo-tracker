import type { Collection } from '@simoncodes-ca/core';
import { addResource, openResourceFolder, resolveResourcePaths } from '@simoncodes-ca/core';
import { type TranslationStatus, translocoToICU } from '@simoncodes-ca/domain';
import type prompts from 'prompts';
import { type Ask, CommandCancelledError, defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, parseCommaSeparatedList, warnAboutPreferredTerminology } from '../utils';

interface TranslationInput {
  locale: string;
  value: string;
  status: TranslationStatus;
}

export interface AddResourceOptions {
  collection?: string;
  key?: string;
  value?: string;
  comment?: string;
  tags?: string;
  targetFolder?: string;
  /** Raw `--translations` JSON: an array of `{ locale, value, status }`. Parsed in `run`. */
  translations?: string;
}

const nonEmpty = (val: string) => (val && val.trim().length > 0 ? true : 'Required');

export const addResourceCommand = defineCommand<AddResourceOptions>()({
  name: 'Add resource',
  collection: 'writable',
  prompts: (options) => {
    const questions: prompts.PromptObject[] = [];
    if (!options.key) {
      questions.push({
        type: 'text',
        name: 'key',
        message: 'Resource key (dot-delimited, e.g., apps.common.buttons.ok)',
        validate: nonEmpty,
      });
    }
    if (!options.value) {
      questions.push({ type: 'text', name: 'value', message: 'Base value (source text)', validate: nonEmpty });
    }
    if (!options.comment) {
      questions.push({ type: 'text', name: 'comment', message: 'Comment (optional, press enter to skip)' });
    }
    if (!options.tags) {
      questions.push({ type: 'text', name: 'tags', message: 'Tags (optional, comma-separated)' });
    }
    if (!options.targetFolder) {
      questions.push({
        type: 'text',
        name: 'targetFolder',
        message: 'Target folder (optional, dot-delimited override)',
      });
    }
    return questions;
  },
  required: ['key', 'value'],
  run: async ({ collection, config, cwd, answers, interactive, ask }) => {
    const { key, value } = answers;
    const targetFolder = answers.targetFolder || undefined;

    const translations = answers.translations
      ? parseTranslations(answers.translations)
      : interactive
        ? await promptForTranslations(collection, value, ask)
        : undefined;

    const { resolvedKey, folderPath, entryKey } = resolveResourcePaths({
      key,
      translationsFolder: collection.translationsFolder,
      targetFolder,
    });

    // Interactive: an existing entry is only overwritten after confirmation.
    if (interactive && hasEntryKey(folderPath, entryKey)) {
      const confirm = await ask({
        type: 'confirm',
        name: 'value',
        message: `Resource "${resolvedKey}" already exists. Override?`,
        initial: false,
      });
      if (confirm.value !== true) {
        throw new CommandCancelledError();
      }
    }

    const tagsArray = parseCommaSeparatedList(answers.tags) ?? [];

    // Locales without a supplied translation are seeded by core (auto-translated or copied as `new`).
    const result = await addResource(collection, {
      key,
      baseValue: value,
      comment: answers.comment || undefined,
      tags: tagsArray.length > 0 ? tagsArray : undefined,
      targetFolder,
      translations,
    });

    ConsoleFormatter.success(`Resource added: ${result.resolvedKey}`);
    if (result.created) {
      ConsoleFormatter.indent('(newly created)');
    }

    // Advisory: the value is stored either way. Checked against the stored
    // (ICU-normalized) form, which is what validate and the editor see.
    warnAboutPreferredTerminology(config, cwd, translocoToICU(value));
  },
});

const STATUSES: readonly TranslationStatus[] = ['new', 'translated', 'stale', 'verified'];

/** Parses `--translations`; anything but an array of `{ locale, value, status }` fails with one message. */
function parseTranslations(raw: string): TranslationInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid --translations JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isTranslationList(parsed)) {
    throw new Error(
      'Invalid --translations: expected a JSON array of { "locale", "value", "status" } ' +
        `with status one of ${STATUSES.join(', ')}`,
    );
  }
  return parsed;
}

function isTranslationList(value: unknown): value is TranslationInput[] {
  return Array.isArray(value) && value.every(isTranslationInput);
}

function isTranslationInput(item: unknown): item is TranslationInput {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const { locale, value, status } = item as Record<string, unknown>;
  return typeof locale === 'string' && typeof value === 'string' && STATUSES.some((known) => known === status);
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

  const translations: TranslationInput[] = [];
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
      choices: [
        { title: 'new', value: 'new' },
        { title: 'translated', value: 'translated' },
        { title: 'verified', value: 'verified' },
      ],
      initial: 1, // Default to 'translated'
    });

    translations.push({
      locale,
      value:
        typeof translationPrompt.value === 'string' && translationPrompt.value ? translationPrompt.value : baseValue,
      status: statusPrompt.value as TranslationStatus,
    });
  }
  return translations;
}

/**
 * Checks if a resource entry already exists in a folder. Unreadable files count as "not found".
 */
function hasEntryKey(folderPath: string, entryKey: string): boolean {
  try {
    return openResourceFolder(folderPath).has(entryKey);
  } catch {
    return false;
  }
}
