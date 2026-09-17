import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  LingoTrackerConfigDto,
  CreateCollectionDto,
  UpdateCollectionDto,
  UpdateConfigDto,
  CreateBundleDto,
  UpdateBundleDto,
  BundleDryRunRequestDto,
  BundleDryRunResultDto,
  GenerateBundleRequestDto,
  BundleGenerateJobDto,
} from '@simoncodes-ca/data-transfer';

/**
 * Service for making API calls related to collections management.
 */
@Injectable({
  providedIn: 'root',
})
export class CollectionsApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = '/api';

  /**
   * Fetches the complete LingoTracker configuration including all collections.
   */
  getConfig(): Observable<LingoTrackerConfigDto> {
    return this.http.get<LingoTrackerConfigDto>(`${this.apiBase}/config`);
  }

  /**
   * Creates a new collection.
   */
  createCollection(data: CreateCollectionDto): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/collections`, data);
  }

  /**
   * Updates an existing collection (including renaming).
   * @param name Current collection name (URI encoded by HttpClient)
   * @param data Update payload with optional new name and collection config
   */
  updateCollection(name: string, data: UpdateCollectionDto): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiBase}/collections/${encodeURIComponent(name)}`, data);
  }

  /**
   * Deletes a collection by name.
   * @param name Collection name to delete (URI encoded by HttpClient)
   */
  deleteCollection(name: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/collections/${encodeURIComponent(name)}`);
  }

  /**
   * Updates supported global config fields (e.g., protected terms).
   */
  updateConfig(dto: UpdateConfigDto): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiBase}/config`, dto);
  }

  /**
   * Creates a new bundle definition in the project config.
   */
  createBundle(data: CreateBundleDto): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiBase}/bundles`, data);
  }

  /**
   * Updates an existing bundle definition (including renaming).
   * @param name Current bundle name
   * @param data Update payload with optional new name and bundle definition
   */
  updateBundle(name: string, data: UpdateBundleDto): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiBase}/bundles/${encodeURIComponent(name)}`, data);
  }

  /**
   * Deletes a bundle definition by name.
   */
  deleteBundle(name: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/bundles/${encodeURIComponent(name)}`);
  }

  /**
   * Plans a bundle without writing files. The definition does not need to be saved.
   */
  dryRunBundle(data: BundleDryRunRequestDto): Observable<BundleDryRunResultDto> {
    return this.http.post<BundleDryRunResultDto>(`${this.apiBase}/bundles/dry-run`, data);
  }

  /**
   * Starts a bundle generation job. Responds with 202 and the initial job snapshot.
   * Poll {@link getBundleJob} for progress.
   */
  generateBundle(name: string, data: GenerateBundleRequestDto = {}): Observable<BundleGenerateJobDto> {
    return this.http.post<BundleGenerateJobDto>(`${this.apiBase}/bundles/${encodeURIComponent(name)}/generate`, data);
  }

  /**
   * Fetches a snapshot of a bundle generation job.
   */
  getBundleJob(jobId: string): Observable<BundleGenerateJobDto> {
    return this.http.get<BundleGenerateJobDto>(`${this.apiBase}/bundles/jobs/${encodeURIComponent(jobId)}`);
  }
}
