import type { BundleDefinitionDto } from './bundle-definition.dto';

export interface UpdateBundleDto {
  /** Optional new bundle name for renaming */
  name?: string;

  /** Updated bundle definition */
  bundle: BundleDefinitionDto;
}
