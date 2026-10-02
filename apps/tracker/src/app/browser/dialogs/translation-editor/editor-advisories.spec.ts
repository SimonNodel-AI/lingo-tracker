import { signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import type { LingoTrackerConfigDto, SearchResultDto } from '@simoncodes-ca/data-transfer';
import { EMPTY, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimilarSuggestion } from '../../services/similar-values';
import {
  EditorAdvisories,
  exactSimilarMatch,
  filteredEditorTagSuggestions,
  PREFERRED_TERM_DEBOUNCE_MS,
} from './editor-advisories';

describe('EditorAdvisories', () => {
  afterEach(() => vi.useRealTimers());
  const config = (preferredTerminologyError?: string): LingoTrackerConfigDto => ({
    exportFolder: '',
    importFolder: '',
    baseLocale: 'en',
    locales: ['en'],
    collections: {},
    preferredTerminology: [{ discouraged: 'Expenditure', preferred: 'Investment' }],
    preferredTerminologyError,
  });
  const hit = (fullKey: string, value: string): SearchResultDto => ({
    fullKey,
    folderPath: '',
    entryKey: fullKey,
    base: { locale: 'en', value },
    targets: [],
    tags: [],
    inheritedTags: [],
    matchType: 'similar-value',
  });

  it('finds preferred terms from loaded rules', () => {
    const advisories = new EditorAdvisories(signal(config()));
    advisories.observe('Expenditure', EMPTY, EMPTY);
    expect(advisories.preferredTermFindings()).toHaveLength(1);
    advisories.destroy();
  });

  it('suppresses findings when the rule file failed to load', () => {
    const advisories = new EditorAdvisories(signal(config('Invalid JSON')));
    advisories.observe('Expenditure', EMPTY, EMPTY);
    expect(advisories.preferredTermFindings()).toEqual([]);
    advisories.destroy();
  });

  it('applies a preferred term and checks the replacement immediately', () => {
    const advisories = new EditorAdvisories(signal(config()));
    const control = new FormControl('Expenditure', { nonNullable: true });
    advisories.observe(control.value, control.valueChanges, EMPTY);
    advisories.applyTerm(control, { discouraged: 'Expenditure', preferred: 'Investment' });
    expect(control.value).toBe('Investment');
    expect(control.dirty).toBe(true);
    expect(advisories.preferredTermFindings()).toEqual([]);
    advisories.destroy();
  });

  it('clears pinned hits while retaining the spinner for an eligible query', () => {
    const advisories = new EditorAdvisories(signal(config()));
    const suggestions = new Subject<SimilarSuggestion>();
    advisories.observe('', EMPTY, suggestions);
    suggestions.next({ kind: 'ready', results: [hit('first', 'Value')] });
    suggestions.next({ kind: 'clear', searching: true });
    expect(advisories.similarResources()).toEqual([]);
    suggestions.next({ kind: 'loading' });
    expect(advisories.isSearchingSimilar()).toBe(true);
    suggestions.next({ kind: 'clear', searching: true });
    expect(advisories.isSearchingSimilar()).toBe(true);
    suggestions.next({ kind: 'ready', results: [] });
    expect(advisories.isSearchingSimilar()).toBe(false);
    advisories.destroy();
  });

  it('stops searching when a query is ineligible', () => {
    const advisories = new EditorAdvisories(signal(config()));
    const suggestions = new Subject<SimilarSuggestion>();
    advisories.observe('', EMPTY, suggestions);
    suggestions.next({ kind: 'loading' });
    suggestions.next({ kind: 'clear', searching: false });
    expect(advisories.isSearchingSimilar()).toBe(false);
    advisories.destroy();
  });

  it('finds an exact value ignoring surrounding space and case', () => {
    expect(
      exactSimilarMatch(' clear search ', [hit('first', 'Clear All'), hit('second', ' Clear Search ')])?.fullKey,
    ).toBe('second');
    expect(exactSimilarMatch('  ', [hit('first', '')])).toBeUndefined();
  });

  it('filters used and inherited tags using the typed substring', () => {
    expect(filteredEditorTagSuggestions('BRO', ['browser'], ['broad'], ['browser', 'broad', 'browse', 'ui'])).toEqual([
      'browse',
    ]);
  });

  it('returns no exact match when every hit differs', () => {
    expect(exactSimilarMatch('Clear Search', [hit('first', 'Clear All')])).toBeUndefined();
  });

  it('has no preferred findings without a loaded config', () => {
    const advisories = new EditorAdvisories(signal(null));
    advisories.observe('Expenditure', EMPTY, EMPTY);
    expect(advisories.preferredTermFindings()).toEqual([]);
    advisories.destroy();
  });

  it('observes typed values immediately and checks preferred terms after the pause', () => {
    vi.useFakeTimers();
    const advisories = new EditorAdvisories(signal(config()));
    const values = new Subject<string>();
    advisories.observe('', values, EMPTY);
    values.next(' Expenditure ');
    expect(advisories.baseValueText()).toBe(' Expenditure ');
    expect(advisories.baseValueLength()).toBe(11);
    expect(advisories.preferredTermFindings()).toEqual([]);
    vi.advanceTimersByTime(PREFERRED_TERM_DEBOUNCE_MS - 1);
    expect(advisories.preferredTermFindings()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(advisories.preferredTermFindings()).toHaveLength(1);
    advisories.destroy();
  });

  it('tears down typed-value, debounce and similar-search subscriptions', () => {
    vi.useFakeTimers();
    const advisories = new EditorAdvisories(signal(config()));
    const values = new Subject<string>();
    const suggestions = new Subject<SimilarSuggestion>();
    advisories.observe('', values, suggestions);
    values.next('Expenditure');
    suggestions.next({ kind: 'loading' });
    advisories.destroy();
    values.next('Other');
    suggestions.next({ kind: 'ready', results: [hit('first', 'Other')] });
    vi.advanceTimersByTime(PREFERRED_TERM_DEBOUNCE_MS);
    expect(advisories.baseValueText()).toBe('Expenditure');
    expect(advisories.preferredTermFindings()).toEqual([]);
    expect(advisories.similarResources()).toEqual([]);
    expect(advisories.isSearchingSimilar()).toBe(true);
  });
});
