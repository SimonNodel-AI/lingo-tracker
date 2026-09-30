import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BundleDefinition } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { seedResources, testCollection, useTempDir } from '../../testing/temp-dir.spec-helpers';
import { generateBundle } from './generate-bundle';
import { planBundle } from './plan-bundle';

describe('bundle plan and generation parity', () => {
  const root = useTempDir('bundle-run-parity-');

  it('shares warnings and populated key counts while planning empty locales', async () => {
    const folder = join(root(), 'common');
    seedResources(testCollection(folder, { name: 'common', locales: ['en', 'fr', 'es'] }), {
      greeting: { source: 'Hello {name}', translations: { fr: 'Bonjour {name}' } },
      broken: { source: 'Broken {', translations: { fr: 'Cassé {' } },
    });
    const definition: BundleDefinition = {
      bundleName: '{locale}',
      dist: 'out',
      collections: 'All',
      typeDistFile: 'types/tokens.ts',
    };
    const config: LingoTrackerConfig = {
      exportFolder: 'export',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr', 'es'],
      collections: { common: { translationsFolder: folder } },
      bundles: { main: definition },
    };

    const plan = planBundle({
      bundleKey: 'main',
      bundleDefinition: definition,
      config,
      cwd: root(),
      locales: ['fr', 'es'],
      tokenConstantName: 'CUSTOM_TOKENS',
    });
    const generated = await generateBundle({
      bundleKey: 'main',
      config,
      cwd: root(),
      locales: ['fr', 'es'],
      tokenConstantName: 'CUSTOM_TOKENS',
    });

    expect(plan.locales).toEqual(['fr', 'es']);
    expect(plan.keysPerLocale).toEqual({ fr: 2, es: 0 });
    expect(generated.keysPerLocale).toEqual({ fr: plan.keysPerLocale['fr'] });
    expect(generated.warnings).toEqual(plan.warnings);
    expect(plan.exampleKey?.tokenPath).toMatch(/^CUSTOM_TOKENS\./);
    expect(generated.writtenFiles).toEqual(['out/fr.json', 'types/tokens.ts']);
    expect(generated.typeOutcome).toMatchObject({ status: 'written', keysCount: 2 });
  });
});
