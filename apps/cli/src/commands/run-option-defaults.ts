/**
 * Prompt dependencies prefer supplied flags, including false and empty strings; undefined leaves answers intact.
 * The runner instead merges submitted answers over flags.
 */
export function mergeRunOptions<Options extends object>(flags: Options, answers: Options): Options {
  const supplied = Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined));
  return { ...answers, ...supplied };
}
