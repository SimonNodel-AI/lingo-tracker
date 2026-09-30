// The bundle module: plan or generate bundles, and edit the bundle definitions in config.

export {
  addBundleDefinition,
  type BundleDefinitionOperationOptions,
  deleteBundleDefinition,
  type UpdateBundleDefinitionOptions,
  updateBundleDefinition,
} from './bundle-definition-operations';
export {
  type BundleProgressEvent,
  type BundleTypeOutcome,
  type GenerateBundleParams,
  type GenerateBundleResult,
  generateBundle,
  validateBundleLocales,
  validateGenerateBundleRequest,
} from './generate-bundle';
export {
  generateBundles,
  type BundleRunOutcome,
  type GenerateBundlesOptions,
  type GenerateBundlesResult,
} from './generate-bundles';
export {
  type BundlePlan,
  type BundlePlanExampleKey,
  type BundlePlanFile,
  type PlanBundleParams,
  planBundle,
} from './plan-bundle';
