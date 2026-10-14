import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { findBracedPlaceholders } from '@simoncodes-ca/domain';

/**
 * Rejects a Transloco interpolation inside literal braces, `{{{name}}}`, which
 * the save would collapse to `{name}`. The domain decides what counts
 * (`findBracedPlaceholders`); a case body that is only a placeholder is fine.
 *
 * It reports the first finding as `{ name, position }`, the position being the
 * outer opening brace. Like `Validators.required`'s partner validators, it
 * leaves an empty value to `Validators.required`.
 */
export const bracedPlaceholderValidator: ValidatorFn = (control: AbstractControl<unknown>): ValidationErrors | null => {
  const value = control.value;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const [first] = findBracedPlaceholders(value);
  return first ? { bracedPlaceholder: { name: first.name, position: first.range.start } } : null;
};
