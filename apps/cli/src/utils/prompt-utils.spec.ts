import { describe, expect, it } from 'vitest';
import {
  parseNameSelection,
  parseListSelection,
  selectionNames,
  selectionPrompt,
  type Selection,
} from './prompt-utils';

const ALL_ITEMS_SENTINEL = '__ALL__';

describe('selectionPrompt', () => {
  it('should have the correct sentinel value', () => {
    expect(
      selectionPrompt({ mode: 'single', name: 'items', message: 'Select items', choices: [], allTitle: 'All items' }),
    ).toMatchObject({
      choices: [{ title: 'All items', value: '__ALL__' }],
    });
  });
});

describe('prompt selections', () => {
  it('should return selected items when specific items are chosen', () => {
    const result = selectionNames(parseListSelection(undefined, ['en', 'fr']));
    expect(result).toEqual(['en', 'fr']);
  });

  it('should return undefined when __ALL__ is selected', () => {
    const result = selectionNames(parseListSelection(undefined, [ALL_ITEMS_SENTINEL]));
    expect(result).toBeUndefined();
  });

  it('should return undefined when __ALL__ plus other items are selected (All takes precedence)', () => {
    const result = selectionNames(parseListSelection(undefined, [ALL_ITEMS_SENTINEL, 'en', 'fr']));
    expect(result).toBeUndefined();
  });

  it('should return undefined when __ALL__ is in the middle of selections', () => {
    const result = selectionNames(parseListSelection(undefined, ['en', ALL_ITEMS_SENTINEL, 'fr']));
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    const result = selectionNames(parseListSelection(undefined, []));
    expect(result).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    const result = selectionNames(parseListSelection(undefined, undefined));
    expect(result).toBeUndefined();
  });

  it('should return single item in array when one item is selected', () => {
    const result = selectionNames(parseListSelection(undefined, ['en']));
    expect(result).toEqual(['en']);
  });

  it('should return all items when all are manually selected (no __ALL__)', () => {
    const result = selectionNames(parseListSelection(undefined, ['en', 'fr', 'de', 'es']));
    expect(result).toEqual(['en', 'fr', 'de', 'es']);
  });

  it('should preserve order of selected items', () => {
    const result = selectionNames(parseListSelection(undefined, ['es', 'en', 'de']));
    expect(result).toEqual(['es', 'en', 'de']);
  });

  it('should handle empty available items list', () => {
    const result = selectionNames(parseListSelection(undefined, ['en', 'fr']));
    expect(result).toEqual(['en', 'fr']);
  });

  it('should return undefined when __ALL__ is selected with empty available items', () => {
    const result = selectionNames(parseListSelection(undefined, [ALL_ITEMS_SENTINEL]));
    expect(result).toBeUndefined();
  });
});

