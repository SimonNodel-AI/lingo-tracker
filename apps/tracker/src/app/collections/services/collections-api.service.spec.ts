import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { createServiceFactory } from '@ngneat/spectator/vitest';
import { describe, expect, it } from 'vitest';
import { CollectionsApiService } from './collections-api.service';

const createService = createServiceFactory({
  service: CollectionsApiService,
  providers: [provideHttpClient(), provideHttpClientTesting()],
});
describe('CollectionsApiService exports', () => {
  it('posts dry runs with the DTO body', () => {
    const spectator = createService();
    const http = spectator.inject(HttpTestingController);
    const request = { format: 'xliff' as const };
    spectator.service.dryRunExport(request).subscribe();
    const pending = http.expectOne('/api/exports/dry-run');
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual(request);
    pending.flush({});
    http.verify();
  });
  it('posts export jobs with the DTO body', () => {
    const spectator = createService();
    const http = spectator.inject(HttpTestingController);
    const request = { format: 'json' as const };
    spectator.service.startExport(request).subscribe();
    const pending = http.expectOne('/api/exports');
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual(request);
    pending.flush({});
    http.verify();
  });
  it('encodes job ids in the manifest route', () => {
    const spectator = createService();
    const http = spectator.inject(HttpTestingController);
    spectator.service.getExportJob('a/b c').subscribe();
    const pending = http.expectOne('/api/exports/jobs/a%2Fb%20c');
    expect(pending.request.method).toBe('GET');
    pending.flush({});
    http.verify();
  });
});
