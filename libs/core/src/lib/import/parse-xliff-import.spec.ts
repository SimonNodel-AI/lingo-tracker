import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFromXliff, parseXliffImport } from './parse-xliff-import';

const document = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="es" datatype="plaintext" original="messages"><body>${body}</body></file>
</xliff>`;

describe('parse XLIFF import', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lingo-parse-xliff-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('extractFromXliff', () => {
    it('should extract resources from valid XLIFF 1.2', async () => {
      const resources = await extractFromXliff(
        document(
          '<trans-unit id="common.ok"><source>OK</source><target>Aceptar</target></trans-unit>' +
            '<trans-unit id="common.cancel"><source>Cancel</source><target>Cancelar</target><note>Cancel button</note></trans-unit>',
        ),
      );
      expect(resources).toEqual([
        { key: 'common.ok', value: 'Aceptar', baseValue: 'OK' },
        { key: 'common.cancel', value: 'Cancelar', baseValue: 'Cancel', comment: 'Cancel button' },
      ]);
    });
    it('should skip trans-units with empty targets', async () => {
      const resources = await extractFromXliff(
        document(
          '<trans-unit id="common.title"><source>Title</source><target>Título</target></trans-unit>' +
            '<trans-unit id="common.empty"><source>Empty</source><target></target></trans-unit>' +
            '<trans-unit id="common.missing"><source>Missing</source></trans-unit>',
        ),
      );
      expect(resources).toEqual([{ key: 'common.title', value: 'Título', baseValue: 'Title' }]);
    });
    it('should handle XLIFF with notes', async () => {
      const resources = await extractFromXliff(
        document(
          '<trans-unit id="app.welcome"><source>Welcome</source><target>Bienvenue</target><note>Greeting</note></trans-unit>',
        ),
      );
      expect(resources[0]?.comment).toBe('Greeting');
    });
    it('should throw error for invalid XLIFF', async () => {
      await expect(extractFromXliff('not XML')).rejects.toThrow('Failed to parse XLIFF content');
    });
  });

  describe('parseXliffImport', () => {
    it('throws when the source file is missing', async () => {
      const path = join(dir, 'missing.xliff');
      await expect(parseXliffImport(path)).rejects.toThrow(`Source file not found: ${path}`);
    });
    it('throws for invalid XLIFF content', async () => {
      const path = join(dir, 'bad.xliff');
      writeFileSync(path, 'not XML');
      await expect(parseXliffImport(path)).rejects.toThrow('Failed to parse XLIFF content');
    });
    it('reads a real file and reports progress', async () => {
      const path = join(dir, 'messages.xliff');
      writeFileSync(
        path,
        document('<trans-unit id="common.ok"><source>OK</source><target>Aceptar</target></trans-unit>'),
      );
      const onProgress = vi.fn();
      await expect(parseXliffImport(path, { onProgress })).resolves.toEqual([
        { key: 'common.ok', value: 'Aceptar', baseValue: 'OK' },
      ]);
      expect(onProgress.mock.calls.map(([message]) => message)).toEqual([
        `Reading XLIFF file: ${path}`,
        'Parsing XLIFF and extracting trans-units',
        'Extracted 1 resources from XLIFF',
      ]);
    });
  });
});
