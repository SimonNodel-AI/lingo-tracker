import * as path from 'path';
import prompts from 'prompts';
import {
  type Collection,
  CONFIG_FILENAME,
  ConfigNotFoundError,
  ConfigParseError,
  type LingoTrackerConfig,
  loadConfig,
  openCollection,
} from '@simoncodes-ca/core';
import { ConsoleFormatter } from '../utils/console-formatter';
import { isInteractiveTerminal } from './terminal';

/**
 * What a command needs opened before it runs.
 * - `'writable'` — one collection, opened with `writable: true` (a read-only one fails).
 * - `'read'` — one collection, opened for reading.
 * - `'none'` — no collection; the command reads `config` itself (or nothing, with `config: false`).
 */
export type CollectionNeed = 'writable' | 'read' | 'none';

/** What `run` may return: nothing (exit 0), or `{ exitCode: 1 }` for a failure it has already reported. */
export type CommandResult = { readonly exitCode: 0 | 1 } | undefined;

/** Flags merged with prompt answers. Prompt names match option keys; extra answers are `unknown`. */
export type Answers<Options> = Options & Readonly<Record<string, unknown>>;

/** The answers `run` gets: the `required` options are present (checked by the runner). */
export type CheckedAnswers<Options, Required extends keyof Options> = Answers<Options> & {
  readonly [K in Required]-?: NonNullable<Options[K]>;
};

/** `config: false` is only allowed with `collection: 'none'`: a collection is opened from the config. */
export type ConfigFlag<Need extends CollectionNeed> = Need extends 'none' ? boolean : true;

/** Runs follow-up prompts (confirmations, loops) under the runner's cancel rule. */
export type Ask = (questions: prompts.PromptObject | prompts.PromptObject[]) => Promise<Record<string, unknown>>;

interface BaseContext {
  /** The project root: `INIT_CWD` (set by pnpm), else `process.cwd()`. */
  readonly cwd: string;
  /** The runner's interactive rule, read once: stdin and stdout are both a terminal. */
  readonly interactive: boolean;
  /** Prompts inside `run`. Cancelling (Ctrl+C) ends the command like any other cancel. */
  readonly ask: Ask;
}

interface ConfigResources {
  readonly config: LingoTrackerConfig;
  /** Absolute path of `.lingo-tracker.json`. */
  readonly configPath: string;
}

interface CollectionResources {
  /** The collection named by the collection flag (or selected), opened by core `openCollection`. */
  readonly collection: Collection;
}

type Resources<Need extends CollectionNeed, WithConfig extends boolean> = (WithConfig extends true
  ? ConfigResources
  : unknown) &
  (Need extends 'none' ? unknown : CollectionResources);

/** What `prompts` receives: everything but the answers. */
export type PromptContext<Need extends CollectionNeed, WithConfig extends boolean = true> = BaseContext &
  Resources<Need, WithConfig>;

/** What `run` receives. */
export type CommandContext<
  Options,
  Need extends CollectionNeed,
  WithConfig extends boolean = true,
  Required extends keyof Options = never,
> = PromptContext<Need, WithConfig> & { readonly answers: CheckedAnswers<Options, Required> };

export interface CommandSpec<
  Options extends object,
  Need extends CollectionNeed,
  WithConfig extends boolean,
  Required extends keyof Options & string = never,
> {
  /** Operation name for messages: `❌ <name> cancelled.` */
  readonly name: string;
  readonly collection: Need;
  /** Option holding the collection name (default `collection`); named in the missing-option message. */
  readonly collectionOption?: keyof Options & string;
  /**
   * `false` skips loading `.lingo-tracker.json` (only `init` and `install-skill`). Only
   * allowed with `collection: 'none'`; anything else does not compile.
   */
  readonly config?: WithConfig;
  /**
   * Questions for missing values. Called in both modes, before `required` is checked, so
   * it may throw to fail early (for example "nothing to choose from"). The questions are
   * asked only when interactive.
   */
  readonly prompts?: (
    options: Options,
    ctx: PromptContext<Need, WithConfig>,
  ) => prompts.PromptObject[] | Promise<prompts.PromptObject[]>;
  /**
   * Options that must have a value before `run`: checked after the questions when
   * interactive, and against the flags when not. `undefined`, `null` and `''` count as
   * missing. `run` sees them typed as present.
   */
  readonly required?: readonly Required[];
  /** The core call(s) and the output. Throw to fail with `❌ <message>`. */
  readonly run: (
    ctx: CommandContext<Options, Need, WithConfig, Required>,
  ) => Promise<CommandResult> | Promise<void> | CommandResult | void;
}

/**
 * Thrown to end a command as cancelled: the runner prints `❌ <name> cancelled.` and
 * exits 0. The runner throws it when a prompt is cancelled; a command throws it when the
 * user declines a confirmation.
 */
export class CommandCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CommandCancelledError';
  }
}

/**
 * Throws `Missing required options[ in non-interactive mode]: --a, --b` when any of
 * `fields` is `undefined`, `null` or `''`. The runner uses it for `required`; a command
 * whose required options depend on its state (`init`) calls it itself.
 */
export function requireOptions<Options extends object, Field extends keyof Options & string>(
  values: Options,
  fields: readonly Field[],
  interactive: boolean,
): asserts values is Options & { readonly [K in Field]-?: NonNullable<Options[K]> } {
  const missing = fields.filter((field) => isMissing(values[field]));
  if (missing.length > 0) {
    const mode = interactive ? '' : ' in non-interactive mode';
    throw new Error(`Missing required options${mode}: ${missing.map(toFlag).join(', ')}`);
  }
}

