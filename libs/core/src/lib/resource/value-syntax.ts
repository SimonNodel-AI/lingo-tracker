import { describeBracedPlaceholder, findBracedPlaceholders } from '@simoncodes-ca/domain';
import { BracedPlaceholderError } from '../errors/lingo-tracker-error';

export function assertNoBracedPlaceholders(locale: string, value: string): void {
  const found = findBracedPlaceholders(value);
  if (found.length > 0) {
    throw new BracedPlaceholderError(locale, found.map(describeBracedPlaceholder));
  }
}
