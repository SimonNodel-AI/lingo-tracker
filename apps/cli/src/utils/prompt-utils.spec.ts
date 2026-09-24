import { describe, expect, it } from 'vitest';
import { ALL_ITEMS_SENTINEL, multiselectResultToString, processMultiselectWithAll } from './prompt-utils';

describe('ALL_ITEMS_SENTINEL', () => {
  it('should have the correct sentinel value', () => {
    expect(ALL_ITEMS_SENTINEL).toBe('__ALL__');
  });
});

describe('processMultiselectWithAll', () => {
  it('should return selected items when specific items are chosen', () => {
    const result = processMultiselectWithAll(['en', 'fr']);
    expect(result).toEqual(['en', 'fr']);
  });

  it('should return undefined when __ALL__ is selected', () => {
    const result = processMultiselectWithAll([ALL_ITEMS_SENTINEL]);
    expect(result).toBeUndefined();
  });

  it('should return undefined when __ALL__ plus other items are selected (All takes precedence)', () => {
    const result = processMultiselectWithAll([ALL_ITEMS_SENTINEL, 'en', 'fr']);
    expect(result).toBeUndefined();
  });

  it('should return undefined when __ALL__ is in the middle of selections', () => {
    const result = processMultiselectWithAll(['en', ALL_ITEMS_SENTINEL, 'fr']);
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    const result = processMultiselectWithAll([]);
    expect(result).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    const result = processMultiselectWithAll(undefined);
    expect(result).toBeUndefined();
  });

  it('should return single item in array when one item is selected', () => {
    const result = processMultiselectWithAll(['en']);
    expect(result).toEqual(['en']);
  });

  it('should return all items when all are manually selected (no __ALL__)', () => {
    const result = processMultiselectWithAll(['en', 'fr', 'de', 'es']);
    expect(result).toEqual(['en', 'fr', 'de', 'es']);
  });

  it('should preserve order of selected items', () => {
    const result = processMultiselectWithAll(['es', 'en', 'de']);
    expect(result).toEqual(['es', 'en', 'de']);
  });

  it('should handle empty available items list', () => {
    const result = processMultiselectWithAll(['en', 'fr']);
    expect(result).toEqual(['en', 'fr']);
  });

  it('should return undefined when __ALL__ is selected with empty available items', () => {
    const result = processMultiselectWithAll([ALL_ITEMS_SENTINEL]);
    expect(result).toBeUndefined();
  });
});

describe('multiselectResultToString', () => {
  it('should return undefined for undefined input', () => {
    const result = multiselectResultToString(undefined);
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    const result = multiselectResultToString([]);
    expect(result).toBeUndefined();
  });

  it('should return single item without comma', () => {
    const result = multiselectResultToString(['en']);
    expect(result).toBe('en');
  });

  it('should return comma-separated string for multiple items', () => {
    const result = multiselectResultToString(['en', 'fr', 'de']);
    expect(result).toBe('en,fr,de');
  });

  it('should preserve order of items', () => {
    const result = multiselectResultToString(['es', 'en', 'de']);
    expect(result).toBe('es,en,de');
  });

  it('should handle items with special characters', () => {
    const result = multiselectResultToString(['en-US', 'fr-FR']);
    expect(result).toBe('en-US,fr-FR');
  });

  it('should handle many items', () => {
    const result = multiselectResultToString(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(result).toBe('a,b,c,d,e,f');
  });
});
