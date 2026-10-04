import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommandProject, type CommandProject } from '../testing/command-project';
import { moveResourceCommand } from './move';

describe('moveResourceCommand (real core)', () => {
  let project: CommandProject;

  beforeEach(() => {
    project = createCommandProject();
  });
  afterEach(() => project.cleanup());

  it('prints the typed missing destination and exits 1', async () => {
    const result = await project.run(moveResourceCommand, {
      collection: 'main',
      source: 'a.ok',
      dest: 'b.ok',
      destCollection: 'missing',
    });
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain('Destination collection "missing" not found');
  });

  it('prints the identical malformed-pattern message through the typed-error path and exits 1', async () => {
    project.seed('a.ok');
    const result = await project.run(moveResourceCommand, { collection: 'main', source: 'invalid@char*', dest: 'b' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '❌ Key validation: Invalid key segment "invalid@char". Segments must match pattern [A-Za-z0-9_-]+',
    );
    expect(result.stderr).not.toContain('Errors:');
    expect(project.exists('translations/main/a/resource_entries.json')).toBe(true);
  });
});
