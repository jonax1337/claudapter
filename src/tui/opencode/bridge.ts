import { batch, createEffect, onCleanup } from 'solid-js';
import { createStore, reconcile, type SetStoreFunction } from 'solid-js/store';

type Entry = { id: string; text?: unknown };
type StateSource<T> = {
  state: T;
  subscribe(listener: () => void): () => void;
};
type PathSetter = (...path: unknown[]) => void;
const KEYED = { key: 'id' } as const;
const ENTRIES = 'entries';

/**
 * Which transcript entries changed since the last update. The controller replaces an entry object on every
 * change except streamed text, which it appends in place, so object identity plus text identify a version.
 */
class EntryVersions {
  private texts = new WeakMap<Entry, unknown>();
  private ids: string[] = [];

  /** Rows that kept their position and only changed or were appended; undefined when rows moved or vanished. */
  changedRows(entries: Entry[]): number[] | undefined {
    const kept = entries.length >= this.ids.length && this.ids.every((id, index) => entries[index].id === id);
    const changed = entries.flatMap((entry, index) => this.isCurrent(entry) ? [] : [index]);
    this.remember(entries);
    return kept ? changed : undefined;
  }

  remember(entries: Entry[]) {
    for (const entry of entries) this.texts.set(entry, entry.text);
    this.ids = entries.map(entry => entry.id);
  }

  private isCurrent(entry: Entry) {
    return this.texts.has(entry) && this.texts.get(entry) === entry.text;
  }
}

/**
 * Applies controller state to the store. Transcript rows are reconciled one by one and only when they changed:
 * reconciling the whole transcript walks every row, which made each streamed token cost time proportional to
 * the transcript length. Every other key is small and reconciled as before; keys the controller deleted are cleared.
 */
class StateMirror<T extends object> {
  private readonly versions = new EntryVersions();
  private keys: string[];

  constructor(source: T, private readonly set: PathSetter) {
    this.keys = Object.keys(source);
    this.versions.remember(entriesOf(source));
  }

  apply(source: T) {
    const keys = Object.keys(source);
    for (const removed of this.keys.filter(key => !keys.includes(key))) this.set(removed, undefined);
    this.keys = keys;
    for (const key of keys) if (key !== ENTRIES) this.set(key, reconcile(structuredClone((source as Record<string, unknown>)[key]), KEYED));
    if (keys.includes(ENTRIES)) this.applyEntries(entriesOf(source));
  }

  private applyEntries(entries: Entry[]) {
    const rows = this.versions.changedRows(entries);
    if (!rows) { this.set(ENTRIES, reconcile(structuredClone(entries), KEYED)); return; }
    for (const index of rows) this.set(ENTRIES, index, reconcile(structuredClone(entries[index]), KEYED));
  }
}

function entriesOf(state: object): Entry[] {
  return (state as { entries?: Entry[] }).entries ?? [];
}

/** Mirrors controller state into a Solid store, synchronously on every change event. */
export function useControllerState<T extends object>(controller: StateSource<T>) {
  const [state, setState] = createStore(structuredClone(controller.state));
  const mirror = new StateMirror(controller.state, (setState as SetStoreFunction<T> & PathSetter));
  onCleanup(controller.subscribe(() => batch(() => mirror.apply(controller.state))));
  return () => state;
}

/**
 * The live transcript of one sub-agent, kept outside the shared state so streaming agents do not copy every
 * agent transcript on each frame. It is reloaded when the agent's revision changes; entries keep their identity.
 */
export function useAgentEntries<T extends { id: string }>(load: (agentId: string) => T[], agentId: () => string, revision: () => number | undefined) {
  const [entries, setEntries] = createStore<T[]>([]);
  createEffect(() => { revision(); setEntries(reconcile(load(agentId()), KEYED)); });
  return () => entries;
}
