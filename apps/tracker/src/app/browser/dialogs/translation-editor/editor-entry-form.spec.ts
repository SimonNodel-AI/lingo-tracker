import type { ResourceSummaryDto } from '@simoncodes-ca/data-transfer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorEntryForm } from './editor-entry-form';

describe('EditorEntryForm', () => {
  let form: EditorEntryForm;
  const resource = (overrides: Partial<ResourceSummaryDto> = {}): ResourceSummaryDto => ({
    fullKey: 'common.buttons.existing_key',
    folderPath: 'common.buttons',
    entryKey: 'existing_key',
    base: { locale: 'en', value: 'Existing Value' },
    targets: [
      { locale: 'fr', value: 'Valeur existante', status: 'translated', needsWork: false, sameAsBase: false },
      { locale: 'de', value: 'Vorhandener Wert', status: 'verified', needsWork: false, sameAsBase: false },
    ],
    tags: ['ui'],
    inheritedTags: [],
    ...overrides,
  });

  beforeEach(() => {
    form = new EditorEntryForm();
  });
  afterEach(() => form.destroy());

  it('should initialize form controls for all non-base locales', () => {
    form.seed(['en', 'fr', 'de'], 'en', undefined, '');
    expect(form.form.controls.translations.controls.map((control) => control.value.locale)).toEqual(['fr', 'de']);
  });

  it('should initialize all locale controls with empty values in create mode', () => {
    form.seed(['en', 'fr', 'de'], 'en', undefined, '');
    expect(form.localeSummaries()).toEqual([
      { locale: 'fr', value: '', status: 'new' },
      { locale: 'de', value: '', status: 'new' },
    ]);
  });

  it('should not require comment field', () => {
    form.form.controls.comment.setValue('');
    expect(form.form.controls.comment.valid).toBe(true);
  });

  it('should accept any comment value', () => {
    form.form.controls.comment.setValue('This is a comment for translators');
    expect(form.form.controls.comment.valid).toBe(true);
  });

  it('should pre-populate form with resource data', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource({ comment: 'Existing comment' }), 'common.buttons');
    expect(form.form.getRawValue()).toMatchObject({
      key: 'existing_key',
      baseValue: 'Existing Value',
      comment: 'Existing comment',
    });
    expect(form.tags()).toEqual(['ui']);
  });

  it('should handle missing base locale translation', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource({ base: { locale: 'en', value: '' } }), 'common.buttons');
    expect(form.form.controls.baseValue.value).toBe('');
  });

  it('should handle missing comment', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    expect(form.form.controls.comment.value).toBe('');
  });

  it('should pre-populate other locale translations in edit mode', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    expect(form.localeSummaries()).toEqual([
      { locale: 'fr', value: 'Valeur existante', status: 'translated' },
      { locale: 'de', value: 'Vorhandener Wert', status: 'verified' },
    ]);
  });

  it('uses the missing-metadata status for an absent target', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource({ targets: [] }), 'common.buttons');
    expect(form.localeSummaries()).toEqual([
      { locale: 'fr', value: '', status: 'new' },
      { locale: 'de', value: '', status: 'new' },
    ]);
  });

  it('counts only new and stale locale rows', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    form.form.controls.translations.at(0).controls.status.setValue('stale');
    expect(form.localesNeedingWork().map((locale) => locale.locale)).toEqual(['fr']);
    expect(form.needWorkCount()).toBe(1);
  });

  it('keeps the raw draft available when the form is disabled', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    form.form.disable({ emitEvent: false });
    expect(form.draft('common.buttons').translations).toHaveLength(2);
  });

  it('treats a typed-back field as unsaved work', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    form.form.controls.comment.setValue('changed');
    form.form.controls.comment.markAsDirty();
    form.form.controls.comment.setValue('');
    expect(form.hasUnsavedChanges('common.buttons')).toBe(true);
  });

  it('publishes a silent key write to the form snapshot', () => {
    form.seed(['en', 'fr', 'de'], 'en', undefined, '');
    form.form.controls.key.setValue('leaf', { emitEvent: false });
    form.publishSnapshot();
    expect(form.formState().key).toBe('leaf');
  });

  it('builds the complete draft from seeded fields, tags, folder and locale rows', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource({ comment: 'For translators' }), 'common.buttons');
    expect(form.draft('common.buttons')).toEqual({
      key: 'existing_key',
      baseValue: 'Existing Value',
      comment: 'For translators',
      folderPath: 'common.buttons',
      tags: ['ui'],
      translations: [
        { locale: 'fr', value: 'Valeur existante', status: 'translated' },
        { locale: 'de', value: 'Vorhandener Wert', status: 'verified' },
      ],
    });
  });

  it('has no unsaved changes right after seeding', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    expect(form.hasUnsavedChanges('common.buttons')).toBe(false);
  });

  it('detects an added or removed tag as unsaved work', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    form.addTag('browser');
    expect(form.tags()).toEqual(['ui', 'browser']);
    expect(form.hasUnsavedChanges('common.buttons')).toBe(true);
    form.removeTag('browser', []);
    expect(form.hasUnsavedChanges('common.buttons')).toBe(false);
    form.removeTag('ui', []);
    expect(form.hasUnsavedChanges('common.buttons')).toBe(true);
  });

  it('detects a folder-path change as unsaved work', () => {
    form.seed(['en', 'fr', 'de'], 'en', resource(), 'common.buttons');
    expect(form.hasUnsavedChanges('common.labels')).toBe(true);
  });
});
