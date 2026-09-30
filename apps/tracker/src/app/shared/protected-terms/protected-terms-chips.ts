import { signal } from '@angular/core';
import { prepareProtectedTermAdd } from './protected-term-add';

/** The collection dialog's chip list: stored values stay verbatim, new values use the shared add rule. */
export class ProtectedTermsChips {
  readonly #values = signal<string[]>([]);
  readonly values = this.#values.asReadonly();

  seedRaw(values: readonly string[]): void {
    this.#values.set([...values]);
  }

  add(value: string): void {
    const result = prepareProtectedTermAdd(this.#values(), value);
    if (result.kind === 'added') this.#values.update((values) => [...values, result.term]);
  }

  remove(value: string): void {
    this.#values.update((values) => values.filter((term) => term !== value));
  }
}
