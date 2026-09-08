import { describe, it, expect } from 'vitest';
import { validatePlaceholders } from './validate-placeholders';
import type { LoadedResource } from '../export/export-common';

const resource = (overrides: Partial<LoadedResource> = {}): LoadedResource => ({
  key: 'folderAriaLabelX',
  fullKey: 'browser.folderNode.folderAriaLabelX',
  source: 'Folder {name}',
  translations: {},
  status: {},
  collection: 'trackerResources',
  ...overrides,
});

describe('validatePlaceholders', () => {
  it('passes when every translation interpolates the same argument', () => {
    const result = validatePlaceholders(
      [resource({ translations: { de: 'Ordner {name}', es: 'Carpeta {name}' } })],
      ['de', 'es'],
      'en',
    );

    expect(result.failures).toEqual([]);
    expect(result.valuesChecked).toBe(2);
  });

  it('reports a translated argument name', () => {
    const result = validatePlaceholders([resource({ translations: { es: 'Carpeta {nombre}' } })], ['es'], 'en');

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      key: 'browser.folderNode.folderAriaLabelX',
      locale: 'es',
      collection: 'trackerResources',
      missing: ['name'],
      unexpected: ['nombre'],
    });
  });

  it('describes a one-for-one swap as a rename', () => {
    const result = validatePlaceholders([resource({ translations: { es: 'Carpeta {nombre}' } })], ['es'], 'en');

    expect(result.failures[0]?.message).toBe(
      "Placeholder '{name}' was renamed to '{nombre}'; it renders as empty text",
    );
  });

  it('catches a case-only rename', () => {
    // The one that survives human review: German noun capitalisation is also a rename.
    const result = validatePlaceholders([resource({ translations: { de: 'Ordner {Name}' } })], ['de'], 'en');

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.missing).toEqual(['name']);
    expect(result.failures[0]?.unexpected).toEqual(['Name']);
  });

  it('accepts Transloco syntax in a stored value', () => {
    const result = validatePlaceholders([resource({ translations: { de: 'Ordner {{ name }}' } })], ['de'], 'en');

    expect(result.failures).toEqual([]);
  });

  it('reports every offending locale rather than stopping at the first', () => {
    const result = validatePlaceholders(
      [
        resource({
          translations: { de: 'Ordner {Name}', es: 'Carpeta {nombre}', fr: 'Dossier {nom}', ja: 'フォルダ {name}' },
        }),
      ],
      ['de', 'es', 'fr', 'ja'],
      'en',
    );

    expect(result.failures.map((f) => f.locale)).toEqual(['de', 'es', 'fr']);
    expect(result.valuesChecked).toBe(4);
  });

  it('skips a locale with no stored translation', () => {
    // An absent translation is the status gate's failure to report, not this one's.
    const result = validatePlaceholders([resource({ translations: {} })], ['de'], 'en');

    expect(result.failures).toEqual([]);
    expect(result.valuesChecked).toBe(0);
  });

  it('never compares the base locale against itself', () => {
    const result = validatePlaceholders([resource({ translations: { en: 'Folder {name}' } })], ['en', 'de'], 'en');

    expect(result.valuesChecked).toBe(0);
  });

  it('prefers an explicit base-locale translation over source', () => {
    const result = validatePlaceholders(
      [resource({ source: 'Folder {old}', translations: { en: 'Folder {name}', de: 'Ordner {name}' } })],
      ['de'],
      'en',
    );

    expect(result.failures).toEqual([]);
  });

  it('reports a dropped placeholder', () => {
    const result = validatePlaceholders([resource({ translations: { de: 'Ordner' } })], ['de'], 'en');

    expect(result.failures[0]).toMatchObject({ missing: ['name'], unexpected: [] });
    expect(result.failures[0]?.message).toBe("Placeholders disagree with the base value: missing '{name}'");
  });

  it('reports an added placeholder', () => {
    const result = validatePlaceholders(
      [resource({ source: 'Folder', translations: { de: 'Ordner {name}' } })],
      ['de'],
      'en',
    );

    expect(result.failures[0]).toMatchObject({ missing: [], unexpected: ['name'] });
    expect(result.failures[0]?.message).toBe("Placeholders disagree with the base value: unexpected '{name}'");
  });

  it('tolerates a locale using its own plural categories', () => {
    const result = validatePlaceholders(
      [
        resource({
          source: '{count, plural, =1 {1 file} other {# files}}',
          translations: { ru: '{count, plural, one {# файл} few {# файла} other {# файлов}}' },
        }),
      ],
      ['ru'],
      'en',
    );

    expect(result.failures).toEqual([]);
  });

  it('checks arguments used only inside a plural branch', () => {
    const result = validatePlaceholders(
      [
        resource({
          source: '{count, plural, other {# files in {dir}}}',
          translations: { de: '{count, plural, other {# Dateien in {Ordner}}}' },
        }),
      ],
      ['de'],
      'en',
    );

    expect(result.failures[0]).toMatchObject({ missing: ['dir'], unexpected: ['Ordner'] });
  });

  it('passes a value with no placeholders at all', () => {
    const result = validatePlaceholders(
      [resource({ source: 'Save', translations: { de: 'Speichern' } })],
      ['de'],
      'en',
    );

    expect(result.failures).toEqual([]);
    expect(result.valuesChecked).toBe(1);
  });

  it('leaves an unparseable translation to the ICU pass', () => {
    const result = validatePlaceholders([resource({ translations: { de: 'Ordner {unbalanced' } })], ['de'], 'en');

    expect(result.failures).toEqual([]);
  });
});