describe('name filters', () => {
  it('should return undefined for undefined input', () => {
    const result = selectionNames(parseListSelection(undefined, undefined));
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    const result = selectionNames(parseListSelection(undefined, []));
    expect(result).toBeUndefined();
  });

  it('should resolve a single name', () => {
    const result = selectionNames(parseListSelection(undefined, ['en']));
    expect(result).toEqual(['en']);
  });

  it('should resolve multiple names', () => {
    const result = selectionNames(parseListSelection(undefined, ['en', 'fr', 'de']));
    expect(result).toEqual(['en', 'fr', 'de']);
  });

  it('should preserve order of items', () => {
    const result = selectionNames(parseListSelection(undefined, ['es', 'en', 'de']));
    expect(result).toEqual(['es', 'en', 'de']);
  });

  it('should handle items with special characters', () => {
    const result = selectionNames(parseListSelection(undefined, ['en-US', 'fr-FR']));
    expect(result).toEqual(['en-US', 'fr-FR']);
  });

  it('should handle many items', () => {
    const result = selectionNames(parseListSelection(undefined, ['a', 'b', 'c', 'd', 'e', 'f']));
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('parseListSelection', () => {
  const cases: { label: string; flag?: string; answer?: unknown; expected: Selection | undefined }[] = [
    { label: 'flag only', flag: ' en, fr, ,', expected: { kind: 'some', names: ['en', 'fr'] } },
    { label: 'answer only', answer: 'main', expected: { kind: 'some', names: ['main'] } },
    { label: 'multiple answers', answer: ['en', 'fr'], expected: { kind: 'some', names: ['en', 'fr'] } },
    { label: 'single sentinel', answer: '__ALL__', expected: { kind: 'all' } },
    { label: 'sentinel with names', answer: ['en', '__ALL__', 'fr'], expected: { kind: 'all' } },
    { label: 'empty list', answer: [], expected: undefined },
    { label: 'empty flag', flag: '', expected: undefined },
    { label: 'empty answer', answer: '', expected: undefined },
    { label: 'no input', expected: undefined },
    { label: 'both supplied', flag: 'en', answer: ['fr'], expected: { kind: 'some', names: ['en'] } },
    { label: 'flag over sentinel', flag: 'en', answer: '__ALL__', expected: { kind: 'some', names: ['en'] } },
    { label: 'empty flag over answer', flag: '', answer: 'main', expected: undefined },
    { label: 'sentinel spelling in flag is a name', flag: '__ALL__', expected: { kind: 'some', names: ['__ALL__'] } },
    { label: 'comma-only flag', flag: ' , ', expected: undefined },
    { label: 'prompt list parsing', answer: [' en, fr ', '', 1], expected: { kind: 'some', names: ['en', 'fr'] } },
  ];

  for (const { label, flag, answer, expected } of cases) {
    it(label, () => {
      expect(parseListSelection(flag, answer)).toEqual(expected);
    });
  }

  it('keeps single-name flags literal for normalize and glossary', () => {
    expect(parseNameSelection(' main, admin ')).toEqual({
      kind: 'some',
      names: [' main, admin '],
    });
  });

  it('builds the existing multiselect prompt with all first and selected', () => {
    expect(
      selectionPrompt({
        name: 'collections',
        message: 'Select collections to export',
        choices: ['main'],
        allTitle: 'All Collections',
        mode: 'multiple',
      }),
    ).toEqual({
      type: 'multiselect',
      name: 'collections',
      message: 'Select collections to export',
      choices: [
        { title: 'All Collections', value: '__ALL__', selected: true },
        { title: 'main', value: 'main' },
      ],
      min: 1,
      hint: 'Space to select. Return to submit',
      instructions: false,
    });
  });

  it('builds a single selection without an all choice', () => {
    expect(
      selectionPrompt({ mode: 'single', name: 'collection', message: 'Select collection', choices: ['main'] }),
    ).toEqual({
      type: 'select',
      name: 'collection',
      message: 'Select collection',
      choices: [{ title: 'main', value: 'main' }],
    });
  });
});

describe('parseNameSelection', () => {
  const cases: { label: string; flag?: string; answer?: unknown; expected: Selection | undefined }[] = [
    { label: 'flag only', flag: ' main, admin ', expected: { kind: 'some', names: [' main, admin '] } },
    { label: 'answer only', answer: 'main', expected: { kind: 'some', names: ['main'] } },
    { label: 'sentinel', answer: '__ALL__', expected: { kind: 'all' } },
    { label: 'empty flag', flag: '', expected: undefined },
    { label: 'empty answer', answer: '', expected: undefined },
    { label: 'both supplied', flag: 'main', answer: 'admin', expected: { kind: 'some', names: ['main'] } },
    { label: 'flag beats all answer', flag: 'main', answer: '__ALL__', expected: { kind: 'some', names: ['main'] } },
    { label: 'empty flag beats answer', flag: '', answer: 'main', expected: undefined },
  ];
  for (const { label, flag, answer, expected } of cases) {
    it(label, () => {
      expect(parseNameSelection(flag, answer)).toEqual(expected);
    });
  }
});
