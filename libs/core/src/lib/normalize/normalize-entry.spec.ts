import { describe, it, expect } from 'vitest';
import { normalizeEntryValues } from './normalize-entry';
import type { ResourceEntry } from '../resource/resource-entry';

describe('normalizeEntryValues', () => {
  it('converts Transloco syntax to ICU in the base value and every translation, counting changed values', () => {
    const source: ResourceEntry = { source: 'Hello {{ name }}!', fr: 'Bonjour {{ name }} !', es: 'Hola {name}' };

    const result = normalizeEntryValues(source);

    expect(result.entry).toEqual({ source: 'Hello {name}!', fr: 'Bonjour {name} !', es: 'Hola {name}' });
    expect(result.valuesConverted).toBe(2);
    expect(source.source).toBe('Hello {{ name }}!');
  });

  it('normalizes tags once and drops a tag list that normalizes to nothing', () => {
    expect(normalizeEntryValues({ source: 'OK', tags: ['UI', 'Buttons', 'ui'] })).toMatchObject({
      entry: { source: 'OK', tags: ['ui', 'buttons'] },
      tagsNormalized: 1,
    });
    const result = normalizeEntryValues({ source: 'OK', tags: ['!!!'] });
    expect(result.entry).toEqual({ source: 'OK' });
    expect(result.tagsNormalized).toBe(1);
  });

  it('reports nothing for an entry that is already normalized', () => {
    const entry: ResourceEntry = { source: 'OK', fr: 'Oui', comment: 'Button', tags: ['ui'] };
    expect(normalizeEntryValues(entry)).toEqual({ entry, valuesConverted: 0, tagsNormalized: 0 });
  });
});
