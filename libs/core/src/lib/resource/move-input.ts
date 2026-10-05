import { validateKey } from '@simoncodes-ca/domain';
import { InvalidResourceKeyError } from '../errors/lingo-tracker-error';

/** Retains the existing `prefix*`, `prefix.*`, and root `*` selection rules. */
export function movePatternPrefix(pattern: string): string {
  const prefix = pattern.slice(0, -1);
  return prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
}

/** Validate submitted addresses and infer resource selection without reading or changing folders. */
export function validateMoveInput({
  source,
  destination,
}: {
  readonly source: string;
  readonly destination: string;
}): 'key' | 'pattern' {
  const pattern = source.endsWith('*');
  const prefix = pattern ? movePatternPrefix(source) : source;
  if (pattern === false || prefix.length > 0) validateMoveKey(prefix, source);
  // Only a pattern destination can name the collection root.
  if (pattern === false || destination.length > 0) validateMoveKey(destination, destination);
  return pattern ? 'pattern' : 'key';
}

function validateMoveKey(key: string, input: string): void {
  try {
    validateKey(key);
  } catch (error) {
    throw new InvalidResourceKeyError(input, error instanceof Error ? error.message : String(error));
  }
}
