import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import type { BundleDefinitionDto, BundleDryRunResultDto, LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTranslocoTestingModule } from '../../../testing/transloco-testing.module';
import { CollectionsApiService } from '../services/collections-api.service';
import { CollectionsStore } from '../store/collections.store';
import { BundleFormDialog } from './bundle-form-dialog';
import type { BundleFormDialogData } from './bundle-form-dialog-data';

const config: LingoTrackerConfigDto = {
  exportFolder: './export',
  importFolder: './import',
  baseLocale: 'en',
  locales: ['en', 'fr-ca', 'es'],
  collections: {
    trackerResources: { translationsFolder: './apps/tracker/src/i18n' },
    mockDesignSystem: { translationsFolder: './libs/ds/i18n' },
    TestDataPlayground: { translationsFolder: './tmp/i18n' },
  },
};

const trackerBundle: BundleDefinitionDto = {
  bundleName: '{locale}',
  dist: './apps/tracker/src/assets/i18n',
  collections: [{ name: 'trackerResources', entriesSelectionRules: 'All' }],
  typeDistFile: './apps/tracker/src/i18n-types/tracker-resources.ts',
  transformICUToTransloco: true,
};

const dryRunResult: BundleDryRunResultDto = {
  name: 'admin',
  locales: ['en', 'fr-ca', 'es'],
  files: [
    { path: 'dist/i18n/admin.en.json', kind: 'bundle', locale: 'en', exists: false, keysCount: 12 },
    { path: 'dist/i18n/admin.fr-ca.json', kind: 'bundle', locale: 'fr-ca', exists: false, keysCount: 12 },
    { path: 'dist/i18n/admin.es.json', kind: 'bundle', locale: 'es', exists: true, keysCount: 12 },
  ],
  keysPerLocale: { en: 12, 'fr-ca': 12, es: 12 },
  conflictsCount: 0,
  conflictKeys: [],
  hierarchicalConflicts: [],
  exampleKey: { collectionName: 'trackerResources', sourceKey: 'a.b', bundledKey: 'a.b' },
  warnings: [],
};

interface Harness {
  fixture: ComponentFixture<BundleFormDialog>;
  component: BundleFormDialog;
  dialogRef: { close: ReturnType<typeof vi.fn> };
  api: { dryRunBundle: ReturnType<typeof vi.fn> };
}

const buildTestBed = async (data: BundleFormDialogData): Promise<Harness> => {
  const dialogRef = { close: vi.fn() };
  const api = { dryRunBundle: vi.fn().mockReturnValue(of(dryRunResult)) };
  const store = {
    config: signal<LingoTrackerConfigDto | null>(config),
    collectionEntries: signal(
      Object.entries(config.collections).map(([name, collection]) => ({ name, config: collection })),
    ),
    bundleEntries: signal([{ name: 'tracker', definition: trackerBundle }]),
  };

  await TestBed.configureTestingModule({
    imports: [BundleFormDialog, NoopAnimationsModule, getTranslocoTestingModule()],
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: dialogRef },
      { provide: CollectionsApiService, useValue: api },
      { provide: CollectionsStore, useValue: store },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(BundleFormDialog);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, dialogRef, api };
};

const fillOutput = (component: BundleFormDialog): void => {
  component.form.controls.name.setValue('admin');
  component.form.controls.dist.setValue('./dist/i18n');
  component.form.controls.bundleName.setValue('admin.{locale}');
};

