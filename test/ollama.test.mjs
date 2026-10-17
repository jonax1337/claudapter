import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaCatalog, ollamaEndpoint, parseOllamaUrl } from '../dist/ollama.js';
import { Registry, buildRegistry, mergeRegistryRefresh, nativeContextSettings } from '../dist/models.js';
import { validateConfig, defaults } from '../dist/config.js';
import { Providers } from '../dist/providers.js';
import { prepareSettings } from '../dist/launcher.js';
import { startGateway, TOKEN_HEADER } from '../dist/gateway.js';

const ok = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const offline = async () => { throw new Error('offline fixture'); };
const auth = {status: async () => 'missing', home: '/nonexistent'};
const tags = (...names) => ({models: names.map(name => ({name, details: {parameter_size: '8.0B', quantization_level: 'Q4_K_M'}}))});
const show = (context, capabilities = []) => ({capabilities, model_info: {'general.architecture': 'fixture', 'fixture.context_length': context}});
const fixtureSend = (listed, shows = {}, failures = []) => {
  const calls = [];
  const send = async (input, init) => {
    const url = String(input);
    calls.push({url, method: init?.method ?? 'GET', body: init?.body, headers: init?.headers});
    if (url.endsWith('/api/tags')) return ok(listed);
    if (url.endsWith('/api/show')) {
      const name = JSON.parse(String(init?.body)).model;
      if (failures.includes(name)) return ok({error: 'not found'}, 404);
      return ok(shows[name] ?? {});
    }
    return ok({content: []});
  };
  return {send, calls};
};

test('endpoint resolution prefers config, then OLLAMA_HOST, then the default loopback server', () => {
  assert.deepEqual(ollamaEndpoint(defaults(), ''), {baseUrl: 'http://127.0.0.1:11434', explicit: false});
  assert.deepEqual(ollamaEndpoint(defaults(), '192.168.5.9'), {baseUrl: 'http://192.168.5.9:11434', explicit: true});
  assert.deepEqual(ollamaEndpoint(defaults(), 'http://127.0.0.1:11435'), {baseUrl: 'http://127.0.0.1:11435', explicit: true});
  assert.deepEqual(ollamaEndpoint(defaults(), 'https://ollama.example.com'), {baseUrl: 'https://ollama.example.com', explicit: true});
  assert.deepEqual(ollamaEndpoint({ollama: {baseUrl: 'http://127.0.0.1:11435'}}, '192.168.5.9'), {baseUrl: 'http://127.0.0.1:11435', explicit: true});
  assert.throws(() => ollamaEndpoint(defaults(), 'socks5://127.0.0.1:11434'), /OLLAMA_HOST/);
  assert.throws(() => ollamaEndpoint(defaults(), 'http://api.example.com'), /plaintext/);
  assert.throws(() => ollamaEndpoint(defaults(), 'http://127.0.0.1:11434/?key=1'), /OLLAMA_HOST/);
  assert.throws(() => ollamaEndpoint({ollama: {baseUrl: 'http://api.example.com'}}, ''), /plaintext/);
  assert.ok(parseOllamaUrl('10.1.2.3', 'OLLAMA_HOST'));
  assert.ok(parseOllamaUrl('[::1]:11434', 'OLLAMA_HOST'));
});

test('catalog lists installed models with live capabilities and honest metadata', async () => {
  const {send} = fixtureSend(tags('qwen3:14b', 'gemma3:4b'),
    {'qwen3:14b': show(131072, ['completion', 'tools']), 'gemma3:4b': show(131072, ['completion', 'tools', 'vision'])});
  const catalog = await ollamaCatalog('http://127.0.0.1:11434', send);
  assert.equal(catalog.reachable, true);
  assert.deepEqual(catalog.models.map(model => model.id), ['gemma3:4b', 'qwen3:14b']);
  const [gemma, qwen] = catalog.models;
  assert.equal(qwen.upstream, 'qwen3:14b');
  assert.equal(qwen.provider, 'ollama');
  assert.equal(qwen.label, 'qwen3:14b · 8.0B Q4_K_M');
  assert.equal(qwen.context, 131072);
  assert.equal(qwen.tools, true);
  assert.equal(qwen.vision, false);
  assert.equal(qwen.efforts.length, 0);
  assert.equal(qwen.auth, 'authenticated');
  assert.match(qwen.source, /Ollama live \/api\/tags \+ \/api\/show listing/);
  assert.ok(!qwen.availability, 'a listing is not inference proof');
  assert.equal(gemma.vision, true);
  assert.deepEqual(catalog.notes, []);
});

