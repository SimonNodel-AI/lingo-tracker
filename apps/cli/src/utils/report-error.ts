import { ConsoleFormatter } from './console-formatter';

/**
 * Thrown when the user cancels an interactive prompt. Commands catch it with `instanceof`;
 * the message is `<operation> cancelled`, as before.
 */
export class PromptCancelledError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`${operation} cancelled`);
    this.name = 'PromptCancelledError';
    this.operation = operation;
  }
}

/**
 * Reports a failure that ends the command: prints `❌ <prefix><message>` and exits with
 * code 1. A core `LingoTrackerError` carries the user-facing text in its message, so the
 * CLI shows it as is.
 */
export function exitWithError(error: unknown, prefix = ''): never {
  ConsoleFormatter.error(`${prefix}${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
