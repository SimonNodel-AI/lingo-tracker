import { type BundleTypeOutcome, type BundleWarning, bundleTypeOutcomeDetail } from './generate-bundle';

interface BundleTypeFindings {
  readonly written?: { readonly path: string; readonly keysCount: number };
  readonly failure?: string;
  readonly skipped?: string;
}

/** Classifies finished results or prepared advisories without changing warning order or text. */
export function bundleFindings(result: {
  readonly warnings: readonly BundleWarning[];
  readonly typeOutcome?: BundleTypeOutcome;
}) {
  const messages: string[] = [];
  const byOrigin: Record<BundleWarning['origin'], string[]> = { generation: [], config: [], type: [] };
  for (const warning of result.warnings) {
    messages.push(warning.message);
    byOrigin[warning.origin].push(warning.message);
  }
  return { messages, byOrigin, types: typeFindings(result.typeOutcome) };
}

function typeFindings(outcome: BundleTypeOutcome | undefined): BundleTypeFindings {
  if (!outcome) return {};
  switch (outcome.status) {
    case 'written':
      return { written: { path: outcome.path, keysCount: outcome.keysCount } };
    case 'failed':
      return { failure: outcome.reason };
    case 'skipped':
    case 'not-configured':
      return { skipped: bundleTypeOutcomeDetail(outcome) };
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unknown bundle type outcome: ${unhandled}`);
    }
  }
}