describe('BundleFormDialog — create mode', () => {
  let harness: Harness;
  let component: BundleFormDialog;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    harness = await buildTestBed({ mode: 'create' });
    component = harness.component;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.isEditMode).toBe(false);
  });

  it('should start with the first collection pane open, seeded with the first collection', () => {
    expect(component.form.controls.collections.length).toBe(1);
    expect(component.form.controls.collections.at(0).controls.name.value).toBe('trackerResources');
    expect(component.activeSection()).toBe('coll:0');
    expect(component.activeKind()).toBe('collection');
  });

  it('should open the Collections pane when the bundle includes every collection', async () => {
    TestBed.resetTestingModule();
    const built = await buildTestBed({
      mode: 'create',
      bundle: { bundleName: '{locale}', dist: './dist', collections: 'All' },
    });
    expect(built.component.activeSection()).toBe('collections');
    expect(built.component.form.controls.collections.length).toBe(0);
  });

  it('should keep the name editable', () => {
    expect(component.form.controls.name.disabled).toBe(false);
  });

  it('should reject a name that collides with an existing bundle', () => {
    component.form.controls.name.setValue('tracker');
    expect(component.form.controls.name.hasError('nameExists')).toBe(true);

    component.form.controls.name.setValue('admin');
    expect(component.form.controls.name.errors).toBeNull();
  });

  it('should reject names outside the letters, numbers, hyphens and underscores charset', () => {
    component.form.controls.name.setValue('my bundle!');
    expect(component.form.controls.name.hasError('pattern')).toBe(true);
  });

  it('should require {locale} in the file name pattern', () => {
    component.form.controls.bundleName.setValue('admin');
    expect(component.form.controls.bundleName.hasError('missingLocale')).toBe(true);

    component.form.controls.bundleName.setValue('admin.{locale}');
    expect(component.form.controls.bundleName.errors).toBeNull();
  });

  it('should require a .ts type file only while types are on', () => {
    const typeFile = component.form.controls.typeDistFile;
    expect(typeFile.errors).toBeNull();

    component.form.controls.typesEnabled.setValue(true);
    expect(typeFile.hasError('required')).toBe(true);

    typeFile.setValue('./dist/types/admin.js');
    expect(typeFile.hasError('notTypeScript')).toBe(true);

    typeFile.setValue('./dist/types/admin.ts');
    expect(typeFile.errors).toBeNull();

    typeFile.setValue('./dist/types/admin.js');
    component.form.controls.typesEnabled.setValue(false);
    expect(typeFile.errors).toBeNull();
  });

  it('should require a valid JavaScript identifier for the constant name', () => {
    const constant = component.form.controls.tokenConstantName;
    constant.setValue('1BAD');
    expect(constant.hasError('invalidIdentifier')).toBe(true);

    constant.setValue('ADMIN_TOKENS');
    expect(constant.errors).toBeNull();

    constant.setValue('');
    expect(constant.errors).toBeNull();
  });

  it('should reject reserved words the server would reject, so the dialog never closes on a 400', () => {
    const constant = component.form.controls.tokenConstantName;

    for (const reserved of ['type', 'class', 'interface', 'await', 'undefined']) {
      constant.setValue(reserved);
      expect(constant.hasError('invalidIdentifier')).toBe(true);
    }

    constant.setValue('typeTokens');
    expect(constant.errors).toBeNull();
  });

  it('should require at least one collection unless every collection is included', () => {
    component.removeCollection(0);
    expect(component.form.controls.collections.hasError('collectionsEmpty')).toBe(true);
    expect(component.activeSection()).toBe('collections');

    component.form.controls.allCollections.setValue(true);
    expect(component.form.controls.collections.errors).toBeNull();
  });

  it('should require at least one rule unless the collection takes all entries', () => {
    const group = component.form.controls.collections.at(0);
    expect(group.controls.rules.errors).toBeNull();

    group.controls.allEntries.setValue(false);
    expect(group.controls.rules.hasError('rulesEmpty')).toBe(true);

    component.addRule(group);
    expect(group.controls.rules.errors).toBeNull();
    expect(group.controls.rules.at(0).controls.matchingPattern.hasError('required')).toBe(true);

    component.removeRule(group, 0);
    expect(group.controls.rules.hasError('rulesEmpty')).toBe(true);
  });

  it('should add a collection from the remaining ones and open its pane', () => {
    expect(component.availableCollections()).toEqual(['mockDesignSystem', 'TestDataPlayground']);

    component.addCollection('mockDesignSystem');

    expect(component.form.controls.collections.length).toBe(2);
    expect(component.activeSection()).toBe('coll:1');
    expect(component.availableCollections()).toEqual(['TestDataPlayground']);
  });

  it('should flag an invalid section in the rail once it has been touched', () => {
    expect(component.sectionErrors().has('output')).toBe(false);

    component.form.controls.bundleName.setValue('admin');
    component.form.controls.bundleName.markAsTouched();

    expect(component.sectionErrors().has('output')).toBe(true);
  });

  it('should add, normalize and remove rule tags and toggle the operator', () => {
    const group = component.form.controls.collections.at(0);
    group.controls.allEntries.setValue(false);
    component.addRule(group);
    const rule = group.controls.rules.at(0);
    const input = { value: ' Admin UI ' } as HTMLInputElement;

    component.commitTagInput(rule, input);
    expect(rule.controls.matchingTags.value).toEqual(['admin-ui']);
    expect(input.value).toBe('');

    component.commitTagInput(rule, { value: 'admin-ui' } as HTMLInputElement);
    expect(rule.controls.matchingTags.value).toEqual(['admin-ui']);

    component.toggleTagOperator(rule);
    expect(rule.controls.matchingTagOperator.value).toBe('All');

    component.removeRuleTag(rule, 'admin-ui');
    expect(rule.controls.matchingTags.value).toEqual([]);
  });

  it('should not close when submitted invalid, and land on the first section with errors', () => {
    component.onSubmit();

    expect(harness.dialogRef.close).not.toHaveBeenCalled();
    expect(component.submitAttempted()).toBe(true);
    expect(component.activeSection()).toBe('output');
  });

  it('should close with a definition that omits empty optional fields and maps inherit to undefined', () => {
    fillOutput(component);
    const group = component.form.controls.collections.at(0);
    group.controls.allEntries.setValue(false);
    component.addRule(group);
    group.controls.rules.at(0).controls.matchingPattern.setValue('apps.admin.*');
    component.addCollection('mockDesignSystem');
    const second = component.form.controls.collections.at(1);
    second.controls.bundledKeyPrefix.setValue('ds');
    second.controls.mergeStrategy.setValue('override');
    component.form.controls.typesEnabled.setValue(true);
    component.form.controls.typeDistFile.setValue('./dist/i18n-types/admin.ts');

    component.onSubmit();

    expect(harness.dialogRef.close).toHaveBeenCalledWith({
      name: 'admin',
      bundle: {
        bundleName: 'admin.{locale}',
        dist: './dist/i18n',
        collections: [
          { name: 'trackerResources', entriesSelectionRules: [{ matchingPattern: 'apps.admin.*' }] },
          { name: 'mockDesignSystem', bundledKeyPrefix: 'ds', entriesSelectionRules: 'All', mergeStrategy: 'override' },
        ],
        typeDistFile: './dist/i18n-types/admin.ts',
      },
    });
    const bundle = harness.dialogRef.close.mock.calls[0][0].bundle as BundleDefinitionDto;
    expect(bundle).not.toHaveProperty('tokenCasing');
    expect(bundle).not.toHaveProperty('tokenConstantName');
    expect(bundle).not.toHaveProperty('transformICUToTransloco');
  });

  it('should send "All" for collections and explicit casing and ICU choices when set', () => {
    fillOutput(component);
    component.form.controls.allCollections.setValue(true);
    component.form.controls.typesEnabled.setValue(true);
    component.form.controls.typeDistFile.setValue('./dist/i18n-types/admin.ts');
    component.form.controls.tokenCasing.setValue('camelCase');
    component.form.controls.tokenConstantName.setValue('ADMIN_KEYS');
    component.setIcu(false);

    component.onSubmit();

    expect(harness.dialogRef.close).toHaveBeenCalledWith({
      name: 'admin',
      bundle: {
        bundleName: 'admin.{locale}',
        dist: './dist/i18n',
        collections: 'All',
        typeDistFile: './dist/i18n-types/admin.ts',
        tokenCasing: 'camelCase',
        tokenConstantName: 'ADMIN_KEYS',
        transformICUToTransloco: false,
      },
    });
  });

  it('should close with undefined on cancel', () => {
    component.onCancel();
    expect(harness.dialogRef.close).toHaveBeenCalledWith(undefined);
  });
});

