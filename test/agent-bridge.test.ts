import { expect, test } from 'bun:test';
import { createRoot } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { useControllerState } from '../src/tui/opencode/bridge';

type Entry = { id: string; kind: string; text: string; status?: string; input?: Record<string, unknown> };
type State = { busy: boolean; entries: Entry[]; tasks: Record<string, unknown>; lastRoute?: { actual: string } };

const ENTRIES = 2000;
const UPDATES = 200;

function fixtureController() {
  const listeners = new Set<() => void>();
  const state: State = { busy: true, tasks: {}, lastRoute: { actual: 'fixture-model' }, entries: Array.from({ length: ENTRIES }, (_, index) => ({
    id: 'entry-' + index, kind: index % 3 ? 'assistant' : 'tool', text: 'Fixture text '.repeat(20) + index,
    ...(index % 3 ? {} : { status: 'done', input: { file_path: 'src/file-' + index + '.ts', command: 'npm test' } }),
  })) };
  return {
    state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    emit() { listeners.forEach(listener => listener()); },
  };
}

/** The previous bridge: a full structured clone and a full reconcile on every change. */
function previousBridgeCost() {
  const controller = fixtureController();
  const [, setState] = createStore(structuredClone(controller.state));
  const started = performance.now();
  for (let update = 0; update < UPDATES; update++) {
    controller.state.entries[ENTRIES - 1].text += ' delta';
    setState(reconcile(structuredClone(controller.state), { key: 'id' }));
  }
  return performance.now() - started;
}

test('streamed updates copy only changed entries and stay far below the full clone-and-reconcile cost', () => {
  const baseline = createRoot(dispose => { const cost = previousBridgeCost(); dispose(); return cost; });
  const controller = fixtureController();
  createRoot(dispose => {
    const state = useControllerState(controller);
    const firstRow = state().entries[0];
    const started = performance.now();
    for (let update = 0; update < UPDATES; update++) {
      controller.state.entries[ENTRIES - 1].text += ' delta';
      controller.emit();
    }
    const cost = performance.now() - started;
    expect(state().entries[ENTRIES - 1].text.endsWith(' delta'.repeat(UPDATES))).toBe(true);
    expect(state().entries[0]).toBe(firstRow);
    expect(cost).toBeLessThan(baseline / 3);
    dispose();
  });
});

test('replaced, appended and removed entries, other state and deleted keys still reach the store', () => {
  const controller = fixtureController();
  createRoot(dispose => {
    const state = useControllerState(controller);
    controller.state.entries[0] = { ...controller.state.entries[0], status: 'error' };
    controller.state.entries.push({ id: 'new', kind: 'user', text: 'Hello' });
    controller.state.busy = false;
    delete controller.state.lastRoute;
    controller.emit();
    expect(state().entries[0].status).toBe('error');
    expect(state().entries.at(-1)!.text).toBe('Hello');
    expect(state().busy).toBe(false);
    expect(state().lastRoute).toBeUndefined();
    controller.state.entries.splice(0, 10);
    controller.emit();
    expect(state().entries.length).toBe(ENTRIES - 9);
    expect(state().entries[0].id).toBe('entry-10');
    dispose();
  });
});
