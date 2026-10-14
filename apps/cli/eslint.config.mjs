import baseConfig from '../../eslint.config.mjs';

const boundaryConfig = baseConfig.find((config) => config.rules?.['@nx/enforce-module-boundaries']);
if (!boundaryConfig) {
  throw new Error('CLI ESLint configuration requires @nx/enforce-module-boundaries in the base configuration.');
}
const [boundarySeverity, boundaryOptions] = boundaryConfig.rules['@nx/enforce-module-boundaries'];

const cliBoundaryOptions = {
  ...boundaryOptions,
  // The manifest defers handlers (and core) until execution; handlers import core statically.
  checkDynamicDependenciesExceptions: ['@simoncodes-ca/core'],
};

export default [
  ...baseConfig,
  {
    files: ['apps/cli/**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@nx/enforce-module-boundaries': [boundarySeverity, cliBoundaryOptions],
    },
  },
  {
    files: [
      'apps/cli/src/commands/add-locale.spec.ts',
      'apps/cli/src/commands/edit-collection.test.ts',
      'apps/cli/src/commands/translate-locale.test.ts',
      'apps/cli/src/delete-collection/delete-collection.test.ts',
      'apps/cli/src/runner/command-runner.spec.ts',
      'apps/cli/src/runner/cli-error-wording.spec.ts',
    ],
    rules: {
      '@nx/enforce-module-boundaries': [
        boundarySeverity,
        {
          ...cliBoundaryOptions,
          // Contract fixtures need private error classes without expanding core's public barrel.
          // This exhaustive contract also checks the private catalogue's runtime code lists.
          allow: [
            ...boundaryOptions.allow,
            '../../../../libs/core/src/lib/errors/lingo-tracker-error',
            '../../../../libs/core/src/lib/errors/internal',
            '../../../../libs/core/src/lib/errors/error-codes',
          ],
        },
      ],
    },
  },
];