describe('BundleFormDialog — dry run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should debounce edits and call the API once with the current definition', async () => {
    const { component, api } = await buildTestBed({ mode: 'create' });
    fillOutput(component);
    component.form.controls.dist.setValue('./dist/i18n');
    expect(api.dryRunBundle).not.toHaveBeenCalled();
    expect(component.previewStale()).toBe(true);

    vi.advanceTimersByTime(299);
    expect(api.dryRunBundle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(api.dryRunBundle).toHaveBeenCalledTimes(1);
    expect(api.dryRunBundle).toHaveBeenCalledWith({
      name: 'admin',
      bundle: expect.objectContaining({ bundleName: 'admin.{locale}', dist: './dist/i18n' }),
    });
    expect(component.dryRun()).toEqual(dryRunResult);
    expect(component.previewStatus()).toBe('ready');
    expect(component.previewStale()).toBe(false);
    expect(component.previewFileCount()).toBe(3);
    expect(component.keysPerLocale()).toBe(12);
  });

  it('should not call the API until name, folder and pattern are all present', async () => {
    const { component, api } = await buildTestBed({ mode: 'create' });
    component.form.controls.name.setValue('admin');
    vi.advanceTimersByTime(300);

    expect(api.dryRunBundle).not.toHaveBeenCalled();
    expect(component.previewStatus()).toBe('waiting');
  });

  it('should fall back to the client-side tree when the dry run fails', async () => {
    const { component, api } = await buildTestBed({ mode: 'create' });
    api.dryRunBundle.mockReturnValue(throwError(() => new Error('boom')));
    fillOutput(component);
    component.form.controls.typesEnabled.setValue(true);
    component.form.controls.typeDistFile.setValue('./dist/i18n-types/admin.ts');
    vi.advanceTimersByTime(300);

    expect(component.previewStatus()).toBe('error');
    expect(component.dryRun()).toBeUndefined();
    expect(
      component.previewTree().map((folder) => ({
        path: folder.path,
        files: folder.files.map((file) => ({ name: file.name, kind: file.kind, exists: file.exists })),
      })),
    ).toEqual([
      {
        path: 'dist/i18n',
        files: [
          { name: 'admin.en.json', kind: 'bundle', exists: undefined },
          { name: 'admin.fr-ca.json', kind: 'bundle', exists: undefined },
          { name: 'admin.es.json', kind: 'bundle', exists: undefined },
        ],
      },
      { path: 'dist/i18n-types', files: [{ name: 'admin.ts', kind: 'types', exists: undefined }] },
    ]);
  });

  it('should split tree paths and names after separators so they wrap between segments', async () => {
    const { component, api } = await buildTestBed({ mode: 'create' });
    api.dryRunBundle.mockReturnValue(throwError(() => new Error('boom')));
    fillOutput(component);
    vi.advanceTimersByTime(300);

    const folder = component.previewTree()[0];
    expect(folder).toBeDefined();
    expect(folder?.pathParts).toEqual(['dist/', 'i18n']);
    expect(folder?.files[0]?.nameParts).toEqual(['admin.', 'en.', 'json']);
    expect(folder?.files[0]?.nameParts.join('')).toBe(folder?.files[0]?.name);
  });

  it('should split the example token path after separators', async () => {
    const { component } = await buildTestBed({ mode: 'create' });
    fillOutput(component);
    vi.advanceTimersByTime(300);

    component.dryRun.set({
      ...dryRunResult,
      exampleKey: {
        collectionName: 'trackerResources',
        sourceKey: 'app.skipToMainContent',
        bundledKey: 'app.skipToMainContent',
        tokenPath: 'TRACKER_TOKENS.APP.SKIPTOMAINCONTENT',
      },
    });

    expect(component.tokenPathParts()).toEqual(['TRACKER_', 'TOKENS.', 'APP.', 'SKIPTOMAINCONTENT']);
    expect(component.tokenPathParts().join('')).toBe('TRACKER_TOKENS.APP.SKIPTOMAINCONTENT');
  });

  it('should surface hierarchical key collisions as an error in the preview', async () => {
    const { component, fixture } = await buildTestBed({ mode: 'create' });
    fillOutput(component);
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="hierarchical-conflicts"]')).toBeNull();

    component.dryRun.set({ ...dryRunResult, hierarchicalConflicts: ['buttons.ok', 'menu.file'] });
    fixture.detectChanges();

    expect(component.hierarchicalConflicts()).toEqual(['buttons.ok', 'menu.file']);
    expect(component.hierarchicalConflictList()).toBe('buttons.ok, menu.file');

    // The message itself is translated (asserted via the token), so the test checks
    // that the error line appears at all and that it is announced.
    const error = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="hierarchical-conflicts"]');
    expect(error).toBeTruthy();
    expect(error?.getAttribute('role')).toBe('alert');
  });
});

