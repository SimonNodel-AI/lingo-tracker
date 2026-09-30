import { describe, expect, it } from 'vitest';
import { ProtectedTermsChips } from './protected-terms-chips';

describe('ProtectedTermsChips', () => {
  it('keeps collection chips in insertion order and drops seeded values immediately', () => {
    const chips = new ProtectedTermsChips();
    chips.seedRaw(['iPhone', 'Node.js']);
    chips.add('  C++ ');
    chips.add('C++');
    expect(chips.values()).toEqual(['iPhone', 'Node.js', 'C++']);
    chips.remove('iPhone');
    expect(chips.values()).toEqual(['Node.js', 'C++']);
  });
});
