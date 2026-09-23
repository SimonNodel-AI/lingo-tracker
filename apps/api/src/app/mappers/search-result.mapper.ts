import type { Collection, SearchResult } from '@simoncodes-ca/core';
import type { SearchResultDto } from '@simoncodes-ca/data-transfer';
import { buildResourceSummary } from '@simoncodes-ca/domain';

/** Maps a search hit to its DTO: the entry's Resource Summary plus how it matched. */
export function mapSearchResultToDto(searchResult: SearchResult, collection: Collection): SearchResultDto {
  return {
    ...buildResourceSummary(searchResult.key, searchResult, collection),
    matchType: searchResult.matchType,
    matchedLocales: searchResult.matchedLocales,
  };
}

/** Maps search hits to DTOs, keeping their order. */
export function mapSearchResultsToDto(searchResults: SearchResult[], collection: Collection): SearchResultDto[] {
  return searchResults.map((result) => mapSearchResultToDto(result, collection));
}
