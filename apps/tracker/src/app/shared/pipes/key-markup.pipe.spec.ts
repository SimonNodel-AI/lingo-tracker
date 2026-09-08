import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { KeyMarkupPipe } from './key-markup.pipe';

describe('KeyMarkupPipe', () => {
  let pipe: KeyMarkupPipe;
  let sanitizer: DomSanitizer;

  const render = (key: string | null | undefined, searchTerm?: string): string => {
    const result = pipe.transform(key, searchTerm);
    return typeof result === 'string' ? result : (sanitizer.sanitize(1, result) ?? '');
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    pipe = TestBed.runInInjectionContext(() => new KeyMarkupPipe());
    sanitizer = TestBed.inject(DomSanitizer);
  });

  it('should add a break opportunity after every key separator', () => {
    expect(render('apps.common.buttons.ok')).toBe('apps.<wbr>common.<wbr>buttons.<wbr>ok');
  });

  it('should add a break opportunity at each camelCase hump', () => {
    expect(render('grid.addCurrentSelection')).toBe('grid.<wbr>add<wbr>Current<wbr>Selection');
  });

  it('should return an empty string for a missing key', () => {
    expect(render('')).toBe('');
    expect(render(null)).toBe('');
  });

  it('should keep the truncation ellipsis intact', () => {
    expect(render('a.b')).toBe('a.<wbr>b');
    expect(render(`first.${'segment.'.repeat(8)}last`)).not.toContain('.<wbr>.');
  });

  it('should truncate a long key before marking it up', () => {
    const key = `first.${'segment.'.repeat(8)}last`;
    const output = render(key);

    expect(output).toContain('first...<wbr>');
    expect(output).toContain('last');
    expect(output).not.toContain('segment.<wbr>segment');
  });

  it('should highlight a search match without losing break opportunities', () => {
    const output = render('apps.common.buttons.ok', 'common');

    expect(output).toContain('<mark class="search-highlight">common</mark>');
    expect(output).toBe('apps.<wbr><mark class="search-highlight">common</mark>.<wbr>buttons.<wbr>ok');
  });

  it('should keep escaped entities intact across break points', () => {
    expect(render('a&b.cD')).toBe('a&amp;b.<wbr>c<wbr>D');
  });

  it('should keep a break opportunity that lands where a match begins', () => {
    expect(render('apps.common', 'common')).toBe('apps.<wbr><mark class="search-highlight">common</mark>');
  });

  it('should ignore a search term shorter than three characters', () => {
    expect(render('apps.common.ok', 'ok')).not.toContain('<mark');
  });

  it('should escape markup in the key even when a search term is present', () => {
    const output = render('apps.<img>.common', 'common');

    expect(output).not.toContain('<img>');
    expect(output).toContain('&lt;img&gt;');
  });
});
