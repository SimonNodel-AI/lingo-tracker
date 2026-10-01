import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  type Collection,
  CollectionNotFoundError,
  type LingoTrackerConfig,
  openCollection,
  ReadOnlyCollectionError,
} from '@simoncodes-ca/core';

/** Opens the plain destination collection name of a cross-collection move. */
export function openDestinationCollection(config: LingoTrackerConfig, name: string): Collection {
  try {
    return openCollection(config, name, { writable: true });
  } catch (error: unknown) {
    if (error instanceof CollectionNotFoundError) {
      throw new NotFoundException(`Destination collection "${name}" not found`);
    }
    if (error instanceof ReadOnlyCollectionError) {
      throw new ForbiddenException(error.message);
    }
    throw error;
  }
}