test('per-model failures become notes while an unreachable or broken server stays an empty catalog', async () => {
  const {send} = fixtureSend(tags('broken:1b', 'nocontext:1b', 'ok:1b'),
    {'ok:1b': show(4096), 'nocontext:1b': {capabilities: [], model_info: {'general.architecture': 'fixture'}}}, ['broken:1b']);
  const catalog = await ollamaCatalog('http://127.0.0.1:11434', send);
  assert.deepEqual(catalog.models.map(model => model.id), ['ok:1b']);
  assert.equal(catalog.notes.length, 2);
  assert.match(catalog.notes.join('\n'), /"broken:1b" skipped: \/api\/show answered HTTP 404/);
  assert.match(catalog.notes.join('\n'), /"nocontext:1b" skipped: no usable context_length/);
  assert.deepEqual(await ollamaCatalog('http://127.0.0.1:11434', offline), {models: [], reachable: false, notes: []});
  assert.deepEqual(await ollamaCatalog('http://127.0.0.1:11434', async () => ok({}, 500)), {models: [], reachable: false, notes: []});
});

test('config validation accepts the ollama section and reserves its provider id', () => {
  assert.deepEqual(validateConfig({...defaults(), ollama: {enabled: false, baseUrl: 'http://127.0.0.1:11434'}}).ollama,
    {enabled: false, baseUrl: 'http://127.0.0.1:11434'});
  assert.ok(validateConfig({...defaults(), ollama: {}}));
  assert.throws(() => validateConfig({...defaults(), ollama: {enabled: 'no'}}), /enabled/);
  assert.throws(() => validateConfig({...defaults(), ollama: {baseUrl: 'ftp://127.0.0.1'}}), /baseUrl/);
  assert.throws(() => validateConfig({...defaults(), ollama: {wrong: 1}}), /unknown configuration field/);
  assert.throws(() => validateConfig({...defaults(),
    providers: [{id: 'ollama', baseUrl: 'https://x.example', keyEnv: 'X_KEY', models: [{id: 'm', context: 200000, tools: true, vision: true}]}]}), /unique/);
});

test('buildRegistry auto-detects ollama models and records honest notices', async () => {
  const {send} = fixtureSend(tags('big:8b', 'small:1b'), {'big:8b': show(131072, ['tools']), 'small:1b': show(8192, [])});
  const config = {...defaults(), claude: false,
    providers: [{id: 'vendor', baseUrl: 'https://vendor.example', keyEnv: 'VENDOR_KEY', models: [{id: 'vendor-large', context: 872000, tools: true, vision: true}]}]};
  const registry = await buildRegistry(config, auth, send);
  assert.deepEqual(registry.list().filter(model => model.provider === 'ollama').map(model => model.id), ['big:8b', 'small:1b']);
  assert.ok(registry.notices.some(note => /small:1b \(8192 tokens\)/.test(note) && /session ceiling/.test(note)));
  const disabled = await buildRegistry({...config, ollama: {enabled: false}}, auth, send);
  assert.equal(disabled.list().filter(model => model.provider === 'ollama').length, 0);
  const explicit = await buildRegistry({...defaults(), claude: false, ollama: {baseUrl: 'http://127.0.0.1:11435'}}, auth, offline);
  assert.ok(explicit.notices.some(note => /127\.0\.0\.1:11435 is unreachable/.test(note)));
  const silent = await buildRegistry({...defaults(), claude: false}, auth, offline);
  assert.deepEqual(silent.notices, []);
});

test('ollama models below the native window floor inherit the ceiling while configured providers still fail loudly', () => {
  const registry = new Registry([
    {id: 'vendor-large', provider: 'vendor', context: 872000},
    {id: 'big:8b', provider: 'ollama', context: 131072},
    {id: 'small:1b', provider: 'ollama', context: 8192},
  ]);
  assert.deepEqual(nativeContextSettings(registry), {
    env: {CLAUDE_CODE_MAX_CONTEXT_TOKENS: '872000'},
    modelSettings: {'vendor-large': {autoCompactWindow: 872000}, 'big:8b': {autoCompactWindow: 131072}},
  });
  registry.add({id: 'vendor-tiny', provider: 'vendor', context: 32000});
  assert.throws(() => nativeContextSettings(registry), /cannot configure a distinct/);
});

test('ollama requests pass the anthropic protocol without credentials', async () => {
  const {send, calls} = fixtureSend(tags());
  const model = {id: 'qwen3:14b', upstream: 'qwen3:14b', provider: 'ollama', label: 'qwen3:14b',
    context: 131072, tools: true, vision: false, efforts: [], source: 'fixture', auth: 'authenticated'};
  const request = {model, body: {model: 'qwen3:14b', messages: []}, request: {headers: {}}, path: '/v1/messages',
    session: 'session-o', signal: new AbortController().signal};
  assert.equal((await new Providers({...defaults(), ollama: {}}, auth, send).request(request)).status, 200);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/messages');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.get('authorization'), null);
  assert.equal(calls[0].headers.get('anthropic-version'), '2023-06-01');
  assert.equal(JSON.parse(calls[0].body).model, 'qwen3:14b');
  await assert.rejects(() => new Providers({...defaults(), ollama: {enabled: false}}, auth, send).request(request), /Ollama provider is disabled/);
});

