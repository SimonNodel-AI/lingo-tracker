import { describe, expect, it } from 'vitest';
import { isJavaScriptReservedWord, isValidJavaScriptIdentifier } from './js-identifier';

describe('isJavaScriptReservedWord', () => {
  it('flags ES and TypeScript keywords', () => {
    for (const word of ['class', 'const', 'type', 'interface', 'await', 'satisfies']) {
      expect(isJavaScriptReservedWord(word)).toBe(true);
    }
  });

  it('flags globals that should not be shadowed', () => {
    expect(isJavaScriptReservedWord('undefined')).toBe(true);
    expect(isJavaScriptReservedWord('NaN')).toBe(true);
  });

  it('is case sensitive and leaves ordinary names alone', () => {
    expect(isJavaScriptReservedWord('Type')).toBe(false);
    expect(isJavaScriptReservedWord('MY_TOKENS')).toBe(false);
  });
});

describe('isValidJavaScriptIdentifier', () => {
  it('accepts any casing convention', () => {
    for (const name of ['MY_KEYS', 'myKeys', 'MyKeys', '_internal', '$tokens', 'a1']) {
      expect(isValidJavaScriptIdentifier(name)).toBe(true);
    }
  });

  it('rejects empty and malformed names', () => {
    for (const name of ['', '1bad', 'my-key', 'my key', 'ünïcode']) {
      expect(isValidJavaScriptIdentifier(name)).toBe(false);
    }
  });

  it('rejects reserved words even though they match the character pattern', () => {
    expect(isValidJavaScriptIdentifier('type')).toBe(false);
    expect(isValidJavaScriptIdentifier('typeTokens')).toBe(true);
  });
});
