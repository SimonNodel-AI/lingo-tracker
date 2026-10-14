import baseConfig from '../../eslint.config.mjs';

const boundaryConfig = baseConfig.find((config) => config.rules?.['@nx/enforce-module-boundaries']);
if (!boundaryConfig) {
  throw new Error('API ESLint configuration requires @nx/enforce-module-boundaries in the base configuration.');
}
const [boundarySeverity, boundaryOptions] = boundaryConfig.rules['@nx/enforce-module-boundaries'];

export default [
  ...baseConfig,
  {
    files: ['apps/api/src/app/errors/lingo-tracker-exception.filter.spec.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        boundarySeverity,
        {
          ...boundaryOptions,
          // Contract fixtures need private error classes without expanding core's public barrel.
          allow: [...boundaryOptions.allow, '../../../../../libs/core/src/lib/errors/internal'],
        },
      ],
    },
  },
];
