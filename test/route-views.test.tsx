import { test, expect } from 'bun:test';
import { testRender } from '@opentui/solid';
import { createSignal } from 'solid-js';
import { StatusBar, routeLabel } from '../src/tui/opencode/status';
import { RouteLayer } from '../src/tui/opencode/route-layer';
import { Transcript } from '../src/tui/opencode/transcript';
import { routeEntryFooter } from '../src/tui/opencode/route-marker';
import { FallbackSetup } from '../src/tui/opencode/fallback-setup';
import { createActions } from '../src/tui/opencode/actions';

const MINUTE = 60_000;
type View = Awaited<ReturnType<typeof testRender>>;
async function frame(view: View) { await view.renderOnce(); return view.captureCharFrame(); }

const model = (id: string, provider: string, extra = {}) => ({ id, upstream: id, provider, label: id, tools: true, vision: true, efforts: [],
  source: 'fixture', auth: 'authenticated', ...extra });
const models = [model('sonnet', 'anthropic', { auth: 'unknown' }), model('gpt-6-astra', 'chatgpt', { context: 872000 }),
  model('glm-5.3', 'zai', { context: 1000000, vision: false })] as any[];

test('status route segment counts the cooldown down and drops it once the requested model is back', async () => {
  const route = { requested: 'sonnet', actual: 'gpt-6-astra', provider: 'chatgpt', cooldownUntil: Date.now() + 4 * MINUTE };
  expect(routeLabel(route, route.cooldownUntil - 42_000).text).toBe('sonnet → gpt-6-astra · back in 42s');
  expect(routeLabel(route, route.cooldownUntil + 1).text).toBe('sonnet → gpt-6-astra');
  const view = await testRender(() => <StatusBar busy={false} status="Ready" hints={[]} route={route} width={100} />, { width: 104, height: 3 });
  try { expect(await frame(view)).toContain('sonnet → gpt-6-astra · back in 4m'); }
  finally { view.renderer.destroy(); }
});

test('route toast is non-blocking, lists the offers and coalesces repeats into one counted toast', async () => {
  const [state, setState] = createSignal<any>({ routeToast: { key: 'k', text: 'rate limit on sonnet · continued on gpt-6-astra · for 5m', tone: 'warning', count: 1, at: 1 },
    routeOffers: [{ action: 'back', session: 's', requested: 'sonnet' }, { action: 'pin', model: 'gpt-6-astra' }] });
  const view = await testRender(() => <RouteLayer state={state()} enabled onCommand={() => {}} />, { width: 100, height: 20 });
  try {
    const first = await frame(view);
    expect(first).toContain('rate limit on sonnet · continued on gpt-6-astra');
    expect(first).toContain('alt+b switch back to sonnet');
    expect(first).toContain('alt+p pin gpt-6-astra for this session');
    setState({ ...state(), routeToast: { ...state().routeToast, text: 'rate limit on sonnet · continued on gpt-6-astra · for 5m ×2', count: 2, at: 2 } });
    const second = await frame(view);
    expect(second).toContain('×2');
    expect(second.split('rate limit on sonnet').length - 1).toBe(1);
  } finally { view.renderer.destroy(); }
});

test('alt keys run only offered recovery steps, and only while no dialog owns the keyboard', async () => {
  const commands: string[] = [];
  const [enabled, setEnabled] = createSignal(true);
  const state = { routeOffers: [{ action: 'retry', session: 's', requested: 'sonnet', target: 'glm-5.3' }] } as any;
  const view = await testRender(() => <RouteLayer state={state} enabled={enabled()} onCommand={text => commands.push(text)} />, { width: 80, height: 10 });
  try {
    await view.renderOnce();
    view.mockInput.pressKey('b', { meta: true });
    view.mockInput.pressKey('r');
    view.mockInput.pressKey('r', { meta: true });
    setEnabled(false);
    view.mockInput.pressKey('r', { meta: true });
    expect(commands).toEqual(['/route retry']);
  } finally { view.renderer.destroy(); }
});

test('transcript route marker keeps the plain text and adds a provider badge with the live countdown', async () => {
  const marker = { id: 'route:t:main:switched', kind: 'switched', requested: 'sonnet', actual: 'gpt-6-astra', provider: 'chatgpt',
    reason: 'rate_limit', cooldownUntil: Date.now() + 4 * MINUTE, at: Date.now(), count: 1, text: 'rate limit on sonnet · continued on gpt-6-astra · for 4m' };
  const entries = [{ id: 'u1', kind: 'user', text: 'Fix the test' }, { id: marker.id, kind: 'notice', text: marker.text, route: marker }];
  const view = await testRender(() => <Transcript entries={entries as any} busy={false} thinking={false} details={false}
    slots={{ entryFooter: routeEntryFooter }} />, { width: 100, height: 20 });
  try {
    const text = await frame(view);
    expect(text).toContain('rate limit on sonnet · continued on gpt-6-astra · for 4m');
    expect(text).toContain('● gpt-6-astra · chatgpt · back in 4m');
  } finally { view.renderer.destroy(); }
});

test('guided setup offers signed-in presets, explains the dry run and saves only on an explicit enable', async () => {
  const saved: any[] = [];
  const view = await testRender(() => <FallbackSetup models={models} primary="sonnet" preemptPercent={95}
    onSave={async rule => { saved.push(rule); }} onClose={() => {}} />, { width: 110, height: 40 });
  try {
    const list = await frame(view);
    expect(list).toContain('sonnet → gpt-6-astra');
    expect(list).toContain('sonnet → gpt-6-astra → glm-5.3');
    view.mockInput.pressArrow('down'); view.mockInput.pressArrow('down');
    view.mockInput.pressEnter();
    const review = await frame(view);
    expect(review).toContain('At 95% of a fresh anthropic quota window');
    expect(review).toContain('glm-5.3 · images');
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(saved).toHaveLength(0);
    view.mockInput.pressEnter();
    view.mockInput.pressArrow('right'); view.mockInput.pressArrow('right');
    view.mockInput.pressEnter();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ enabled: true, from: 'sonnet', targets: ['gpt-6-astra', 'glm-5.3'], scopes: ['main'] });
  } finally { view.renderer.destroy(); }
});

test('/route runs explicit recovery and /settings exposes the guided setup', async () => {
  const runs: string[] = [];
  const controller = { state: { commands: [], models, entries: [], tasks: {}, agents: [], model: 'sonnet', routeOffers: [] },
    config: { fallback: [], agents: {} }, runRouteOffer: async (action: string) => { runs.push(action); }, send() {} };
  const groups: any[] = [];
  const dialogs = { menu() {}, view() {}, form() {}, confirm() {}, close() {}, recall() {}, appearance() {}, toggle() {},
    panel(render: (close: () => void) => any) { groups.push(render); } };
  const { execute } = createActions(controller as any, dialogs as any, async () => {});
  await execute('/route back');
  expect(runs).toEqual(['back']);
  await expect(execute('/route replay')).rejects.toThrow('Unknown route action');
  await execute('/route setup');
  expect(groups).toHaveLength(1);
});
