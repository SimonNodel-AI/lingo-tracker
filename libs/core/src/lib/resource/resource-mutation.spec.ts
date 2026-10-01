import { describe, expect, it, vi } from 'vitest';
import { saveReporting, type ResourceMutation } from './resource-mutation';

describe('saveReporting', () => {
  const saved = (): ResourceMutation[] => [{ kind: 'remove', translationsFolder: '/translations', key: 'common.ok' }];

  it('delivers saved mutations after a successful save', () => {
    const events: string[] = [];
    const onMutation = (mutation: ResourceMutation): void => {
      events.push(mutation.kind);
    };
    saveReporting(
      {
        save: () => {
          events.push('save');
        },
      },
      '/translations',
      onMutation,
      saved,
    );
    expect(events).toEqual(['save', 'remove']);
  });

  it('delivers one reindex and rethrows when the save fails', () => {
    const collected: ResourceMutation[] = [];
    const failure = new Error('metadata write failed');
    expect(() =>
      saveReporting(
        {
          save: () => {
            throw failure;
          },
        },
        '/translations',
        (mutation) => {
          collected.push(mutation);
        },
        saved,
      ),
    ).toThrow(failure);
    expect(collected).toEqual([{ kind: 'reindex', translationsFolder: '/translations' }]);
  });

  it('does not build mutations when no sink was supplied', () => {
    const build = vi.fn(saved);
    saveReporting({ save: vi.fn() }, '/translations', undefined, build);
    expect(build).not.toHaveBeenCalled();
  });
});
