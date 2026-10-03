import {
  type Collection,
  type NormalizedSearchRequest,
  type SearchPage,
  type SearchResult,
  normalizeSearchRequest,
} from '@simoncodes-ca/core';
import type { SearchResultDto, SearchResultsDto } from '@simoncodes-ca/data-transfer';
import { buildResourceSummary } from '@simoncodes-ca/domain';
import type { SearchQuery } from '../validation/dto-schemas';

/** Default page size for API searches; core applies its shared limit cap. */
const DEFAULT_SEARCH_LIMIT = 100;

/** Converts query-string values and delegates blank queries and limits to Resource Search. */
export function searchRequestFromQuery(dto: SearchQuery): NormalizedSearchRequest {
  return normalizeSearchRequest(
    {
      query: dto.query ?? '',
      mode: dto.mode === 'similar' ? 'similar-value' : 'text',
      limit: dto.maxResults === undefined ? undefined : Number(dto.maxResults),
    },
    DEFAULT_SEARCH_LIMIT,
  );
}

/** Maps the normalized blank-query outcome, preserving the original query. */
export function blankSearchResults(query: string | undefined): SearchResultsDto {
  return { query: query || '', results: [], totalFound: 0, limited: false };
}

/** Maps a search page, preserving the original query. */
export function mapSearchPageToDto(
  query: string | undefined,
  page: SearchPage,
  collection: Collection,
): SearchResultsDto {
  return {
    query: query ?? '',
    results: mapSearchResultsToDto(page.results, collection),
    totalFound: page.totalFound,
    limited: page.limited,
  };
}

/** Maps a search hit to its DTO: the entry's Resource Summary plus how it matched. */
export function mapSearchResultToDto(searchResult: SearchResult, collection: Collection): SearchResultDto {
  return {
    ...buildResourceSummary(searchResult.key, searchResult, collection),
    matchType: searchResult.matchType,
    matchedLocales: searchResult.matchedLocales,
    ...(searchResult.similarity !== undefined && { similarity: searchResult.similarity }),
  };
}

/** Maps search hits to DTOs, keeping their order. */
export function mapSearchResultsToDto(searchResults: SearchResult[], collection: Collection): SearchResultDto[] {
  return searchResults.map((result) => mapSearchResultToDto(result, collection));
}
