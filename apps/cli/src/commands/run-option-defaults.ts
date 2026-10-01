import { DEFAULT_IMPORT_STRATEGY } from '@simoncodes-ca/domain';

/** Values applied after import and export prompts; help uses the same values. */
export const EXPORT_DEFAULTS = {
  status: 'new,stale',
  structure: 'hierarchical' as const,
  rich: false,
  includeBase: false,
  includeStatus: false,
  includeComment: false,
  includeTags: false,
};

export const IMPORT_DEFAULTS = {
  strategy: DEFAULT_IMPORT_STRATEGY,
  preserveStatus: false,
  validateBase: true,
};
