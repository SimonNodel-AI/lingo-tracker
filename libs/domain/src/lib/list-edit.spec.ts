import { describe, expect, it } from 'vitest';
import { listEditProblem, mergeListEdit } from './list-edit';

const normalize = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

describe('list edit', () => {
  it('reports a set conflict and a missing edit', () => {
    expect(listEditProblem({ set: 'A', add: ['B'] })).toBe('conflict');
    expect(listEditProblem({ set: '', remove: ['B'] })).toBe('conflict');
    expect(listEditProblem({})).toBe('missing');
    expect(listEditProblem({ set: '' })).toBeUndefined();
  });

  it('adds unique values, removes matches, and keeps the remaining order', () => {
    expect(mergeListEdit(['A', 'B'], { add: [' B ', 'C'], remove: [' A '] }, normalize)).toEqual(['B', 'C']);
  });

  it('replaces a list after caller normalization', () => {
    expect(mergeListEdit(['A'], { set: ' B, C, B ' }, normalize)).toEqual(['B', 'C']);
  });
});
