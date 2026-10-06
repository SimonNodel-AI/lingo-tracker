import { type Command, Option } from 'commander';
import type prompts from 'prompts';
import { parseListSelection, parseNameSelection, type Selection } from '../utils/prompt-utils';
import { choiceOption, commaListOption, option, repeatableListOption, type OptionSpec } from './options';

/** A flag or positional value, including the conversion applied at the Commander boundary. */
type FlagFields = Omit<OptionSpec<unknown>, 'parse'> & {
  readonly positive?: { readonly flags: string; readonly description: string };
  /** Applied after parsing; unlike defaultValue, this does not change help. */
  readonly runtimeDefault?: unknown;
  readonly selection?: SelectionRecord;
  /** Resolver fallback for an optional-value flag present without its value. */
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
export type FlagRecords<Options, Context = never, PromptAnswers = Options> = {
  readonly [Key in keyof Required<Options>]: FlagRecord & {
    readonly selection?: SelectionRecord<Options, PromptAnswers>;
    readonly prompt?: (options: Options, context: Context) => prompts.PromptObject[];
  };
};

/** Enforce both directions even for records assembled with object spreads. */
export function defineFlags<Options, Context = never, PromptAnswers = Options>() {
  return <const Records extends FlagRecords<Options, Context, PromptAnswers>>(
    records: Records & Record<Exclude<keyof Records, keyof Options>, never>,
  ): Records => records;
}

export function flagQuestions<Options, Context>(
  records: FlagRecords<Options, Context, Record<string, unknown>>,
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
      if (record.positive) option({ ...record, ...record.positive })(command);
      const registration = record.positive ? { flags: record.flags, description: record.description } : record;
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
      else option(registration)(command);
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
    }
  }
  return values;
}

/** Selection metadata keeps prompt-only answer names at the input boundary. */
export interface SelectionRecord<Options = Record<string, unknown>, PromptAnswers = Options> {
  readonly prompt?: keyof PromptAnswers & string;
  readonly allFlag?: keyof Options & string;
  readonly defaultAll?: boolean;
  readonly emptyFlagFallsBack?: boolean;
  readonly emptyPromptError?: string;
}

/** Shared decoder for flag records and the richer export option table. */
function resolveSelection(
  record: Extract<FlagRecord, { readonly flags: string }>,
  flag: unknown,
  input: object,
): Selection | undefined {
  const selection = record.selection;
  if (!selection) return undefined;
  const answers = input as Readonly<Record<string, unknown>>;
  const answer = selection.prompt ? answers[selection.prompt] : undefined;
  if (Array.isArray(answer) && answer.length === 0 && selection.emptyPromptError)
    throw new Error(selection.emptyPromptError);
  const prompt = parseNameSelection(undefined, answer);
  if (selection.allFlag && (answers[selection.allFlag] === true || prompt?.kind === 'all')) return { kind: 'all' };
  const selected = !record.list
    ? parseNameSelection(typeof flag === 'string' ? flag : undefined, answer)
    : parseListSelection(typeof flag === 'string' || Array.isArray(flag) ? flag : undefined, answer);
  return (
    selected ??
    (selection.emptyFlagFallsBack ? prompt : undefined) ??
    (selection.defaultAll ? { kind: 'all' } : undefined)
  );
}

/** Resolve parsed values under record keys, for both production and command tests. */
export function resolveFlagValues<Options extends object = Record<string, unknown>>(
  records: Readonly<Record<string, FlagRecord>>,
  input: object,
  submitted: object = {},
): { values: Options; selections: Partial<Record<keyof Options, Selection>> } {
  const values: Record<string, unknown> = {};
  const selections: Partial<Record<keyof Options, Selection>> = {};
  const raw = input as Readonly<Record<string, unknown>>;
  const answers = { ...raw, ...submitted };
  for (const [key, record] of Object.entries<FlagRecord>(records)) {
    let value = answers[key];
    if ('flags' in record) {
      if (value === true && record.implicitValue !== undefined) value = record.implicitValue;
      // Mirror Commander defaults so runCommand receives production values.
      const fallback =
        record.runtimeDefault ??
        record.defaultValue ??
        (record.list === 'repeatable' ? [] : new Option(record.flags).negate && !record.positive ? true : undefined);
      if (value === undefined && fallback !== undefined) value = Array.isArray(fallback) ? [...fallback] : fallback;
      if (record.selection) {
        const selection = resolveSelection(record, raw[key] ?? value, answers);
        if (selection) selections[key as keyof Options] = selection;
      }
    }
    if (value !== undefined || key in answers) values[key] = value;
  }
  // The records enforce every Options key; parsed inputs are checked at their transport boundary.
  return { values: values as Options, selections };
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
