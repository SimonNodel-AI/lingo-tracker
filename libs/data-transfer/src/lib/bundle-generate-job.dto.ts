export type BundleGenerateJobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Request body for starting a bundle generation job. */
export interface GenerateBundleRequestDto {
  /** Locales to generate. Defaults to every configured locale. */
  readonly locales?: readonly string[];
}

export interface BundleGenerateJobProgressDto {
  /** Files written so far. */
  readonly current: number;

  /** Total files to write. */
  readonly total: number;

  /** Path of the file currently being written. */
  readonly currentFile?: string;
}

export interface BundleGenerateJobResultDto {
  /** Paths of the files written, relative to the project root. */
  readonly filesGenerated: readonly string[];

  /** Key count per locale. */
  readonly keysPerLocale: Record<string, number>;

  readonly warnings: readonly string[];

  readonly localesProcessed: readonly string[];

  /** Path of the generated types file, when types are enabled. */
  readonly typeDistFile?: string;

  /** Number of keys in the generated types file. */
  readonly typesKeysCount?: number;
}

export interface BundleGenerateJobDto {
  readonly jobId: string;
  readonly bundleName: string;
  readonly status: BundleGenerateJobStatus;
  readonly progress: BundleGenerateJobProgressDto;

  /** Present once `status` is `completed`. */
  readonly result?: BundleGenerateJobResultDto;

  /** Present once `status` is `failed`. */
  readonly error?: string;

  readonly startedAt?: string;
  readonly completedAt?: string;
}
