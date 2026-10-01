import type { Relocation } from './relocate-entries';

export type MoveSelection =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'pattern'; readonly prefix: string; readonly keys: readonly string[] }
  | {
      readonly kind: 'folder';
      readonly path: string;
      readonly keys: readonly string[];
      readonly nestUnderDestination?: boolean;
      readonly sameCollection?: boolean;
    }
  | { readonly kind: 'entry'; readonly key: string };

export interface MovePlan {
  readonly relocations: readonly Relocation[];
  readonly warnings: readonly string[];
}

/** Calculate full destination keys without opening a collection or touching the filesystem. */
export function planMove(selection: MoveSelection, destination: string): MovePlan {
  if (selection.kind === 'key') {
    return { relocations: [{ from: selection.key, to: destination }], warnings: [] };
  }
  if (selection.kind === 'entry') {
    const leaf = selection.key.slice(selection.key.lastIndexOf('.') + 1);
    // A blank moveTo has always named the collection root.
    const folder = destination.trim() ? destination : '';
    return {
      relocations: [{ from: selection.key, to: folder ? `${folder}.${leaf}` : leaf }],
      warnings: [],
    };
  }
  if (selection.kind === 'pattern') {
    return {
      relocations: selection.keys.map((from) => {
        const suffix = selection.prefix ? from.slice(selection.prefix.length + 1) : from;
        return { from, to: destination ? `${destination}.${suffix}` : suffix };
      }),
      warnings: [],
    };
  }

  const { path, keys, sameCollection = true, nestUnderDestination = true } = selection;
  if (sameCollection && path === destination) {
    return { relocations: [], warnings: ['Source and destination are the same. No move performed.'] };
  }
  const nest = nestUnderDestination || destination === '';
  const segments = path.split('.');
  if (sameCollection && nest && segments.slice(0, -1).join('.') === destination) {
    return { relocations: [], warnings: ['Folder is already at this location. No move performed.'] };
  }
  const folderName = segments[segments.length - 1];
  const prefix =
    nest || segments.length !== destination.split('.').length
      ? destination
        ? `${destination}.${folderName}`
        : folderName
      : destination;
  return {
    relocations: keys.map((from) => ({ from, to: `${prefix}${from.slice(path.length)}` })),
    warnings: [],
  };
}
