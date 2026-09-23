import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  type Collection,
  CollectionNotFoundError,
  type LingoTrackerConfig,
  openCollection,
  ReadOnlyCollectionError,
} from '@simoncodes-ca/core';

/**
 * Resolves a `:collectionName` route param (URI-encoded) to its effective collection
 * with core `openCollection`, or throws a 404. The only place API controllers decode a
 * collection name or check that it exists.
 *
 * Read-only collections are returned too: `WritableCollectionGuard` refuses mutating
 * requests before a controller runs.
 */
export function openRouteCollection(config: LingoTrackerConfig, routeName: string): Collection {
  return openNamedCollection(config, decodeURIComponent(routeName), (name) => `Collection "${name}" not found`, false);
}

/**
 * Resolves the destination collection of a cross-collection move (a URI-encoded body
 * field), or throws a 404 naming it as the destination. The destination is written to, so
 * a read-only one throws a 403 (`WritableCollectionGuard` only checks the route collection).
 */
export function openDestinationCollection(config: LingoTrackerConfig, encodedName: string): Collection {
  return openNamedCollection(
    config,
    decodeURIComponent(encodedName),
    (name) => `Destination collection "${name}" not found`,
    true,
  );
}

function openNamedCollection(
  config: LingoTrackerConfig,
  name: string,
  notFoundMessage: (name: string) => string,
  writable: boolean,
): Collection {
  try {
    return openCollection(config, name, { writable });
  } catch (error: unknown) {
    if (error instanceof CollectionNotFoundError) {
      throw new NotFoundException(notFoundMessage(name));
    }
    if (error instanceof ReadOnlyCollectionError) {
      throw new ForbiddenException(error.message);
    }
    throw error;
  }
}
