import { Command } from 'commander';
import { commandManifest } from './command-manifest';

export function createCli(): Command {
  const program = new Command();

  program
    .name('lingo-tracker')
    .description('Effortlessly track, validate, and manage your translations')
    .version(__CLI_VERSION__);

  for (const entry of commandManifest) entry.register(program);

  return program;
}
