import { describe, expect, it } from 'vitest';
import { bundleOutputPreview, bundlePlannedOutputPreview } from './bundle-output-preview';

const draft = {
  dist: './dist/i18n',
  bundleName: 'admin.{locale}',
  typesEnabled: false,
  typeDistFile: '',
};
const locales = ['en', 'fr'];

describe('bundleOutputPreview', () => {
  it('previews bundle files at the root when dist is empty', () => {
    const preview = bundleOutputPreview({ draft: { ...draft, dist: '' }, locales: ['en'] });
    expect(preview.outputSummary).toBe('admin.{locale}.json');
    expect(preview.folders).toEqual([
      {
        path: '',
        pathParts: [],
        files: [{ name: 'admin.en.json', nameParts: ['admin.', 'en.', 'json'], kind: 'bundle', exists: undefined }],
      },
    ]);
  });

  it('returns no bundle files without a pattern', () => {
    const preview = bundleOutputPreview({ draft: { ...draft, dist: '', bundleName: ' ' }, locales });
    expect(preview).toEqual({ outputSummary: '', patternFiles: [], typeFileName: '', folders: [] });
  });

  it('strips dot slash and normalizes bundle output separators', () => {
    const preview = bundleOutputPreview({ draft: { ...draft, dist: ' ./dist//i18n/ ' }, locales: ['en'] });
    expect(preview.outputSummary).toBe('dist/i18n/admin.{locale}.json');
    expect(preview.folders[0]?.path).toBe('dist/i18n');
    expect(preview.folders[0]?.pathParts).toEqual(['dist/', 'i18n']);
  });

  it('adds a type file in a nested directory with wrapping segments', () => {
    const preview = bundleOutputPreview({
      draft: { ...draft, typesEnabled: true, typeDistFile: ' ./dist/types/admin_tokens-v2.ts ' },
      locales: ['en'],
    });
    expect(preview.typeFileName).toBe('admin_tokens-v2.ts');
    expect(preview.folders[1]).toEqual({
      path: 'dist/types',
      pathParts: ['dist/', 'types'],
      files: [
        {
          name: 'admin_tokens-v2.ts',
          nameParts: ['admin_', 'tokens-', 'v2.', 'ts'],
          kind: 'types',
          exists: undefined,
        },
      ],
    });
  });

  it('omits a hidden type path and a blank enabled type path', () => {
    for (const choices of [
      { typesEnabled: false, typeDistFile: './types.ts' },
      { typesEnabled: true, typeDistFile: ' ' },
    ]) {
      const preview = bundleOutputPreview({ draft: { ...draft, ...choices }, locales: [] });
      expect(preview.folders).toEqual([]);
      expect(preview.typeFileName).toBe('');
    }
  });

  it('uses echoed plan paths and preserves existing-file flags and order', () => {
    const plan = {
      files: [
        { path: './planned/admin.fr.json', kind: 'bundle' as const, exists: false, keysCount: 2, locale: 'fr' },
        { path: './planned/admin.en.json', kind: 'bundle' as const, exists: true, keysCount: 3, locale: 'en' },
        { path: './planned/types/admin.ts/', kind: 'types' as const, exists: true, keysCount: 3 },
      ],
    };
    const before = structuredClone(plan);
    const preview = bundleOutputPreview({ draft, locales, plan });
    expect(preview.folders.map((folder) => ({ path: folder.path, files: folder.files }))).toEqual([
      {
        path: 'planned',
        files: [
          { name: 'admin.fr.json', nameParts: ['admin.', 'fr.', 'json'], kind: 'bundle', exists: false },
          { name: 'admin.en.json', nameParts: ['admin.', 'en.', 'json'], kind: 'bundle', exists: true },
        ],
      },
      {
        path: 'planned/types',
        files: [{ name: 'admin.ts', nameParts: ['admin.', 'ts'], kind: 'types', exists: true }],
      },
    ]);
    expect(bundlePlannedOutputPreview(plan)).toEqual(preview.folders);
    expect(plan).toEqual(before);
    expect(preview.outputSummary).toBe('dist/i18n/admin.{locale}.json');
    expect(preview.patternFiles).toEqual(['admin.en.json', 'admin.fr.json']);
  });

  it('keeps an empty plan instead of falling back to draft paths', () => {
    expect(bundleOutputPreview({ draft, locales, plan: { files: [] } }).folders).toEqual([]);
  });

  it('projects a plan without draft values or locales', () => {
    expect(bundlePlannedOutputPreview({ files: [] })).toEqual([]);
  });

  it('expands multiple locales into nested folders in locale order', () => {
    const preview = bundleOutputPreview({ draft: { ...draft, bundleName: ' {locale}/admin ' }, locales });
    expect(preview.patternFiles).toEqual(['en/admin.json', 'fr/admin.json']);
    expect(
      preview.folders.map((folder) => ({ path: folder.path, names: folder.files.map((file) => file.name) })),
    ).toEqual([
      { path: 'dist/i18n/en', names: ['admin.json'] },
      { path: 'dist/i18n/fr', names: ['admin.json'] },
    ]);
  });
});
