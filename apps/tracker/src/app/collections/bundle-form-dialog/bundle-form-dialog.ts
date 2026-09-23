import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import {
  type AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidationErrors,
  type ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoPipe } from '@jsverse/transloco';
import { catchError, debounceTime, map, of, startWith, switchMap, tap } from 'rxjs';
import { isValidJavaScriptIdentifier, normalizeTag } from '@simoncodes-ca/domain';
import type {
  BundleDefinitionDto,
  BundleDryRunRequestDto,
  BundleDryRunResultDto,
  CollectionBundleDefinitionDto,
  EntrySelectionRuleDto,
  TokenCasingDto,
} from '@simoncodes-ca/data-transfer';
import { TRACKER_TOKENS } from '../../../i18n-types/tracker-resources';
import { segmentValidator } from '../../shared/validators/segment.validator';
import { CollectionsApiService } from '../services/collections-api.service';
import { CollectionsStore } from '../store/collections.store';
import type { BundleFormDialogData, BundleFormResult } from './bundle-form-dialog-data';
import { SegmentedControl, type SegmentOption } from './segmented-control';

export type BundleSection = 'output' | 'collections' | `coll:${number}` | 'types' | 'options';
export type MergeStrategy = 'merge' | 'override';
export type TagOperator = 'Any' | 'All';
export type TokenCasingChoice = 'inherit' | TokenCasingDto;
export type IcuChoice = 'inherit' | 'on' | 'off';

export type RuleGroup = FormGroup<{
  matchingPattern: FormControl<string>;
  matchingTags: FormControl<string[]>;
  matchingTagOperator: FormControl<TagOperator>;
}>;

export type CollectionGroup = FormGroup<{
  name: FormControl<string>;
  bundledKeyPrefix: FormControl<string>;
  mergeStrategy: FormControl<MergeStrategy>;
  allEntries: FormControl<boolean>;
  rules: FormArray<RuleGroup>;
}>;

/** One folder of the "Will write" tree. */
export interface PreviewFolder {
  readonly path: string;
  /** `path` split after each separator so the template can offer break opportunities. */
  readonly pathParts: readonly string[];
  readonly files: readonly PreviewFile[];
}

export interface PreviewFile {
  readonly name: string;
  /** `name` split after each separator so the template can offer break opportunities. */
  readonly nameParts: readonly string[];
  readonly kind: 'bundle' | 'types';
  /** `undefined` when the dry run failed and existence is unknown. */
  readonly exists: boolean | undefined;
}

export type PreviewStatus = 'waiting' | 'loading' | 'ready' | 'error';

const LOCALE_PLACEHOLDER = '{locale}';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const code = (value: string): string => `<code>${escapeHtml(value)}</code>`;

/** Mirrors core's `bundleKeyToConstantName` without importing core into the browser. */
const deriveConstantName = (bundleKey: string): string => `${bundleKey.replace(/-/g, '_').toUpperCase()}_TOKENS`;

/** Split after each separator so long paths break between segments instead of mid-identifier. */
const splitAfterSeparators = (value: string, separators: RegExp): readonly string[] =>
  value.length === 0 ? [] : value.split(separators);

const PATH_SEPARATORS = /(?<=[._\-/])/;
const TOKEN_SEPARATORS = /(?<=[._])/;

const stripDotSlash = (path: string): string => path.replace(/^\.\//, '').replace(/\/+$/, '');

@Component({
  selector: 'app-bundle-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslocoPipe,
    SegmentedControl,
  ],
  templateUrl: './bundle-form-dialog.html',
  styleUrl: './bundle-form-dialog.scss',
})
export class BundleFormDialog {
  readonly #dialogRef = inject(MatDialogRef<BundleFormDialog, BundleFormResult | undefined>);
  readonly #data = inject<BundleFormDialogData>(MAT_DIALOG_DATA);
  readonly #api = inject(CollectionsApiService);
  readonly #destroyRef = inject(DestroyRef);
  readonly store = inject(CollectionsStore);

