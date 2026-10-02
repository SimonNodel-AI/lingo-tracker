import type prompts from 'prompts';
import { parseCommaSeparatedList } from './string-parsers';

/** The CLI choice of one, several, or all named items. */
export type Selection = { readonly kind: 'all' } | { readonly kind: 'some'; readonly names: string[] };

/** Private prompt value; flags can still name an item with this spelling. */
const ALL_ITEMS_SENTINEL = '__ALL__';

interface SelectionPromptOptions {
  readonly name: string;
  readonly message: string;
  readonly choices: readonly string[];
  /** Omit this title for a prompt without an all choice. */
  readonly allTitle?: string;
  readonly mode: 'single' | 'multiple';
}

/** Builds the CLI's single or multiple selection prompt, with its existing all-choice order and defaults. */
export function selectionPrompt(options: SelectionPromptOptions): prompts.PromptObject {
  const choices: prompts.Choice[] = options.choices.map((name) => ({ title: name, value: name }));
  if (options.allTitle) {
    const all = { title: options.allTitle, value: ALL_ITEMS_SENTINEL };
    if (options.mode === 'multiple') choices.unshift({ ...all, selected: true });
    else choices.push(all);
  }
  return options.mode === 'multiple'
    ? {
        type: 'multiselect',
        name: options.name,
        message: options.message,
        choices,
        min: 1,
        hint: 'Space to select. Return to submit',
        instructions: false,
      }
    : { type: 'select', name: options.name, message: options.message, choices };
}

/** Resolves a literal single-name flag or prompt answer. A supplied flag takes precedence, including an empty flag. */
export function parseNameSelection(flagValue: string | true | undefined, answerValue?: unknown): Selection | undefined {
  if (flagValue === true) return { kind: 'all' };
  if (flagValue !== undefined) return namedSelection(flagValue ? [flagValue] : undefined);
  return parsePromptSelection(answerValue);
}

/** Resolves a comma-list flag or prompt answer. A supplied flag takes precedence, including an empty flag. */
export function parseListSelection(flagValue: string | true | undefined, answerValue?: unknown): Selection | undefined {
  if (flagValue === true) return { kind: 'all' };
  if (flagValue !== undefined) return namedSelection(parseCommaSeparatedList(flagValue));
  return parsePromptSelection(answerValue);
}

/** Decodes the private all choice; multiple answers retain the existing comma-list parsing. */
function parsePromptSelection(answerValue: unknown): Selection | undefined {
  if (answerValue === ALL_ITEMS_SENTINEL) return { kind: 'all' };
  if (typeof answerValue === 'string') return namedSelection(answerValue ? [answerValue] : undefined);
  if (!Array.isArray(answerValue)) return undefined;
  const names = answerValue.filter((item): item is string => typeof item === 'string');
  if (names.includes(ALL_ITEMS_SENTINEL)) return { kind: 'all' };
  return namedSelection(names.flatMap((name) => parseCommaSeparatedList(name) ?? []));
}

/** Empty input has no selection; the command decides whether it defaults to all or fails. */
function namedSelection(names: string[] | undefined): Selection | undefined {
  return names && names.length > 0 ? { kind: 'some', names } : undefined;
}

/** Maps a Selection to core's optional name filter: undefined means all. */
export function selectionNames(selection: Selection | undefined): string[] | undefined {
  return selection?.kind === 'some' ? selection.names : undefined;
}
