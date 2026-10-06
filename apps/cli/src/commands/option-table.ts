import type prompts from 'prompts';
import type { OptionSpec } from '../runner/options';
import type { FlagRecord, SelectionRecord } from '../runner/flag-record';

interface RegistrationFields<Options, Answers>
  extends Omit<OptionSpec<unknown>, 'helpDefault' | 'parse' | 'defaultValue'> {
  readonly description: string;
  /** Undefined explicitly means no default; prompt initials may differ. */
  readonly defaultValue: string | boolean | undefined;
  readonly defaultMode?: 'help' | 'commander';
  readonly selection?: SelectionRecord<Options, Answers>;
  readonly positive?: { readonly flags: string; readonly description: string };
}

export type TableRegistration<
  Options = Record<string, unknown>,
  Answers = Record<string, unknown>,
> = RegistrationFields<Options, Answers> &
  (
    | { readonly list: 'optional' | 'preserve'; readonly parse?: never }
    | { readonly list?: never; readonly parse?: (value: string) => unknown }
  );

type PromptFactory<Values, Context> = (
  options: Values,
  context: Context,
  defaultValue: string | boolean | undefined,
) => prompts.PromptObject[];

export type CommandOptionRecord<
  Values,
  Context,
  Resolved = object,
  Options = Record<string, unknown>,
> = TableRegistration<Options, Values> & {
  readonly prompt?: PromptFactory<Values, Context>;
  readonly resolve: (values: Values, defaultValue: string | boolean | undefined, context: Context) => Resolved;
};

export type CommandOptionTable<
  Options,
  Values,
  Context,
  Results extends Record<keyof Required<Options>, object> = Record<keyof Required<Options>, object>,
> = {
  readonly [Key in keyof Required<Options>]: CommandOptionRecord<Values, Context, Results[Key], Options>;
};

export type OrderedCommandOptionRecord<
  Values,
  Context,
  Resolved = object,
  Options = Record<string, unknown>,
> = CommandOptionRecord<Values, Context, Resolved, Options> &
  (
    | { readonly prompt: PromptFactory<Values, Context>; readonly promptOrder: number }
    | { readonly prompt?: never; readonly promptOrder?: never }
  );

export type OrderedCommandOptionTable<
  Options,
  Values,
  Context,
  Results extends Record<keyof Required<Options>, object> = Record<keyof Required<Options>, object>,
> = {
  readonly [Key in keyof Required<Options>]: OrderedCommandOptionRecord<Values, Context, Results[Key], Options>;
};

/** Adapt the richer import/export records to the same registration path as other commands. */
export function tableFlags<Table extends Record<string, TableRegistration>>(
  table: Table,
): { readonly [Key in keyof Table]: FlagRecord & { readonly selection?: Table[Key]['selection'] } } {
  return Object.fromEntries(
    Object.entries(table).map(([key, record]) => [
      key,
      {
        flags: record.flags,
        description: record.description,
        helpDefault: record.defaultMode === 'help' ? record.defaultValue : undefined,
        defaultValue: record.defaultMode === 'commander' ? record.defaultValue : undefined,
        parse: record.parse,
        list: record.list,
        positive: record.positive,
        selection: record.selection,
      },
    ]),
  ) as { readonly [Key in keyof Table]: FlagRecord & { readonly selection?: Table[Key]['selection'] } };
}

export function tableQuestions<Values, Context>(
  table: Record<string, CommandOptionRecord<Values, Context>>,
  values: Values,
  context: Context,
): prompts.PromptObject[] {
  return Object.values(table).flatMap((record) => record.prompt?.(values, context, record.defaultValue) ?? []);
}

export function orderedTableQuestions<Values, Context>(
  table: Record<string, OrderedCommandOptionRecord<Values, Context>>,
  values: Values,
  context: Context,
): prompts.PromptObject[] {
  return Object.values(table)
    .flatMap((record) => (record.prompt ? [{ order: record.promptOrder, record }] : []))
    .sort((left, right) => left.order - right.order)
    .flatMap(({ record }) => record.prompt(values, context, record.defaultValue));
}

/** Preserve each record's exact result type for the command's complete assembly. */
export function resolveOption<Values, Context, Resolved>(
  record: CommandOptionRecord<Values, Context, Resolved>,
  values: Values,
  context: Context,
): Resolved {
  return record.resolve(values, record.defaultValue, context);
}
