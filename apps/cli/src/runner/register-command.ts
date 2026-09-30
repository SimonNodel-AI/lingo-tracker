import type { Command } from 'commander';
import type { OptionDefinition } from './options';

export interface CommandRegistration<Options> {
  readonly name: string;
  readonly description: string;
  readonly options: readonly OptionDefinition[];
  readonly argument?: readonly [name: string, description: string];
  readonly helpText?: string;
  readonly load: () => Promise<(options: Options) => Promise<void> | void>;
  readonly mapOptions?: (raw: Record<string, unknown>, args: readonly unknown[]) => Options;
}

/** Register help and flags now; load the command module only when its action runs. */
export function registerCommand<Options>(program: Command, registration: CommandRegistration<Options>): Command {
  const command = program.command(registration.name).description(registration.description);
  if (registration.argument) command.argument(...registration.argument);
  for (const definition of registration.options) definition(command);
  if (registration.helpText) command.addHelpText('after', registration.helpText);
  command.action(async (...args: unknown[]) => {
    const raw = command.opts() as Record<string, unknown>;
    // Commander leaves opts untyped. This is the intended boundary to the handler's
    // Options type; main.handlers.spec.ts checks every registration's argv mapping.
    const options = registration.mapOptions ? registration.mapOptions(raw, args) : (raw as Options);
    const run = await registration.load();
    await run(options);
  });
  return command;
}
