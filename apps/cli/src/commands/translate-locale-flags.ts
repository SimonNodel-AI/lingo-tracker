import type { PromptContext } from '../runner/command-runner';
import type { TranslateLocaleOptions } from './translate-locale';
import { defineFlags, collectionFlag, localeFlag } from '../runner/flag-record';

export const TRANSLATE_LOCALE_FLAGS = defineFlags<TranslateLocaleOptions, PromptContext<'writable'>>()({
  collection: collectionFlag('Collection name'),
  locale: {
    ...localeFlag('Target locale to translate'),
    prompt: (options, { collection }) =>
      options.locale
        ? []
        : [
            {
              type: 'select',
              name: 'locale',
              message: 'Select target locale to translate',
              choices: collection.targetLocales.map((locale) => ({ title: locale, value: locale })),
            },
          ],
  },
  verbose: { flags: '--verbose', description: 'Show per-batch progress' },
});

export const TRANSLATE_LOCALE_REGISTRATION = {
  name: 'translate-locale',
  description: 'Auto-translate all new/stale resources for a target locale',
  flags: TRANSLATE_LOCALE_FLAGS,
};
