import { computed, type Signal } from '@angular/core';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import type { TokenTranslator } from '../../../shared/translate-token';
import { statusLabelTokenFor } from '../../../shared/translation-status/translation-status-presentation';

/** Read-only state needed to derive the editor's text, markup and aria IDs. */
export interface EditorPresentationState {
  readonly isEditMode: Signal<boolean>;
  readonly isReadOnly: Signal<boolean>;
  readonly showBaseValueError: Signal<boolean>;
  readonly otherLocales: Signal<readonly string[]>;
  readonly similarCount: Signal<number>;
  readonly entry: {
    readonly needWorkCount: Signal<number>;
    readonly form: {
      readonly controls: {
        readonly key: { hasError(code: string): boolean };
      };
    };
  };
  readonly advisories: {
    readonly preferredTermFindings: Signal<readonly unknown[]>;
  };
  readonly location: {
    readonly selectedFolderPath: Signal<string>;
  };
}

export interface EditorPresentationOptions {
  translate: TokenTranslator;
  activeLang: () => string;
}

/** Display-only derivations for one editor; no injector, DOM or lifecycle required. */
export class EditorPresentation {
  readonly preferredTermAdvisoriesId = 'translation-editor-preferred-terms';

  /**
   * The base value's `aria-describedby`: the error or ICU hint as before, plus
   * the advisories while there are any.
   */
  readonly baseValueDescribedBy = computed(() => {
    const ids = [
      this.session.showBaseValueError() ? 'translation-editor-base-value-error' : 'translation-editor-icu-hint',
    ];
    if (this.session.advisories.preferredTermFindings().length > 0) {
      ids.push(this.preferredTermAdvisoriesId);
    }
    return ids.join(' ');
  });

  readonly dialogTitle = computed(() =>
    this.session.isEditMode()
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.EDITTITLE
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CREATETITLE,
  );

  readonly dialogSubtitle = computed(() =>
    this.session.isEditMode()
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.EDITSUBTITLEX
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CREATESUBTITLEX,
  );

  readonly saveButtonLabel = computed(() =>
    this.session.isEditMode()
      ? TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.UPDATEBUTTON
      : TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.SAVEBUTTON,
  );

  /** Transloco token for a status label, from the shared status presentation, so the spine never shows raw enum text. */
  readonly statusLabelToken = statusLabelTokenFor;

  /** Explains a disabled Other locales row instead of leaving it silently grey. */
  readonly otherLocalesDisabledTooltip = computed(() =>
    this.session.otherLocales().length === 0
      ? this.options.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.NOOTHERLOCALESTOOLTIP)
      : '',
  );

  /** Explains a disabled location trigger instead of leaving it silently grey. */
  readonly locationDisabledTooltip = computed(() =>
    this.session.isReadOnly()
      ? this.options.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.READONLYTABTOOLTIP)
      : '',
  );

  /** The base locale under a name a reader recognises ("English"), for the value label. */
  readonly baseLocaleName = computed(() => this.getLocaleDisplayName(this.data.baseLocale));

  /** The right-hand summary on the "Other locales" row, already localized. */
  readonly otherLocalesSummary = computed(() =>
    this.session.isEditMode()
      ? this.options.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.NEEDWORKX, {
          count: this.session.entry.needWorkCount(),
        })
      : this.options.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.AUTOTRANSLATEDX, {
          count: this.session.otherLocales().length,
        }),
  );

  /** The one-line summary the narrow "Context" disclosure carries. */
  readonly contextSummary = computed(() => {
    // The key itself is not summarised here: the footer carries it in full, and
    // the form's own key error carries the collision.
    const parts = [
      this.session.location.selectedFolderPath() ||
        this.options.translate(TRACKER_TOKENS.BROWSER.FOLDERPICKER.ROOTLABEL),
    ];
    if (this.session.similarCount() > 0) {
      parts.push(
        this.options.translate(TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.CONTEXT.SIMILARCOUNTX, {
          count: this.session.similarCount(),
        }),
      );
    }
    return parts.join(' · ');
  });

  /**
   * App-owned markup, never translator input, so the ICU hint can carry a <code>
   * run. The braces are HTML entities: a literal `{count}` handed to Transloco
   * as a parameter is re-read as an ICU argument and resolves to `undefined`.
   */
  readonly icuPlaceholderMarkup = '<code>&#123;count&#125;</code>';

  /**
   * Renders a locale as a name the reader recognises ("French (Canada)") with
   * the raw code as the fallback, rather than shouting `FR-CA` at them.
   */
  getLocaleDisplayName(locale: string | undefined): string {
    if (!locale) {
      return '';
    }

    const code = locale.toUpperCase();
    try {
      const names = new Intl.DisplayNames([this.options.activeLang()], {
        type: 'language',
      });
      const name = names.of(locale);
      return name && name.toLowerCase() !== locale.toLowerCase() ? name : code;
    } catch {
      return code;
    }
  }

  getKeyErrorMessage(): string {
    const keyControl = this.session.entry.form.controls.key;

    if (keyControl.hasError('required')) {
      return TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.KEYREQUIRED;
    }

    if (keyControl.hasError('pattern')) {
      return TRACKER_TOKENS.BROWSER.TRANSLATIONEDITOR.KEYPATTERNERROR;
    }

    return '';
  }

  constructor(
    private readonly session: EditorPresentationState,
    private readonly data: { readonly baseLocale: string },
    private readonly options: EditorPresentationOptions,
  ) {}
}
