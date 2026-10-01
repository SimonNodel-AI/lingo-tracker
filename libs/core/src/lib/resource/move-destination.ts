import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { type Collection, openCollection } from '../config/open-collection';
import { CollectionNotFoundError } from '../errors/lingo-tracker-error';
import type { MutationSinkOptions } from './resource-mutation';

/** A named destination requires the config used to open it. */
export type MoveOptionsWithConfig = MutationSinkOptions & {
  readonly config: LingoTrackerConfig;
  readonly cwd?: string;
};

/** The source collection is used when no destination name is given. */
export type MoveOptions = MutationSinkOptions & {
  readonly config?: LingoTrackerConfig;
  readonly cwd?: string;
};

export function resolveMoveDestination(source: Collection, name: string | undefined, options: MoveOptions): Collection {
  if (!name) return source;
  if (!options.config) throw new Error('Move destination resolution requires config');
  try {
    return openCollection(options.config, name, { cwd: options.cwd, writable: true });
  } catch (error) {
    if (error instanceof CollectionNotFoundError) throw new CollectionNotFoundError(name, 'destination');
    throw error;
  }
}
