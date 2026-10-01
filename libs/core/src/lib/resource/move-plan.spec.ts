import { describe, expect, it } from 'vitest';
import { type MoveSelection, planMove } from './move-plan';

describe('Move Plan', () => {
  const cases: readonly {
    name: string;
    selection: MoveSelection;
    destination: string;
    expected: readonly { from: string; to: string }[];
  }[] = [
    {
      name: 'nests same-depth folders when requested',
      selection: { kind: 'folder', path: 'testdata', keys: ['testdata.foo'], nestUnderDestination: true },
      destination: 'common',
      expected: [{ from: 'testdata.foo', to: 'common.testdata.foo' }],
    },
    {
      name: 'nests different-depth folders when requested',
      selection: { kind: 'folder', path: 'data.testdata', keys: ['data.testdata.foo'], nestUnderDestination: true },
      destination: 'common',
      expected: [{ from: 'data.testdata.foo', to: 'common.testdata.foo' }],
    },
    {
      name: 'nests a folder at the collection root',
      selection: { kind: 'folder', path: 'common.testdata', keys: ['common.testdata.foo'], nestUnderDestination: true },
      destination: '',
      expected: [{ from: 'common.testdata.foo', to: 'testdata.foo' }],
    },
    {
      name: 'nests at the root even when legacy rename mode is requested',
      selection: {
        kind: 'folder',
        path: 'common.testdata',
        keys: ['common.testdata.foo'],
        nestUnderDestination: false,
      },
      destination: '',
      expected: [{ from: 'common.testdata.foo', to: 'testdata.foo' }],
    },
    {
      name: 'preserves nested resource suffixes',
      selection: { kind: 'folder', path: 'testdata', keys: ['testdata.foo.bar'], nestUnderDestination: true },
      destination: 'common',
      expected: [{ from: 'testdata.foo.bar', to: 'common.testdata.foo.bar' }],
    },
    {
      name: 'uses the legacy same-depth rename heuristic',
      selection: { kind: 'folder', path: 'testdata', keys: ['testdata.foo'], nestUnderDestination: false },
      destination: 'common',
      expected: [{ from: 'testdata.foo', to: 'common.foo' }],
    },
    {
      name: 'uses the legacy different-depth nesting heuristic',
      selection: { kind: 'folder', path: 'data.testdata', keys: ['data.testdata.foo'], nestUnderDestination: false },
      destination: 'common',
      expected: [{ from: 'data.testdata.foo', to: 'common.testdata.foo' }],
    },
    {
      name: 'preserves the legacy nested folder mapping',
      selection: {
        kind: 'folder',
        path: 'apps.common.buttons',
        keys: ['apps.common.buttons.ok'],
        nestUnderDestination: false,
      },
      destination: 'apps.shared',
      expected: [{ from: 'apps.common.buttons.ok', to: 'apps.shared.buttons.ok' }],
    },
    {
      name: 'defaults to nesting',
      selection: { kind: 'folder', path: 'testdata', keys: ['testdata.foo'] },
      destination: 'common',
      expected: [{ from: 'testdata.foo', to: 'common.testdata.foo' }],
    },
    {
      name: 'plans every key in a folder',
      selection: { kind: 'folder', path: 'apps.buttons', keys: ['apps.buttons.ok', 'apps.buttons.nested.cancel'] },
      destination: 'shared',
      expected: [
        { from: 'apps.buttons.ok', to: 'shared.buttons.ok' },
        { from: 'apps.buttons.nested.cancel', to: 'shared.buttons.nested.cancel' },
      ],
    },
    {
      name: 'renames to the same path in another collection',
      selection: {
        kind: 'folder',
        path: 'apps.buttons',
        keys: ['apps.buttons.ok'],
        sameCollection: false,
        nestUnderDestination: false,
      },
      destination: 'apps.buttons',
      expected: [{ from: 'apps.buttons.ok', to: 'apps.buttons.ok' }],
    },
    {
      name: 'moves one resource key',
      selection: { kind: 'key', key: 'common.ok' },
      destination: 'shared.ok',
      expected: [{ from: 'common.ok', to: 'shared.ok' }],
    },
    {
      name: 'expands a resource pattern under the destination',
      selection: { kind: 'pattern', prefix: 'common', keys: ['common.ok', 'common.nested.cancel'] },
      destination: 'shared',
      expected: [
        { from: 'common.ok', to: 'shared.ok' },
        { from: 'common.nested.cancel', to: 'shared.nested.cancel' },
      ],
    },
    {
      name: 'expands a root resource pattern',
      selection: { kind: 'pattern', prefix: '', keys: ['common.ok'] },
      destination: '',
      expected: [{ from: 'common.ok', to: 'common.ok' }],
    },
    {
      name: 'moves a root resource pattern under a prefix',
      selection: { kind: 'pattern', prefix: '', keys: ['common.ok'] },
      destination: 'shared',
      expected: [{ from: 'common.ok', to: 'shared.common.ok' }],
    },
    {
      name: 'moves a prefixed resource pattern to the root',
      selection: { kind: 'pattern', prefix: 'common', keys: ['common.ok'] },
      destination: '',
      expected: [{ from: 'common.ok', to: 'ok' }],
    },
    {
      name: 'moves an edited entry to another folder',
      selection: { kind: 'entry', key: 'common.save' },
      destination: 'dialogs.actions',
      expected: [{ from: 'common.save', to: 'dialogs.actions.save' }],
    },
    {
      name: 'moves an edited entry to the root',
      selection: { kind: 'entry', key: 'common.save' },
      destination: '',
      expected: [{ from: 'common.save', to: 'save' }],
    },
    {
      name: 'moves an edited entry to the root for a blank destination',
      selection: { kind: 'entry', key: 'common.save' },
      destination: '   ',
      expected: [{ from: 'common.save', to: 'save' }],
    },
  ];

  it.each(cases)('$name', ({ selection, destination, expected }) => {
    expect(planMove(selection, destination)).toEqual({ relocations: expected, warnings: [] });
  });

  it('warns for a same-folder move in the same collection', () => {
    expect(planMove({ kind: 'folder', path: 'apps.buttons', keys: ['apps.buttons.ok'] }, 'apps.buttons')).toEqual({
      relocations: [],
      warnings: ['Source and destination are the same. No move performed.'],
    });
  });

  it('warns for nesting a folder under its own parent', () => {
    expect(planMove({ kind: 'folder', path: 'apps.buttons', keys: ['apps.buttons.ok'] }, 'apps')).toEqual({
      relocations: [],
      warnings: ['Folder is already at this location. No move performed.'],
    });
  });

  it('warns for moving a top-level folder to the root', () => {
    expect(planMove({ kind: 'folder', path: 'apps', keys: ['apps.ok'] }, '')).toEqual({
      relocations: [],
      warnings: ['Folder is already at this location. No move performed.'],
    });
  });
});
