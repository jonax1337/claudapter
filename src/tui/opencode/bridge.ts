import { onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

type StateSource<T> = {
  state: T;
  subscribe(listener: () => void): () => void;
};

export function useControllerState<T extends object>(controller: StateSource<T>) {
  const [state, setState] = createStore(structuredClone(controller.state));
  const unsubscribe = controller.subscribe(() => setState(reconcile(structuredClone(controller.state), { key: 'id' })));
  onCleanup(unsubscribe);
  return () => state;
}
