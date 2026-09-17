import type { BundleDefinitionDto } from './bundle-definition.dto';

export interface CreateBundleDto {
  /** Bundle key in the project config. Must be filesystem-safe and unique. */
  name: string;

  /** Bundle definition */
  bundle: BundleDefinitionDto;
}