test('gateway streams ollama turns through and refuses exact token counting', async t => {
  const registry = new Registry([{id: 'qwen3:14b', upstream: 'qwen3:14b', provider: 'ollama', label: 'qwen3:14b',
    context: 131072, tools: true, vision: false, efforts: [], source: 'fixture', auth: 'authenticated'}]);
  const {send, calls} = fixtureSend(tags());
  const gateway = await startGateway({registry, auth, config: defaults(), fetch: send});
  t.after(() => gateway.close());
  const counted = await fetch(gateway.baseUrl + '/v1/messages/count_tokens', {method: 'POST',
    headers: {[TOKEN_HEADER]: gateway.token}, body: JSON.stringify({model: 'qwen3:14b', messages: []})});
  assert.equal(counted.status, 501);
  assert.equal(calls.length, 0, 'token counting must not reach the local server');

  const frames = [
    {type: 'message_start', message: {usage: {input_tokens: 3}}},
    {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'local'}},
    {type: 'content_block_stop', index: 0},
    {type: 'message_delta', delta: {stop_reason: 'end_turn'}, usage: {output_tokens: 2}},
    {type: 'message_stop'},
  ].map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('');
  const streaming = async () => new Response(frames, {status: 200, headers: {'content-type': 'text/event-stream'}});
  const streamingGateway = await startGateway({registry, auth, config: defaults(), fetch: streaming});
  t.after(() => streamingGateway.close());
  const response = await fetch(streamingGateway.baseUrl + '/v1/messages', {method: 'POST',
    headers: {[TOKEN_HEADER]: streamingGateway.token}, body: JSON.stringify({model: 'qwen3:14b', stream: true, messages: [{role: 'user', content: 'hi'}], max_tokens: 32})});
  const text = await response.text();
  assert.match(text, /message_start/);
  assert.match(text, /text_delta/);
  assert.match(text, /message_stop/);
  assert.equal(registry.resolve('qwen3:14b').availability, 'verified');
});

test('ollama upstream failures surface the local server reason instead of a masked rejection', async t => {
  const registry = new Registry([{id: 'qwen3:14b', upstream: 'qwen3:14b', provider: 'ollama', label: 'qwen3:14b',
    context: 131072, tools: true, vision: false, efforts: [], source: 'fixture', auth: 'authenticated'}]);
  const gateway = await startGateway({registry, auth, config: defaults(),
    fetch: async () => ok({type: 'error', error: {type: 'api_error', message: 'llama-server process has terminated: exit status 1'}}, 500)});
  t.after(() => gateway.close());
  const response = await fetch(gateway.baseUrl + '/v1/messages', {method: 'POST',
    headers: {[TOKEN_HEADER]: gateway.token}, body: JSON.stringify({model: 'qwen3:14b', messages: [{role: 'user', content: 'hi'}], max_tokens: 32})});
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.match(body.error.message, /llama-server process has terminated/);
});

test('the model picker shows ollama entries with their real context', async () => {
  const registry = new Registry([{id: 'qwen3:14b', upstream: 'qwen3:14b', provider: 'ollama', label: 'qwen3:14b',
    context: 32768, tools: true, vision: false, efforts: [], source: 'fixture', auth: 'authenticated'}]);
  const prepared = await prepareSettings([], registry, {...defaults(), claude: false});
  const option = prepared.settings.modelPicker.options.find(entry => entry.model === 'qwen3:14b');
  assert.equal(option.label, 'qwen3:14b');
  assert.equal(option.description, 'ollama local · 32768-token context · below the native per-model window floor');
});

test('refresh adopts new ollama models, drops removed ones and keeps runtime findings', () => {
  const registry = new Registry([{id: 'a:1b', provider: 'ollama', context: 8192, availability: 'verified', verifiedAt: '2026-10-17T00:00:00.000Z'}]);
  mergeRegistryRefresh(registry, new Registry([
    {id: 'a:1b', provider: 'ollama', context: 8192},
    {id: 'b:1b', provider: 'ollama', context: 8192},
  ]));
  assert.equal(registry.entries.has('b:1b'), true);
  assert.equal(registry.resolve('a:1b').availability, 'verified');
  mergeRegistryRefresh(registry, new Registry([{id: 'b:1b', provider: 'ollama', context: 8192}]));
  assert.equal(registry.entries.has('a:1b'), false);
});
