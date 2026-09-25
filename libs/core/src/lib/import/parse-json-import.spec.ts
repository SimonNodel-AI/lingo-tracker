import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectJsonStructure, extractFromFlat, extractFromHierarchical, parseJsonImport } from './parse-json-import';

describe('parse JSON import', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lingo-parse-json-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('detectJsonStructure', () => {
    it('should detect flat structure when all keys contain dots', () => {
      expect(detectJsonStructure({ 'common.ok': 'OK', 'dashboard.title': 'Dashboard' })).toBe('flat');
    });
    it('should detect hierarchical structure when keys do not contain dots', () => {
      expect(detectJsonStructure({ common: { ok: 'OK' }, dashboard: { title: 'Dashboard' } })).toBe('hierarchical');
    });
    it('should detect hierarchical structure for mixed keys', () => {
      expect(detectJsonStructure({ 'common.ok': 'OK', dashboard: { title: 'Dashboard' } })).toBe('hierarchical');
    });
    it('should handle empty object as hierarchical', () => expect(detectJsonStructure({})).toBe('hierarchical'));
    it('should detect flat structure with single dotted key', () => {
      expect(detectJsonStructure({ 'common.title': 'Title' })).toBe('flat');
    });
  });

  describe('extractFromFlat', () => {
    it('should extract resources from flat structure', () => {
      expect(extractFromFlat({ 'common.ok': 'OK', 'common.cancel': 'Cancel' })).toEqual([
        { key: 'common.ok', value: 'OK' },
        { key: 'common.cancel', value: 'Cancel' },
      ]);
    });
    it('should skip non-string values in flat structure', () => {
      expect(extractFromFlat({ 'common.title': 'Title', 'common.count': 42, 'common.items': ['a'] })).toEqual([
        { key: 'common.title', value: 'Title' },
      ]);
    });
    it('should handle empty object', () => expect(extractFromFlat({})).toEqual([]));
    it('should extract rich format objects from flat structure', () => {
      expect(
        extractFromFlat({
          'common.title': {
            value: 'Título',
            comment: 'Page title',
            baseValue: 'Title',
            status: 'verified',
            tags: ['ui', 'common'],
          },
        }),
      ).toEqual([
        {
          key: 'common.title',
          value: 'Título',
          comment: 'Page title',
          baseValue: 'Title',
          status: 'verified',
          tags: ['ui', 'common'],
        },
      ]);
    });
    it('should filter out non-string tags', () => {
      expect(extractFromFlat({ 'common.title': { value: 'Título', tags: ['ui', 123, null] } })[0]?.tags).toEqual([
        'ui',
      ]);
    });
    it('should handle mix of simple and rich formats', () => {
      expect(extractFromFlat({ 'common.title': 'Título', 'common.description': { value: 'Descripción' } })).toEqual([
        { key: 'common.title', value: 'Título' },
        { key: 'common.description', value: 'Descripción' },
      ]);
    });
  });

  describe('extractFromHierarchical', () => {
    it('should extract resources from hierarchical structure', () => {
      expect(extractFromHierarchical({ common: { buttons: { ok: 'OK', cancel: 'Cancel' }, title: 'Common' } })).toEqual(
        [
          { key: 'common.buttons.ok', value: 'OK' },
          { key: 'common.buttons.cancel', value: 'Cancel' },
          { key: 'common.title', value: 'Common' },
        ],
      );
    });
    it('should handle deeply nested structures', () => {
      expect(extractFromHierarchical({ one: { two: { three: { deepValue: 'Deep' } } } })).toEqual([
        { key: 'one.two.three.deepValue', value: 'Deep' },
      ]);
    });
    it('should skip non-string leaf values', () => {
      expect(extractFromHierarchical({ common: { title: 'Title', count: 42, items: ['a'], empty: null } })).toEqual([
        { key: 'common.title', value: 'Title' },
      ]);
    });
    it('should handle empty object', () => expect(extractFromHierarchical({})).toEqual([]));
    it('should handle single level structure', () => {
      expect(extractFromHierarchical({ title: 'Title', description: 'Description' })).toEqual([
        { key: 'title', value: 'Title' },
        { key: 'description', value: 'Description' },
      ]);
    });
    it('should extract rich format objects from hierarchical structure', () => {
      expect(
        extractFromHierarchical({ common: { title: { value: 'Título', comment: 'Page title', tags: ['ui'] } } }),
      ).toEqual([{ key: 'common.title', value: 'Título', comment: 'Page title', tags: ['ui'] }]);
    });
    it('should handle mix of simple and rich formats in hierarchy', () => {
      expect(
        extractFromHierarchical({ common: { title: 'Título', ok: { value: 'Aceptar', comment: 'OK button' } } }),
      ).toEqual([
        { key: 'common.title', value: 'Título' },
        { key: 'common.ok', value: 'Aceptar', comment: 'OK button' },
      ]);
    });
  });

  describe('parseJsonImport', () => {
    it('throws when the source file is missing', () => {
      expect(() => parseJsonImport(join(dir, 'missing.json'))).toThrow(
        `Source file not found: ${join(dir, 'missing.json')}`,
      );
    });
    it('throws when JSON is malformed', () => {
      const path = join(dir, 'bad.json');
      writeFileSync(path, '{bad');
      expect(() => parseJsonImport(path)).toThrow('Failed to parse JSON file:');
    });
    it('parses a flat file and reports progress', () => {
      const path = join(dir, 'flat.json');
      writeFileSync(path, JSON.stringify({ 'common.ok': 'Aceptar', 'common.cancel': 'Cancelar' }));
      const onProgress = vi.fn();
      expect(parseJsonImport(path, { onProgress })).toEqual([
        { key: 'common.ok', value: 'Aceptar' },
        { key: 'common.cancel', value: 'Cancelar' },
      ]);
      expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
        `Reading JSON file: ${path}`,
        'Detected flat JSON structure',
        'Extracted 2 resources from JSON',
      ]);
    });
    it('parses a hierarchical file', () => {
      const path = join(dir, 'tree.json');
      writeFileSync(path, JSON.stringify({ common: { ok: 'Aceptar' } }));
      expect(parseJsonImport(path)).toEqual([{ key: 'common.ok', value: 'Aceptar' }]);
    });
    it('parses rich objects', () => {
      const path = join(dir, 'rich.json');
      writeFileSync(path, JSON.stringify({ 'common.ok': { value: 'Aceptar', baseValue: 'OK', tags: ['ui'] } }));
      expect(parseJsonImport(path)).toEqual([{ key: 'common.ok', value: 'Aceptar', baseValue: 'OK', tags: ['ui'] }]);
    });
  });
});