  readonly TOKENS = TRACKER_TOKENS;
  readonly isEditMode = this.#data.mode === 'edit';
  readonly configFileMarkup = '<code>.lingo-tracker.json</code>';
  readonly bundlesKeyMarkup = '<code>bundles</code>';
  readonly tsExtensionMarkup = '<code>.ts</code>';
  /** Braces as entities so messageformat never reads the examples as arguments. */
  readonly icuExampleMarkup = '<code>&#123;count&#125;</code>';
  readonly translocoExampleMarkup = '<code>&#123;&#123;count&#125;&#125;</code>';
  readonly localePlaceholder = LOCALE_PLACEHOLDER;
  /** Rail sub-labels always render; these stand in until the matching field is filled. */
  readonly placeholderPattern = TRACKER_TOKENS.BUNDLES.DIALOG.SECTIONS.OUTPUTPLACEHOLDER;
  readonly placeholderTypeFile = TRACKER_TOKENS.BUNDLES.DIALOG.SECTIONS.TYPESPLACEHOLDER;

  readonly mergeOptions: readonly SegmentOption<MergeStrategy>[] = [
    { value: 'merge', label: TRACKER_TOKENS.BUNDLES.DIALOG.COLLECTION.FIRSTWINS },
    { value: 'override', label: TRACKER_TOKENS.BUNDLES.DIALOG.COLLECTION.THISOVERRIDES },
  ];
  readonly entriesOptions: readonly SegmentOption<boolean>[] = [
    { value: true, label: TRACKER_TOKENS.BUNDLES.DIALOG.COLLECTION.ALLENTRIES, icon: 'done_all' },
    { value: false, label: TRACKER_TOKENS.BUNDLES.DIALOG.COLLECTION.ONLYMATCHING, icon: 'filter_alt' },
  ];
  readonly casingOptions: readonly SegmentOption<TokenCasingDto>[] = [
    { value: 'upperCase', text: 'UPPER_CASE' },
    { value: 'camelCase', text: 'camelCase' },
  ];

