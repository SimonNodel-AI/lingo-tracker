import type prompts from 'prompts';
import { commaListOption, option, type OptionDefinition, type OptionSpec } from '../runner/options';

interface RegistrationFields extends Omit<OptionSpec<unknown>, 'helpDefault' | 'parse' | 'defaultValue'> {
  readonly description: string;
  /** Undefined explicitly means no default; prompt initials may differ. */
  readonly defaultValue: string | boolean | undefined;
  readonly defaultMode?: 'help' | 'commander';
  readonly negative?: { readonly flags: string; readonly description: string };
}

export type TableRegistration = RegistrationFields &
  (
    | { readonly list: 'optional' | 'preserve'; readonly parse?: never }
    | { readonly list?: never; readonly parse?: (value: string) => unknown }
  );

type PromptFactory<Values, Context> = (
  options: Values,
  context: Context,
  defaultValue: string | boolean | undefined,
) => prompts.PromptObject[];

export type CommandOptionRecord<Values, Context, Resolved = object> = TableRegistration & {
  readonly prompt?: PromptFactory<Values, Context>;
  readonly resolve: (values: Values, defaultValue: string | boolean | undefined, context: Context) => Resolved;
};

export type CommandOptionTable<
  Options,
  Values,
  Context,
  Results extends Record<keyof Required<Options>, object> = Record<keyof Required<Options>, object>,
> = {
  readonly [Key in keyof Required<Options>]: CommandOptionRecord<Values, Context, Results[Key]>;
};

export type OrderedCommandOptionRecord<Values, Context, Resolved = object> = CommandOptionRecord<
  Values,
  Context,
  Resolved
> &
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
  readonly [Key in keyof Required<Options>]: OrderedCommandOptionRecord<Values, Context, Results[Key]>;
};

export function tableOptions(table: Record<string, TableRegistration>): OptionDefinition[] {
  return Object.values(table).flatMap((record) => {
    const spec = {
      flags: record.flags,
      description: record.description,
      helpDefault: record.defaultMode === 'help' ? record.defaultValue : undefined,
      defaultValue: record.defaultMode === 'commander' ? record.defaultValue : undefined,
      parse: record.parse,
    };
    const definition = record.list
      ? commaListOption({
          flags: spec.flags,
          description: spec.description,
          helpDefault: spec.helpDefault,
          empty: record.list === 'preserve' ? 'preserve' : undefined,
        })
      : option(spec);
    return record.negative ? [definition, option(record.negative)] : [definition];
  });
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
