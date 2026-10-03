import type { TreeStatusResponseDto } from '@simoncodes-ca/data-transfer';
import type { TreeRead } from '../cache/collection-index.service';

/** Maps an unavailable index read to the tree endpoint's retry body. */
export function describeIndexStatus(status: Exclude<TreeRead['status'], 'ready'>): TreeStatusResponseDto {
  return status === 'indexing'
    ? { status: 'indexing', message: 'Collection is currently being indexed. Please try again shortly.' }
    : {
        status: 'not-ready',
        message:
          status === 'error'
            ? 'Cache indexing failed, re-indexing collection. Please try again shortly.'
            : 'Collection indexing started. Please try again shortly.',
      };
}
