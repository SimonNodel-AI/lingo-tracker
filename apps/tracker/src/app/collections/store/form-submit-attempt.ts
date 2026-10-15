import { type Signal, signal } from '@angular/core';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import type { Subscription } from 'rxjs';
import {
  type NamedEntryRefusal,
  NamedEntrySubmit,
  type NamedEntrySubmitConfig,
  type NamedEntryWrite,
} from './dialog-config-submit';

/** When a form shows a control's error: after it was touched, or also once edited or submitted. */
export type ErrorReveal = 'touched' | 'touched-dirty-attempted';

/** What a form renders for a refusal that did not belong to the name field. */
export type MessageRefusal = Extract<NamedEntryRefusal, { kind: 'message' }>;

/** The server's own rule messages when it sent any, else its one message. */
export function detailsElseMessage(refusal: MessageRefusal): readonly string[] {
  const details = refusal.details.filter((item): item is string => typeof item === 'string');
  return details.length > 0 ? details : [refusal.message];
}

export interface FormSubmitAttemptConfig<TResult extends { name: string }> extends NamedEntrySubmitConfig {
  entry: { mode: 'create' | 'edit'; name?: string };
  /** Validates (via `check`), confirms and builds the result once; `undefined` aborts the attempt. */
  prepare: () => TResult | undefined | Promise<TResult | undefined>;
  /** Maps a refusal to the messages the form lists; defaults to the refusal's one message. */
  refusalMessages?: (refusal: MessageRefusal) => readonly string[];
  /** Runs when the server refused the editable name as taken; the name field already shows it. */
  onNameConflict?: () => void;
  /** Defaults to `'touched'`. */
  reveal?: ErrorReveal;
  /** Whether `check` lets the form through; defaults to any status but invalid (so a pending form passes). */
  accepts?: (form: AbstractControl) => boolean;
}

/**
 * Form Submit Attempt: the state one named-entry form keeps for an attempted submit. It owns
 * whether a submit was attempted, the in-flight flag, the refusal messages (always a list, cleared
 * on the next edit), marking every field touched, and the rule for when a control's error shows.
 * It composes `NamedEntrySubmit` for the write lifecycle; the form keeps its fields and rendering.
 */
export class FormSubmitAttempt<TResult extends { name: string }> {
  readonly #config: FormSubmitAttemptConfig<TResult>;
  readonly #entrySubmit: NamedEntrySubmit<TResult>;
  readonly #attempted = signal(false);
  readonly #errors = signal<readonly string[]>([]);

  /** True once a submit was attempted; never reset. */
  readonly attempted: Signal<boolean> = this.#attempted.asReadonly();
  /** What stopped the last attempt, as a list. Cleared on the next edit. */
  readonly errors: Signal<readonly string[]> = this.#errors.asReadonly();
  /** True from submit until the server has answered. */
  readonly saving: Signal<boolean>;
  readonly nameValidator: (control: AbstractControl) => ValidationErrors | null;

  constructor(config: FormSubmitAttemptConfig<TResult>) {
    this.#config = config;
    this.#entrySubmit = new NamedEntrySubmit(config);
    this.saving = this.#entrySubmit.saving;
    this.nameValidator = this.#entrySubmit.nameValidator;
  }

  /** Records the attempt. True when the form may be submitted; otherwise marks every field so its error shows. */
  check(form: AbstractControl): boolean {
    this.#attempted.set(true);
    if (this.#config.accepts ? this.#config.accepts(form) : !form.invalid) return true;
    form.markAllAsTouched();
    return false;
  }

  /** Whether the form shows this control's errors yet. */
  reveals(control: AbstractControl): boolean {
    if (control.touched) return true;
    return this.#config.reveal === 'touched-dirty-attempted' && (control.dirty || this.#attempted());
  }

  showError(control: AbstractControl, error?: string): boolean {
    if (!this.reveals(control)) return false;
    return error ? control.hasError(error) : control.invalid;
  }

  fail(messages: readonly string[]): void {
    this.#errors.set(messages);
  }

  clear(): void {
    this.#errors.set([]);
  }

  /** Clears the messages whenever `form` changes; the caller releases the subscription. */
  clearOnEdit(form: AbstractControl): Subscription {
    return form.valueChanges.subscribe(() => this.clear());
  }

  /** Ignored while a write is in flight. */
  submit(options: NamedEntryWrite<TResult>): Promise<void> {
    const { entry, prepare, refusalMessages, onNameConflict } = this.#config;
    return this.#entrySubmit.submit({
      ...options,
      entry,
      prepare,
      onRefusal: (refusal) => {
        if (refusal.kind === 'name-conflict') onNameConflict?.();
        else this.fail(refusalMessages ? refusalMessages(refusal) : [refusal.message]);
      },
    });
  }
}