/** The project root: `INIT_CWD` (set by pnpm to where the command was typed), else `process.cwd()`. */
function getCwd(): string {
  return process.env.INIT_CWD || process.cwd();
}

/**
 * Defines a CLI command. The returned function is what `main.ts` calls with the parsed
 * Commander options. Curried so the options type is given and the rest is inferred:
 *
 * ```ts
 * export const addLocaleCommand = defineCommand<AddLocaleOptions>()({
 *   name: 'Add locale',
 *   collection: 'writable',
 *   prompts: (options) => (options.locale ? [] : [{ type: 'text', name: 'locale', message: 'Locale' }]),
 *   required: ['locale'],
 *   run: async ({ collection, answers }) => { ... },
 * });
 * ```
 *
 * The runner owns, in order: the project root and the interactive rule; loading the
 * config; resolving and opening the collection; asking the questions; checking the
 * required options; cancellation; and turning a thrown error into `❌ <message>` and exit
 * code 1. It sets `process.exitCode` and returns; it never calls `process.exit()`.
 */
export function defineCommand<Options extends object>() {
  return <
    const Need extends CollectionNeed,
    const WithConfig extends ConfigFlag<Need> = true,
    const Required extends keyof Options & string = never,
  >(
    spec: CommandSpec<Options, Need, WithConfig, Required>,
  ): ((options: Options) => Promise<void>) => {
    return async (options: Options) => {
      process.exitCode = await execute(spec, options);
    };
  };
}

async function execute<
  Options extends object,
  Need extends CollectionNeed,
  WithConfig extends boolean,
  Required extends keyof Options & string,
>(spec: CommandSpec<Options, Need, WithConfig, Required>, options: Options): Promise<0 | 1> {
  try {
    const cwd = getCwd();
    const interactive = isInteractiveTerminal();
    let resources: Partial<ConfigResources & CollectionResources> = {};

    if (spec.config !== false) {
      const config = readConfig(cwd);
      resources = { config, configPath: path.join(cwd, CONFIG_FILENAME) };

      if (spec.collection !== 'none') {
        const flag = spec.collectionOption ?? 'collection';
        const given: unknown = options[flag as keyof Options];
        const name =
          typeof given === 'string' && given.length > 0 ? given : await selectCollection(config, interactive, flag);
        resources = {
          ...resources,
          collection: openCollection(config, name, { cwd, writable: spec.collection === 'writable' }),
        };
      }
    }

    // `resources` holds exactly what Need and WithConfig promise; the type cannot follow the branches above.
    const promptContext = { cwd, interactive, ask, ...resources } as PromptContext<Need, WithConfig>;

    const questions = spec.prompts ? await spec.prompts(options, promptContext) : [];
    const merged: Options = interactive && questions.length > 0 ? { ...options, ...(await ask(questions)) } : options;
    requireOptions(merged, spec.required ?? [], interactive);
    // requireOptions has just checked what CheckedAnswers claims; the type cannot follow it.
    const answers = merged as CheckedAnswers<Options, Required>;

    const result = await spec.run({ ...promptContext, answers });
    return result ? result.exitCode : 0;
  } catch (error) {
    return report(error, spec.name);
  }
}

/** Core `loadConfig`; an I/O failure other than a missing file reads as a parse failure, as before. */
function readConfig(cwd: string): LingoTrackerConfig {
  try {
    return loadConfig({ cwd });
  } catch (error) {
    if (error instanceof ConfigNotFoundError || error instanceof ConfigParseError) throw error;
    throw new ConfigParseError(path.join(cwd, CONFIG_FILENAME), error instanceof Error ? error.message : String(error));
  }
}

/** The runner's error for a command that needs a collection when the config has none. */
export const NO_COLLECTIONS_MESSAGE = 'No collections found. Run `lingo-tracker add-collection` first.';

/** No `--collection`: none configured fails, one is used, several are prompted for (interactive) or fail. */
async function selectCollection(config: LingoTrackerConfig, interactive: boolean, flag: string): Promise<string> {
  const names = Object.keys(config.collections ?? {});
  if (names.length === 0) {
    throw new Error(NO_COLLECTIONS_MESSAGE);
  }
  if (names.length === 1) {
    return names[0];
  }
  if (!interactive) {
    throw new Error(`Missing required option: ${toFlag(flag)}`);
  }
  const { collection } = await ask({
    type: 'select',
    name: 'collection',
    message: 'Select collection',
    choices: names.map((name) => ({ title: name, value: name })),
  });
  if (typeof collection !== 'string') {
    throw new CommandCancelledError();
  }
  return collection;
}

async function ask(questions: prompts.PromptObject | prompts.PromptObject[]): Promise<Record<string, unknown>> {
  let cancelled = false;
  const answers: Record<string, unknown> = await prompts(questions, {
    onCancel: () => {
      cancelled = true;
      return false;
    },
  });
  if (cancelled) {
    throw new CommandCancelledError();
  }
  return answers;
}

/** Prints the failure and returns the exit code: 0 for a cancel, 1 for anything else. */
function report(error: unknown, name: string): 0 | 1 {
  if (error instanceof CommandCancelledError) {
    ConsoleFormatter.error(`${name} cancelled.`);
    return 0;
  }
  if (error instanceof ConfigNotFoundError) {
    console.error(`❌ Configuration file ${CONFIG_FILENAME} not found.`);
    console.error('Run "lingo-tracker init" to initialize a project.');
    return 1;
  }
  if (error instanceof ConfigParseError) {
    console.error(`❌ Failed to parse configuration file: ${error.reason}`);
    return 1;
  }
  ConsoleFormatter.error(error instanceof Error ? error.message : String(error));
  return 1;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** `targetFolder` → `--target-folder`. */
function toFlag(option: string): string {
  return `--${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