  readonly form = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, segmentValidator, this.#uniqueNameValidator()],
    }),
    dist: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    bundleName: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, localePlaceholderValidator],
    }),
    allCollections: new FormControl<boolean>(false, { nonNullable: true }),
    collections: new FormArray<CollectionGroup>([], { validators: [collectionsRequiredValidator] }),
    typesEnabled: new FormControl<boolean>(false, { nonNullable: true }),
    typeDistFile: new FormControl<string>('', { nonNullable: true, validators: [typeFileValidator] }),
    tokenCasing: new FormControl<TokenCasingChoice>('inherit', { nonNullable: true }),
    tokenConstantName: new FormControl<string>('', { nonNullable: true, validators: [identifierValidator] }),
    transformICUToTransloco: new FormControl<IcuChoice>('inherit', { nonNullable: true }),
  });

  /**
   * Reactive forms are not signals. Every form event (value, status, touched, submit) bumps this
   * signal so the computeds below re-read the form.
   */
  readonly #formTick = toSignal(this.form.events.pipe(map(() => Symbol())), { initialValue: Symbol() });

  readonly activeSection = signal<BundleSection>(this.#initialSection());
  readonly submitAttempted = signal(false);
  readonly previewOpen = signal(false);

  readonly dryRun = signal<BundleDryRunResultDto | undefined>(undefined);
  readonly previewStatus = signal<PreviewStatus>('waiting');
  /** True from the first keystroke until the next dry run lands. */
  readonly previewStale = signal(false);

  readonly activeKind = computed<'output' | 'collections' | 'collection' | 'types' | 'options'>(() => {
    const section = this.activeSection();
    return section.startsWith('coll:') ? 'collection' : (section as Exclude<BundleSection, `coll:${number}`>);
  });

  readonly activeCollectionIndex = computed(() => {
    const section = this.activeSection();
    return section.startsWith('coll:') ? Number(section.slice(5)) : -1;
  });

  readonly activeCollectionGroup = computed(() => {
    this.#formTick();
    const index = this.activeCollectionIndex();
    return index >= 0 ? this.form.controls.collections.at(index) : undefined;
  });

  /** Names of every configured collection, in config order. */
  readonly allCollectionNames = computed(() => this.store.collectionEntries().map((entry) => entry.name));

  /** Collections not yet in the bundle — what the "Add a collection" menu offers. */
  readonly availableCollections = computed(() => {
    this.#formTick();
    const used = new Set(this.form.controls.collections.controls.map((group) => group.controls.name.value));
    return this.allCollectionNames().filter((name) => !used.has(name));
  });

  readonly projectLocales = computed(() => this.store.config()?.locales ?? []);
  readonly projectBaseLocale = computed(() => this.store.config()?.baseLocale ?? '');
  readonly projectTokenCasing = computed<TokenCasingDto>(() => this.store.config()?.tokenCasing ?? 'upperCase');
  readonly projectIcuTransform = computed(() => this.store.config()?.transformICUToTransloco ?? true);

  readonly collectionCount = computed(() => {
    this.#formTick();
    return this.form.controls.allCollections.value
      ? this.allCollectionNames().length
      : this.form.controls.collections.length;
  });

  /** Rail summary under Output: `dist/pattern.json`, or nothing until both are typed. */
  readonly outputSummary = computed(() => {
    this.#formTick();
    const { dist, bundleName } = this.form.getRawValue();
    if (!dist.trim() && !bundleName.trim()) return '';
    return `${stripDotSlash(dist.trim())}/${bundleName.trim()}.json`;
  });

  readonly typeFileName = computed(() => {
    this.#formTick();
    const { typesEnabled, typeDistFile } = this.form.getRawValue();
    if (!typesEnabled) return '';
    return typeDistFile.trim().split('/').pop() ?? '';
  });

  readonly derivedConstantName = computed(() => {
    this.#formTick();
    return deriveConstantName(this.form.getRawValue().name.trim() || 'bundle');
  });

  readonly patternFiles = computed(() => {
    this.#formTick();
    const pattern = this.form.getRawValue().bundleName.trim();
    if (!pattern) return [];
    return this.projectLocales().map((locale) => `${pattern.replace(LOCALE_PLACEHOLDER, locale)}.json`);
  });

  readonly writesHintParams = computed(() => {
    const files = this.patternFiles();
    return { examples: files.slice(0, 2).map(code).join(', '), count: files.length };
  });

  /** Sections whose fields are invalid and worth flagging in the rail. */
  readonly sectionErrors = computed<ReadonlySet<BundleSection>>(() => {
    this.#formTick();
    const flag = (control: AbstractControl): boolean =>
      control.invalid && (control.touched || control.dirty || this.submitAttempted());
    const errors = new Set<BundleSection>();
    const controls = this.form.controls;

    if ([controls.name, controls.dist, controls.bundleName].some(flag)) errors.add('output');
    if (flag(controls.collections) && controls.collections.hasError('collectionsEmpty')) errors.add('collections');
    controls.collections.controls.forEach((group, index) => {
      if (flag(group)) errors.add(`coll:${index}`);
    });
    if ([controls.typeDistFile, controls.tokenConstantName].some(flag)) errors.add('types');
    return errors;
  });

  /** Client-side tree from the form alone; used while waiting and when the dry run fails. */
  readonly localTree = computed<readonly PreviewFolder[]>(() => {
    this.#formTick();
    const raw = this.form.getRawValue();
    const files: { path: string; kind: 'bundle' | 'types' }[] = this.patternFiles().map((file) => ({
      path: `${stripDotSlash(raw.dist.trim())}/${file}`,
      kind: 'bundle',
    }));
    if (raw.typesEnabled && raw.typeDistFile.trim()) {
      files.push({ path: stripDotSlash(raw.typeDistFile.trim()), kind: 'types' });
    }
    return groupIntoFolders(files.map((file) => ({ ...file, exists: undefined })));
  });

  readonly previewTree = computed<readonly PreviewFolder[]>(() => {
    const result = this.dryRun();
    if (!result || this.previewStatus() === 'error') return this.localTree();
    return groupIntoFolders(
      result.files.map((file) => ({ path: stripDotSlash(file.path), kind: file.kind, exists: file.exists })),
    );
  });

  readonly previewFileCount = computed(() =>
    this.previewTree().reduce((total, folder) => total + folder.files.length, 0),
  );

  /**
   * Bundled keys that are both a leaf and a parent (e.g. `buttons.ok` next to
   * `buttons.ok.label`). Generation throws on these, so the preview must show
   * them as an error rather than letting the bundle look ready to ship.
   */
  readonly hierarchicalConflicts = computed<readonly string[]>(() => {
    if (this.previewStatus() === 'error') return [];
    return this.dryRun()?.hierarchicalConflicts ?? [];
  });

  /** The colliding keys as one readable list for the preview error line. */
  readonly hierarchicalConflictList = computed(() => this.hierarchicalConflicts().join(', '));

  readonly keysPerLocale = computed(() => {
    const result = this.dryRun();
    if (!result) return undefined;
    const base = result.keysPerLocale[this.projectBaseLocale()];
    if (base !== undefined) return base;
    return Math.max(0, ...Object.values(result.keysPerLocale));
  });

  /** What the ICU switch shows: the explicit choice, or the project default while inheriting. */
  readonly icuChecked = computed(() => {
    this.#formTick();
    const choice = this.form.controls.transformICUToTransloco.value;
    return choice === 'inherit' ? this.projectIcuTransform() : choice === 'on';
  });

  /** Example token path split after `.` and `_`, so it wraps between segments, never mid-identifier. */
  readonly tokenPathParts = computed<readonly string[]>(() => {
    const tokenPath = this.dryRun()?.exampleKey?.tokenPath;
    if (!tokenPath) return [];
    return splitAfterSeparators(tokenPath, TOKEN_SEPARATORS);
  });

  readonly hasOverride = computed(() => {
    this.#formTick();
    return this.form.controls.collections.controls.some((group) => group.controls.mergeStrategy.value === 'override');
  });

  constructor() {
    this.#populate();
    this.#wireDependentValidation();
    this.#wireDryRun();
  }

  // ───────────────────────────── navigation ─────────────────────────────

  activate(section: BundleSection): void {
    this.activeSection.set(section);
  }

  isActive(section: BundleSection): boolean {
    return this.activeSection() === section;
  }

  activateCollection(index: number): void {
    this.activate(`coll:${index}`);
  }

  isActiveCollection(index: number): boolean {
    return this.activeCollectionIndex() === index;
  }

  hasCollectionError(index: number): boolean {
    return this.sectionErrors().has(`coll:${index}`);
  }

  /** Wraps user text in `<code>` for the innerHTML hints, escaped so a prefix can never inject markup. */
  codeMarkup(value: string): string {
    return code(value);
  }

  /** A choice equal to the project default is redundant, so it collapses back to inherit. */
  setIcu(checked: boolean): void {
    const control = this.form.controls.transformICUToTransloco;
    control.setValue(checked === this.projectIcuTransform() ? 'inherit' : checked ? 'on' : 'off');
    control.markAsDirty();
    control.markAsTouched();
  }

  togglePreview(): void {
    this.previewOpen.update((open) => !open);
  }

  // ───────────────────────────── collections ─────────────────────────────

  addCollection(name: string): void {
    const collections = this.form.controls.collections;
    collections.push(this.#buildCollectionGroup({ name, entriesSelectionRules: 'All' }));
    collections.markAsDirty();
    this.activate(`coll:${collections.length - 1}`);
  }

  removeCollection(index: number): void {
    const collections = this.form.controls.collections;
    if (index < 0 || index >= collections.length) return;
    collections.removeAt(index);
    collections.markAsDirty();
    collections.markAsTouched();
    this.activate('collections');
  }

  onAllCollectionsToggle(): void {
    if (this.form.controls.allCollections.value && this.activeKind() === 'collection') {
      this.activate('collections');
    }
  }

  /** The one-line summary shown on a collection row and in the rail. */
  ruleCount(group: CollectionGroup): number {
    return group.controls.rules.length;
  }

  // ───────────────────────────── rules ─────────────────────────────

  addRule(group: CollectionGroup): void {
    group.controls.rules.push(this.#buildRuleGroup({ matchingPattern: '' }));
    group.controls.rules.markAsDirty();
  }

  removeRule(group: CollectionGroup, index: number): void {
    group.controls.rules.removeAt(index);
    group.controls.rules.markAsDirty();
    group.controls.rules.markAsTouched();
  }

  onTagInputKeydown(event: KeyboardEvent, rule: RuleGroup, input: HTMLInputElement): void {
    if (event.key === 'Backspace' && !input.value) {
      const tags = rule.controls.matchingTags.value;
      if (tags.length > 0) this.removeRuleTag(rule, tags[tags.length - 1]);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    this.commitTagInput(rule, input);
  }

  commitTagInput(rule: RuleGroup, input: HTMLInputElement): void {
    const normalized = normalizeTag(input.value);
    input.value = '';
    if (!normalized) return;
    const control = rule.controls.matchingTags;
    if (control.value.includes(normalized)) return;
    control.setValue([...control.value, normalized]);
    control.markAsDirty();
  }

  removeRuleTag(rule: RuleGroup, tag: string): void {
    const control = rule.controls.matchingTags;
    control.setValue(control.value.filter((existing) => existing !== tag));
    control.markAsDirty();
  }

  toggleTagOperator(rule: RuleGroup): void {
    const control = rule.controls.matchingTagOperator;
    control.setValue(control.value === 'Any' ? 'All' : 'Any');
    control.markAsDirty();
  }

  // ───────────────────────────── errors ─────────────────────────────

  showError(control: AbstractControl, error?: string): boolean {
    if (!(control.touched || control.dirty || this.submitAttempted())) return false;
    return error ? control.hasError(error) : control.invalid;
  }

  // ───────────────────────────── submit ─────────────────────────────

  onCancel(): void {
    this.#dialogRef.close(undefined);
  }

  onSubmit(): void {
    this.submitAttempted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.#revealFirstError();
      return;
    }
    this.#dialogRef.close(this.#buildResult());
  }

  // ───────────────────────────── private ─────────────────────────────

  #initialSection(): BundleSection {
    if (this.#data.mode === 'edit') return 'output';
    const collections = this.#data.bundle?.collections;
    return Array.isArray(collections) && collections.length > 0 ? 'coll:0' : 'collections';
  }

  #populate(): void {
    const bundle = this.#data.bundle;
    const name = this.#data.name ?? '';
    const collections = bundle?.collections;

    this.form.patchValue({
      name,
      dist: bundle?.dist ?? '',
      bundleName: bundle?.bundleName ?? '',
      allCollections: collections === 'All',
      typesEnabled: Boolean(bundle?.typeDistFile),
      typeDistFile: bundle?.typeDistFile ?? '',
      tokenCasing: bundle?.tokenCasing ?? 'inherit',
      tokenConstantName: bundle?.tokenConstantName ?? '',
      transformICUToTransloco:
        bundle?.transformICUToTransloco === undefined ? 'inherit' : bundle.transformICUToTransloco ? 'on' : 'off',
    });

    if (Array.isArray(collections)) {
      for (const collection of collections) {
        this.form.controls.collections.push(this.#buildCollectionGroup(collection), { emitEvent: false });
      }
    }

    // In create mode the first collection pane opens straight away when there is one; a brand
    // new bundle starts with its first collection so the user lands on something to fill in.
    if (!this.isEditMode && this.form.controls.collections.length === 0 && !this.form.controls.allCollections.value) {
      const [first] = this.allCollectionNames();
      if (first) {
        this.form.controls.collections.push(this.#buildCollectionGroup({ name: first, entriesSelectionRules: 'All' }), {
          emitEvent: false,
        });
        this.activeSection.set('coll:0');
      }
    }

    if (this.isEditMode && name) {
      this.form.controls.name.disable({ emitEvent: false });
    }

    // Cross-control validators ran before their siblings had values; settle them now.
    this.form.controls.typeDistFile.updateValueAndValidity({ emitEvent: false });
    this.form.controls.collections.updateValueAndValidity({ emitEvent: false });
  }

  #buildCollectionGroup(collection: CollectionBundleDefinitionDto): CollectionGroup {
    const rules = Array.isArray(collection.entriesSelectionRules) ? collection.entriesSelectionRules : [];
    const group: CollectionGroup = new FormGroup({
      name: new FormControl<string>(collection.name, { nonNullable: true, validators: [Validators.required] }),
      bundledKeyPrefix: new FormControl<string>(collection.bundledKeyPrefix ?? '', { nonNullable: true }),
      mergeStrategy: new FormControl<MergeStrategy>(collection.mergeStrategy ?? 'merge', { nonNullable: true }),
      allEntries: new FormControl<boolean>(collection.entriesSelectionRules === 'All', { nonNullable: true }),
      rules: new FormArray<RuleGroup>(
        rules.map((rule) => this.#buildRuleGroup(rule)),
        { validators: [rulesRequiredValidator] },
      ),
    });
    // The rules validator reads `allEntries`, which it could not see before the group existed;
    // settle it now and re-run it on every toggle.
    group.controls.rules.updateValueAndValidity({ emitEvent: false });
    group.controls.allEntries.valueChanges
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => group.controls.rules.updateValueAndValidity());
    return group;
  }

  #buildRuleGroup(rule: EntrySelectionRuleDto): RuleGroup {
    return new FormGroup({
      matchingPattern: new FormControl<string>(rule.matchingPattern, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      matchingTags: new FormControl<string[]>([...(rule.matchingTags ?? [])], { nonNullable: true }),
      matchingTagOperator: new FormControl<TagOperator>(rule.matchingTagOperator ?? 'Any', { nonNullable: true }),
    });
  }

  #uniqueNameValidator(): ValidatorFn {
    return (control) => {
      if (this.#data.mode === 'edit') return null;
      const value = String(control.value ?? '').trim();
      if (!value) return null;
      const taken = this.store.bundleEntries().some((entry) => entry.name === value);
      return taken ? { nameExists: { name: value } } : null;
    };
  }

  /**
   * Validators that read a sibling control do not re-run on their own when the sibling changes;
   * these subscriptions nudge them.
   */
  #wireDependentValidation(): void {
    const controls = this.form.controls;
    controls.typesEnabled.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      controls.typeDistFile.updateValueAndValidity();
      controls.tokenConstantName.updateValueAndValidity();
    });
    controls.allCollections.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      controls.collections.updateValueAndValidity();
    });
  }

  #wireDryRun(): void {
    this.form.valueChanges
      .pipe(
        startWith(null),
        tap(() => this.previewStale.set(true)),
        debounceTime(300),
        map(() => this.#buildDryRunRequest()),
        switchMap((request) => {
          if (!request) {
            return of({ status: 'waiting' as const, result: undefined });
          }
          this.previewStatus.update((status) => (status === 'ready' ? status : 'loading'));
          return this.#api.dryRunBundle(request).pipe(
            map((result) => ({ status: 'ready' as const, result })),
            catchError(() => of({ status: 'error' as const, result: undefined })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ status, result }) => {
        this.previewStatus.set(status);
        if (status !== 'error') this.dryRun.set(result);
        this.previewStale.set(false);
      });
  }

  /** The dry run needs a name, a folder and a pattern; anything less would only 400. */
  #buildDryRunRequest(): BundleDryRunRequestDto | undefined {
    const raw = this.form.getRawValue();
    const name = raw.name.trim();
    if (!name || !raw.dist.trim() || !raw.bundleName.trim()) return undefined;
    return { name, bundle: this.#buildDefinition() };
  }

  #buildDefinition(): BundleDefinitionDto {
    const raw = this.form.getRawValue();
    const collections: BundleDefinitionDto['collections'] = raw.allCollections
      ? 'All'
      : raw.collections.map((collection) => {
          const prefix = collection.bundledKeyPrefix.trim();
          const entriesSelectionRules: CollectionBundleDefinitionDto['entriesSelectionRules'] = collection.allEntries
            ? 'All'
            : collection.rules.map((rule) => ({
                matchingPattern: rule.matchingPattern.trim(),
                ...(rule.matchingTags.length > 0
                  ? { matchingTags: [...rule.matchingTags], matchingTagOperator: rule.matchingTagOperator }
                  : {}),
              }));
          return {
            name: collection.name,
            ...(prefix ? { bundledKeyPrefix: prefix } : {}),
            entriesSelectionRules,
            ...(collection.mergeStrategy === 'override' ? { mergeStrategy: 'override' as const } : {}),
          };
        });

    const typeDistFile = raw.typeDistFile.trim();
    const tokenConstantName = raw.tokenConstantName.trim();
    const typesOn = raw.typesEnabled && typeDistFile.length > 0;

    return {
      bundleName: raw.bundleName.trim(),
      dist: raw.dist.trim(),
      collections,
      ...(typesOn ? { typeDistFile } : {}),
      ...(typesOn && raw.tokenCasing !== 'inherit' ? { tokenCasing: raw.tokenCasing } : {}),
      ...(typesOn && tokenConstantName ? { tokenConstantName } : {}),
      ...(raw.transformICUToTransloco !== 'inherit'
        ? { transformICUToTransloco: raw.transformICUToTransloco === 'on' }
        : {}),
    };
  }

  #buildResult(): BundleFormResult {
    return { name: this.form.getRawValue().name.trim(), bundle: this.#buildDefinition() };
  }

  /** After a failed submit, land on the first section that has something to fix. */
  #revealFirstError(): void {
    const order: BundleSection[] = [
      'output',
      'collections',
      ...this.form.controls.collections.controls.map((_, index) => `coll:${index}` as const),
      'types',
    ];
    const errors = this.sectionErrors();
    const first = order.find((section) => errors.has(section));
    if (first) this.activate(first);
  }
}

