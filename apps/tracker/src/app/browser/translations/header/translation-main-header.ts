import { Component, ChangeDetectionStrategy, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationSearch } from './translation-search/translation-search';
import { BrowserStore } from '../../store/browser.store';
import { TranslationEditorLauncher } from '../../services/translation-editor-launcher';
import { LocaleFilter } from './locale-filter/locale-filter';
import { StatusFilter } from './status-filter/status-filter';
import { TRACKER_TOKENS } from '../../../../i18n-types/tracker-resources';
import type { DensityMode } from '../../types/density-mode';

const DENSITY_ANIMATION_DURATION_MS = 250;

/**
 * TranslationMainHeader component provides search and filtering controls
 * for the translation list.
 */
@Component({
  selector: 'app-translation-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    TranslationSearch,
    LocaleFilter,
    StatusFilter,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslocoPipe,
  ],
  templateUrl: './translation-main-header.html',
  styleUrl: './translation-main-header.scss',
})
export class TranslationMainHeader {
  readonly store = inject(BrowserStore);
  readonly #editorLauncher = inject(TranslationEditorLauncher);
  readonly TOKENS = TRACKER_TOKENS;

  /** Drives the icon flip animation — true for one animation cycle when toggled */
  readonly isDensityToggleFlipping = signal(false);

  #densityFlipMidTimeout: ReturnType<typeof setTimeout> | undefined;
  #densityFlipEndTimeout: ReturnType<typeof setTimeout> | undefined;

  readonly #destroyRef = inject(DestroyRef);

  constructor() {
    this.#destroyRef.onDestroy(() => {
      if (this.#densityFlipMidTimeout) clearTimeout(this.#densityFlipMidTimeout);
      if (this.#densityFlipEndTimeout) clearTimeout(this.#densityFlipEndTimeout);
    });
  }

  handleDensityToggle(): void {
    if (this.#densityFlipMidTimeout) clearTimeout(this.#densityFlipMidTimeout);
    if (this.#densityFlipEndTimeout) clearTimeout(this.#densityFlipEndTimeout);

    const nextMode: DensityMode = this.store.densityMode() === 'compact' ? 'full' : 'compact';

    this.isDensityToggleFlipping.set(true);

    this.#densityFlipMidTimeout = setTimeout(() => {
      this.store.setDensityMode(nextMode);
      this.#densityFlipMidTimeout = undefined;
    }, DENSITY_ANIMATION_DURATION_MS / 2);

    this.#densityFlipEndTimeout = setTimeout(() => {
      this.isDensityToggleFlipping.set(false);
      this.#densityFlipEndTimeout = undefined;
    }, DENSITY_ANIMATION_DURATION_MS);
  }

  handleSortDirectionToggle(): void {
    this.store.toggleSortDirection();
  }

  /** Opens the editor to create an entry; the launcher gives the feedback. */
  handleAddTranslation(): void {
    void this.#editorLauncher.openCreate();
  }
}
