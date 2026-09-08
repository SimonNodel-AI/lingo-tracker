import { Pipe, type PipeTransform, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { escapeRegExp } from '@simoncodes-ca/domain';
import { truncateKey } from '../utils/truncate-key';

const MINIMUM_SEARCH_LENGTH = 3;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

/**
 * Break opportunities inside a resource key: after a run of separators (matched as
 * a run so the truncation ellipsis is never split) and at each camelCase hump,
 * which is where a key's own word boundaries are.
 */
const BREAK_POINTS = /(?<=\.)(?!\.)|(?<=[a-z0-9])(?=[A-Z])/g;

/**
 * Renders a dot-delimited resource key for display: shortens it, marks search
 * matches, and adds `<wbr>` break opportunities so a key too wide for its chip
 * wraps at its own word boundaries instead of being sliced mid-token.
 *
 * Truncation, highlighting and break opportunities are resolved together because
 * they overlap: the breaks are markup a downstream highlight pipe would escape,
 * and a break can fall on the same index where a search match starts or ends.
 */
@Pipe({
  name: 'keyMarkup',
  standalone: true,
  pure: true,
})
export class KeyMarkupPipe implements PipeTransform {
  readonly #sanitizer = inject(DomSanitizer);

  transform(key: string | null | undefined, searchTerm?: string | null): SafeHtml {
    if (!key) {
      return '';
    }

    const text = truncateKey(key);
    const term = searchTerm ?? '';
    const matches = term.length < MINIMUM_SEARCH_LENGTH ? [] : this.#matchRanges(text, term);
    const breaks = new Set([...text.matchAll(BREAK_POINTS)].map((match) => match.index ?? 0));

    let html = '';

    for (let index = 0; index < text.length; index += 1) {
      if (breaks.has(index)) html += '<wbr>';
      if (matches.some(([start]) => start === index)) html += '<mark class="search-highlight">';

      const char = text[index];
      html += HTML_ESCAPES[char] ?? char;

      if (matches.some(([, end]) => end === index + 1)) html += '</mark>';
    }

    return this.#sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Start/end index pairs for every occurrence of the search term. */
  #matchRanges(text: string, term: string): Array<[number, number]> {
    const pattern = new RegExp(escapeRegExp(term), 'gi');

    return [...text.matchAll(pattern)].map((match) => {
      const start = match.index ?? 0;
      return [start, start + match[0].length];
    });
  }
}
