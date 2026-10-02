import { describeIndexStatus } from './index-status.mapper';

describe('describeIndexStatus', () => {
  it('describes an index already running', () => {
    expect(describeIndexStatus('indexing')).toStrictEqual({
      status: 'indexing',
      message: 'Collection is currently being indexed. Please try again shortly.',
    });
  });

  it('describes indexing started by the read', () => {
    expect(describeIndexStatus('not-started')).toStrictEqual({
      status: 'not-ready',
      message: 'Collection indexing started. Please try again shortly.',
    });
  });

  it('describes a retry after an indexing error', () => {
    expect(describeIndexStatus('error')).toStrictEqual({
      status: 'not-ready',
      message: 'Cache indexing failed, re-indexing collection. Please try again shortly.',
    });
  });
});