// ───────────────────────────── validators & helpers ─────────────────────────────

function localePlaceholderValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  if (!value.trim()) return null;
  return value.includes(LOCALE_PLACEHOLDER) ? null : { missingLocale: true };
}

function typeFileValidator(control: AbstractControl): ValidationErrors | null {
  const parent = control.parent;
  const enabled = parent?.get('typesEnabled')?.value === true;
  if (!enabled) return null;
  const value = String(control.value ?? '').trim();
  if (!value) return { required: true };
  return value.endsWith('.ts') ? null : { notTypeScript: true };
}

/**
 * Mirrors core's `validateJavaScriptIdentifier` exactly: the shared rules live in
 * `@simoncodes-ca/domain` so the client check can never be weaker than the server's,
 * which would let the dialog close on a name the API then rejects with a 400.
 */
function identifierValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  return isValidJavaScriptIdentifier(value) ? null : { invalidIdentifier: true };
}

function collectionsRequiredValidator(control: AbstractControl): ValidationErrors | null {
  const parent = control.parent;
  const all = parent?.get('allCollections')?.value === true;
  if (all) return null;
  return control instanceof FormArray && control.length === 0 ? { collectionsEmpty: true } : null;
}

function rulesRequiredValidator(control: AbstractControl): ValidationErrors | null {
  const parent = control.parent;
  const all = parent?.get('allEntries')?.value === true;
  if (all) return null;
  return control instanceof FormArray && control.length === 0 ? { rulesEmpty: true } : null;
}

function groupIntoFolders(files: readonly { path: string; kind: 'bundle' | 'types'; exists: boolean | undefined }[]) {
  const folders = new Map<string, PreviewFile[]>();
  for (const file of files) {
    const slash = file.path.lastIndexOf('/');
    const folder = slash >= 0 ? file.path.slice(0, slash) : '';
    const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
    const list = folders.get(folder) ?? [];
    list.push({ name, nameParts: splitAfterSeparators(name, PATH_SEPARATORS), kind: file.kind, exists: file.exists });
    folders.set(folder, list);
  }
  return [...folders.entries()].map(
    ([path, list]) =>
      ({ path, pathParts: splitAfterSeparators(path, PATH_SEPARATORS), files: list }) satisfies PreviewFolder,
  );
}
