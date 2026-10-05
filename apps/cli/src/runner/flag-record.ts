import { type Command, Option } from 'commander';
import type prompts from 'prompts';
import { choiceOption, commaListOption, option, repeatableListOption, type OptionSpec } from './options';

/** A flag or positional value, including the conversion applied at the Commander boundary. */
type FlagFields = Omit<OptionSpec<unknown>, 'parse'> & {
  readonly negative?: { readonly flags: string; readonly description: string };
  /** Applied after parsing; unlike defaultValue, this does not change help. */
  readonly runtimeDefault?: unknown;
  /** Command fallback for an optional-value flag present without its value. */
  readonly implicitValue?: string;
};

export type FlagRecord =
  | (FlagFields &
      (
        | {
            readonly list: 'optional' | 'clear' | 'preserve' | 'repeatable';
            readonly choices?: never;
            readonly parse?: never;
          }
        | { readonly choices: readonly string[]; readonly list?: never; readonly parse?: never }
        | { readonly list?: never; readonly choices?: never; readonly parse?: (value: string) => unknown }
      ))
  | { readonly argument: readonly [name: string, description: string] };

/** Every Options key has exactly one record. Object literals reject extra keys as well. */
export type FlagRecords<Options, Context = never> = {
  readonly [Key in keyof Required<Options>]: FlagRecord & {
    readonly prompt?: (options: Options, context: Context) => prompts.PromptObject[];
  };
};

/** Enforce both directions even for records assembled with object spreads. */
export function defineFlags<Options, Context = never>() {
  return <const Records extends FlagRecords<Options, Context>>(
    records: Records & Record<Exclude<keyof Records, keyof Options>, never>,
  ): Records => records;
}

export function flagQuestions<Options, Context>(
  records: FlagRecords<Options, Context>,
  options: Options,
  context: Context,
): prompts.PromptObject[] {
  const fields: readonly (FlagRecord & {
    readonly prompt?: (options: Options, context: Context) => prompts.PromptObject[];
  })[] = Object.values(records);
  return fields.flatMap((record) => record.prompt?.(options, context) ?? []);
}

export function registerFlags(command: Command, records: Readonly<Record<string, FlagRecord>>): void {
  for (const record of Object.values(records)) {
    if ('argument' in record) {
      command.argument(...record.argument);
    } else {
      if (record.choices)
        choiceOption(
          record.flags,
          record.description ?? '',
          [...record.choices],
          typeof record.defaultValue === 'string' ? record.defaultValue : undefined,
        )(command);
      else if (record.list === 'repeatable') repeatableListOption(record.flags, record.description ?? '')(command);
      else if (record.list)
        commaListOption({ ...record, empty: record.list === 'optional' ? undefined : record.list })(command);
      else option(record)(command);
      if (record.negative) option(record.negative)(command);
    }
  }
}

/** Handler values use only record keys, independent of Commander camel-casing. */
export function flagValues(
  records: Readonly<Record<string, FlagRecord>>,
  raw: Record<string, unknown>,
  args: readonly unknown[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const attributes = new Set(Object.keys(raw));
  let index = 0;
  for (const [key, record] of Object.entries(records)) {
    if ('argument' in record) values[key] = args[index++];
    else {
      const attribute = new Option(record.flags).attributeName();
      if (attributes.has(attribute)) values[key] = raw[attribute];
      if (values[key] === undefined && record.runtimeDefault !== undefined)
        values[key] = Array.isArray(record.runtimeDefault) ? [...record.runtimeDefault] : record.runtimeDefault;
    }
  }
  return values;
}

/** Long spelling for user-facing advice; placeholders and short aliases are omitted. */
export function flagName(record: { readonly flags: string }): string {
  return record.flags.match(/--[\w-]+/)?.[0] ?? record.flags.split(' ')[0];
}

export const collectionFlag = (description = 'Name of the collection') => ({
  flags: '--collection <name>',
  description,
});
export const localeFlag = (description: string) => ({ flags: '--locale <locale>', description });
export const yesFlag = { flags: '--yes', description: 'Skip confirmation prompt' };
export const tokenCasingFlag = {
  flags: '--token-casing <casing>',
  description: 'Token property key casing',
  choices: ['upperCase', 'camelCase'],
};
export const collectionSetupFlags = {
  collectionName: { flags: '--collection-name <name>', description: 'Name for the translation collection' },
  translationsFolder: { flags: '--translations-folder <path>' },
  exportFolder: { flags: '--export-folder <path>', description: 'dist/lingo-export' },
  importFolder: { flags: '--import-folder <path>', description: 'dist/lingo-import' },
  baseLocale: { flags: '--base-locale <locale>', description: 'en' },
  locales: { flags: '--locales <locales...>', description: 'supported locales' },
};
export const setupBundleFlag = {
  flags: '--setup-bundle <bool>',
  description: 'Setup bundle configuration during init (true/false)',
  parse: (value: string) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${flagName(setupBundleFlag)} must be "true" or "false", got "${value}"`);
  },
};
export const addResourceFlags = {
  key: { flags: '--key <key>', description: 'Resource key (dot-delimited, e.g., apps.common.buttons.ok)' },
  value: { flags: '--value <value>', description: 'Base value (source text)' },
  comment: { flags: '--comment <comment>', description: 'Optional context for translators' },
  tags: { flags: '--tags <tags>', description: 'Optional tags (comma-separated)', list: 'optional' as const },
  targetFolder: { flags: '--target-folder <folder>', description: 'Optional target folder (dot-delimited)' },
};
export const editResourceFlags = {
  key: { flags: '--key <key>', description: 'Resource key (dot-delimited)' },
  baseValue: { flags: '--base-value <value>', description: 'New base value (source text)' },
  comment: { flags: '--comment <comment>', description: 'New comment' },
  tags: { flags: '--tags <tags>', description: 'New tags (comma-separated)', list: 'optional' as const },
  targetFolder: {
    flags: '--target-folder <folder>',
    description: 'Move the resource into this folder (dot-delimited; "" for the collection root)',
  },
};
