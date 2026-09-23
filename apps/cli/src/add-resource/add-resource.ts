import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import { addResource, createDefaultTranslations, openResourceFolder, resolveResourcePaths } from '@simoncodes-ca/core';
import { type TranslationStatus, translocoToICU } from '@simoncodes-ca/domain';
import prompts from 'prompts';
import {
  ConsoleFormatter,
  ErrorMessages,
  loadConfiguration,
  parseCommaSeparatedList,
  promptForCollection,
  resolveWritableCollection,
  warnAboutPreferredTerminology,
} from '../utils';

export interface AddResourceOptions {
  collection?: string;
  key?: string;
  value?: string;
  comment?: string;
  tags?: string;
  targetFolder?: string;
  translations?: Array<{
    locale: string;
    value: string;
    status: TranslationStatus;
  }>;
}

export async function addResourceCommand(options: AddResourceOptions): Promise<void> {
  const loaded = loadConfiguration({ exitOnError: false });
  if (!loaded) return;
  const { config, cwd } = loaded;

  const collectionName = await promptForCollection(config, options.collection);
  if (!collectionName) return;

  const collection = resolveWritableCollection(collectionName, config, cwd);
  if (!collection) return;

  const answers = await promptForMissing(options, config, collectionName);

  try {
    // Check if resource already exists
    const { resolvedKey, folderPath, entryKey } = resolveResourcePaths({
      key: answers.key,
      translationsFolder: collection.config.translationsFolder,
      targetFolder: answers.targetFolder || undefined,
      cwd,
    });
    const resourceExists = hasEntryKey(folderPath, entryKey);

    if (resourceExists) {
      if (process.stdout.isTTY) {
        // Interactive mode: prompt for confirmation
        const confirm = await prompts({
          type: 'confirm',
          name: 'value',
          message: `Resource "${resolvedKey}" already exists. Override?`,
          initial: false,
        });

        if (!confirm.value) {
          ConsoleFormatter.error(ErrorMessages.OPERATION_CANCELLED('Add resource'));
          return;
        }
      }
    }

    const tagsArray = parseCommaSeparatedList(answers.tags) || [];
    const baseLocale = collection.config.baseLocale || config.baseLocale;
    const locales = collection.config.locales || config.locales || [];
    const translationConfig = collection.config.translation ?? config.translation;

    // Build translations: use provided translations or create entries for all non-base locales with base value.
    // When auto-translation is configured, skip building default translations here — addResource will handle it.
    const translations =
      answers.translations && answers.translations.length > 0
        ? answers.translations
        : translationConfig?.enabled
          ? undefined
          : createDefaultTranslations(locales, baseLocale, answers.value);

    const result = await addResource(
      collection.translationsFolderPath,
      {
        key: answers.key,
        baseValue: answers.value,
        comment: answers.comment || undefined,
        tags: tagsArray.length > 0 ? tagsArray : undefined,
        targetFolder: answers.targetFolder || undefined,
        baseLocale,
        translations: translations && translations.length > 0 ? translations : undefined,
        allLocales: locales,
      },
      { cwd, translationConfig },
    );

    ConsoleFormatter.success(`Resource added: ${result.resolvedKey}`);
    if (result.created) {
      ConsoleFormatter.indent('(newly created)');
    }

    // Advisory: the value is stored either way. Checked against the stored
    // (ICU-normalized) form, which is what validate and the editor see.
    warnAboutPreferredTerminology(config, cwd, translocoToICU(answers.value));
  } catch (e: unknown) {
    ConsoleFormatter.error(e instanceof Error ? e.message : 'Failed to add resource');
  }
}

async function promptForMissing(
  options: AddResourceOptions,
  config: LingoTrackerConfig,
  collectionName: string,
): Promise<{
  key: string;
  value: string;
  comment: string;
  tags: string;
  targetFolder: string;
  translations?: Array<{
    locale: string;
    value: string;
    status: TranslationStatus;
  }>;
}> {
  const responses: Partial<{
    key: string;
    value: string;
    comment: string;
    tags: string;
    targetFolder: string;
    translations?: Array<{
      locale: string;
      value: string;
      status: TranslationStatus;
    }>;
  }> = {};

  const questions: prompts.PromptObject[] = [];

  if (!options.key) {
    questions.push({
      type: 'text',
      name: 'key',
      message: 'Resource key (dot-delimited, e.g., apps.common.buttons.ok)',
      validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
    });
  }

  if (!options.value) {
    questions.push({
      type: 'text',
      name: 'value',
      message: 'Base value (source text)',
      validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
    });
  }

  if (!options.comment) {
    questions.push({
      type: 'text',
      name: 'comment',
      message: 'Comment (optional, press enter to skip)',
    });
  }

  if (!options.tags) {
    questions.push({
      type: 'text',
      name: 'tags',
      message: 'Tags (optional, comma-separated)',
    });
  }

  if (!options.targetFolder) {
    questions.push({
      type: 'text',
      name: 'targetFolder',
      message: 'Target folder (optional, dot-delimited override)',
    });
  }

  if (questions.length > 0 && process.stdout.isTTY) {
    const result = await prompts(questions, {
      onCancel: () => {
        throw new Error('Add resource cancelled');
      },
    });
    Object.assign(responses, result);
  } else if (questions.length > 0) {
    if (!options.key) throw new Error(ErrorMessages.MISSING_OPTION('key'));
    if (!options.value) throw new Error(ErrorMessages.MISSING_OPTION('value'));
  }

  // Handle translations in interactive mode
  let translations: Array<{ locale: string; value: string; status: TranslationStatus }> | undefined;
  if (!options.translations && process.stdout.isTTY) {
    const collectionConfig = config.collections?.[collectionName];
    const baseLocale = collectionConfig?.baseLocale || config.baseLocale;
    const locales = collectionConfig?.locales || config.locales || [];

    const nonBaseLocales = locales.filter((locale) => locale !== baseLocale);

    if (nonBaseLocales.length > 0) {
      const shouldAddTranslations = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Add translations for other locales?',
        initial: false,
      });

      if (shouldAddTranslations.value) {
        translations = [];
        for (const locale of nonBaseLocales) {
          const translationPrompt = await prompts({
            type: 'text',
            name: 'value',
            message: `Translation for ${locale} (press enter to use base value)`,
          });

          const baseValue = options.value ?? (responses.value as string);
          const translationValue = translationPrompt.value || baseValue;

          const statusPrompt = await prompts({
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
            value: translationValue,
            status: statusPrompt.value as TranslationStatus,
          });
        }
      }
    }
  }

  return {
    key: options.key ?? (responses.key as string),
    value: options.value ?? (responses.value as string),
    comment: options.comment ?? (responses.comment as string) ?? '',
    tags: options.tags ?? (responses.tags as string) ?? '',
    targetFolder: options.targetFolder ?? (responses.targetFolder as string) ?? '',
    translations: options.translations || translations,
  };
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