describe('BundleFormDialog — edit mode', () => {
  let harness: Harness;
  let component: BundleFormDialog;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    harness = await buildTestBed({ mode: 'edit', name: 'tracker', bundle: trackerBundle });
    component = harness.component;
  });

  it('should open on the Output section', () => {
    expect(component.isEditMode).toBe(true);
    expect(component.activeSection()).toBe('output');
  });

  it('should lock the name and skip the collision check against itself', () => {
    expect(component.form.controls.name.disabled).toBe(true);
    expect(component.form.controls.name.value).toBe('tracker');
    expect(component.form.controls.name.errors).toBeNull();
    expect(harness.fixture.nativeElement.querySelector('[data-testid="name-locked"]')).toBeTruthy();
  });

  it('should pre-populate the definition', () => {
    const raw = component.form.getRawValue();
    expect(raw.dist).toBe('./apps/tracker/src/assets/i18n');
    expect(raw.bundleName).toBe('{locale}');
    expect(raw.allCollections).toBe(false);
    expect(raw.collections).toHaveLength(1);
    expect(raw.collections[0]?.allEntries).toBe(true);
    expect(raw.typesEnabled).toBe(true);
    expect(raw.typeDistFile).toBe('./apps/tracker/src/i18n-types/tracker-resources.ts');
    expect(raw.tokenCasing).toBe('inherit');
    expect(raw.transformICUToTransloco).toBe('on');
  });

  it('should keep the name in the result even though the control is disabled', () => {
    component.onSubmit();

    expect(harness.dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'tracker',
        bundle: expect.objectContaining({ collections: trackerBundle.collections, transformICUToTransloco: true }),
      }),
    );
  });

  it('should collapse an ICU choice equal to the project default (on) back to inherit', () => {
    component.setIcu(true);
    expect(component.form.controls.transformICUToTransloco.value).toBe('inherit');

    component.setIcu(false);
    expect(component.form.controls.transformICUToTransloco.value).toBe('off');
  });
});
