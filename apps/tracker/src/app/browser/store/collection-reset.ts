import { patchState, signalStoreFeature, type, withMethods, withProps, withState } from '@ngrx/signals';

export interface CollectionResetRegistry {
  _collectionResets: Array<{ keys: string[]; reset: () => void }>;
}

/** One registry per store instance; callbacks are registered only during construction. */
export function withCollectionResetRegistry() {
  return withProps((): CollectionResetRegistry => ({ _collectionResets: [] }));
}

/** Declaring per-collection state also registers its reset, so there is no second list to maintain. */
export function withCollectionState<State extends object>(initialState: State) {
  return signalStoreFeature(
    { props: type<CollectionResetRegistry>() },
    withState(initialState),
    withMethods((store) => {
      store._collectionResets.push({
        keys: Object.keys(initialState),
        reset: () => patchState(store, initialState),
      });
      return {};
    }),
  );
}
