import { describe, expect, it } from 'vitest';
import { InvalidResourceKeyError } from '../errors/lingo-tracker-error';
import { validateMoveInput } from './move-input';

describe('validateMoveInput', () => {
  it('uses typed key validation and retains the submitted selection', () => {
    for (const source of ['bad@key', 'bad@key*', 'bad@key.*']) {
      const validate = () => validateMoveInput({ source, destination: 'ok' });
      expect(validate).toThrow(InvalidResourceKeyError);
      expect(validate).toThrow(
        expect.objectContaining({
          key: source,
          message: 'Key validation: Invalid key segment "bad@key". Segments must match pattern [A-Za-z0-9_-]+',
        }),
      );
    }
    expect(() => validateMoveInput({ source: 'ok', destination: 'bad@key' })).toThrow(InvalidResourceKeyError);
  });

  it('keeps the pattern root rules', () => {
    expect(validateMoveInput({ source: '*', destination: '' })).toBe('pattern');
    expect(validateMoveInput({ source: 'apps.*', destination: '' })).toBe('pattern');
    expect(validateMoveInput({ source: 'ok', destination: 'apps.ok' })).toBe('key');
    expect(() => validateMoveInput({ source: 'ok', destination: '' })).toThrow(InvalidResourceKeyError);
  });
});
