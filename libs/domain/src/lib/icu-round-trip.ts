import { icuToTransloco } from './icu-to-transloco';
import { translocoToICU } from './transloco-to-icu';

/** Returns the bundled Transloco form if the ICU round trip changes more than interpolation whitespace. */
export function bundledFormIfLost(value: string): string | undefined {
  const bundled = icuToTransloco(translocoToICU(value));
  return normalizeInterpolationWhitespace(bundled) === normalizeInterpolationWhitespace(value) ? undefined : bundled;
}

function normalizeInterpolationWhitespace(value: string): string {
  return value.replace(/\{\{\s*([^}]*?)\s*\}\}/g, '{{$1}}');
}
