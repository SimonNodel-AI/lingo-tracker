import { describe, expect, it } from 'vitest';
import { bundledFormIfLost } from './icu-round-trip';

describe('bundledFormIfLost', () => {
  it('reports literal single braces that become interpolation', () => {
    expect(bundledFormIfLost('Use {Native} for the native title')).toBe('Use {{ Native }} for the native title');
  });

  it('reports multiple literal single-brace values', () => {
    expect(bundledFormIfLost('Showing {first} to {last} of {totalRecords} entries')).toBe(
      'Showing {{ first }} to {{ last }} of {{ totalRecords }} entries',
    );
  });

  it('reports a formatted interpolation that prevents conversion back from ICU', () => {
    expect(bundledFormIfLost('No-show fee of {{amount, currency}} charged for {{title}} at {{date}}')).toBe(
      'No-show fee of {{amount, currency}} charged for {title} at {date}',
    );
  });

  it('reports an i18next reference with a nested interpolation', () => {
    expect(bundledFormIfLost('You have $t(day, {"count": {{days}} }) left')).toBe(
      'You have $t(day, {"count": {days} }) left',
    );
  });

  it('reports quoted brace interpolations in HTML', () => {
    expect(
      bundledFormIfLost("<strong>{{ fileCount }}</strong> file(s). Use <code>{{ '{' }}SeriesName{{ '}' }}</code>"),
    ).toBe("<strong>{fileCount}</strong> file(s). Use <code>{{ '{' }}SeriesName{{ '}' }}</code>");
  });

  it('ignores interpolation whitespace introduced by bundling', () => {
    expect(bundledFormIfLost('Hello {{name}}')).toBeUndefined();
  });

  it('preserves a natural apostrophe after an interpolation', () => {
    expect(bundledFormIfLost("{{username}}'s Profile")).toBeUndefined();
  });

  it('preserves ICU plurals', () => {
    expect(bundledFormIfLost('{count, plural, one {# item} other {# items}}')).toBeUndefined();
  });
});
