import { describe, expect, it } from 'vitest';
import { type CollectionFolderProblem, describeFolderProblem } from './collection-folders';

describe('describeFolderProblem', () => {
  it.each<{
    kind: CollectionFolderProblem['kind'];
    folderPath: string;
    collectionName?: string;
    expected: string;
  }>([
    { kind: 'unreadable', folderPath: 'apps.common', expected: "Skipped unreadable folder 'apps.common': bad JSON" },
    { kind: 'unreadable', folderPath: '', expected: "Skipped unreadable folder '(root)': bad JSON" },
    { kind: 'not-removed', folderPath: 'apps.empty', expected: "Could not remove folder 'apps.empty': bad JSON" },
    {
      kind: 'unreadable',
      folderPath: 'apps',
      collectionName: 'main',
      expected: "Collection 'main': Skipped unreadable folder 'apps': bad JSON",
    },
    {
      kind: 'unreadable',
      folderPath: '',
      collectionName: 'main',
      expected: "Collection 'main': Skipped unreadable folder '(root)': bad JSON",
    },
    {
      kind: 'not-removed',
      folderPath: 'apps.empty',
      collectionName: 'main',
      expected: "Collection 'main': Could not remove folder 'apps.empty': bad JSON",
    },
  ])('$kind at "$folderPath" (collection: $collectionName)', ({ kind, folderPath, collectionName, expected }) => {
    const problem: CollectionFolderProblem = { kind, folderPath, absolutePath: '/unused', message: 'bad JSON' };
    expect(describeFolderProblem(problem, { collectionName })).toBe(expected);
  });
});
