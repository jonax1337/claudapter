import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatgptModels, nativeContextSettings, Registry } from '../dist/models.js';

test('catalog selects the maximum allowed context while preserving default, source and freshness', async t => {
  const home = await mkdtemp(join(tmpdir(), 'claudapter-context-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  await writeFile(join(home, 'models_cache.json'), JSON.stringify({fetched_at:'2026-10-16', models:[
    {slug:'large', context_window:500000, max_context_window:872000},
    {slug:'default-only', context_window:200000},
    {slug:'maximum-only', max_context_window:1000000},
    {slug:'inconsistent', context_window:900000, max_context_window:400000},
  ]}));
  const [large, standard, maxOnly, inconsistent] = await chatgptModels('authenticated', home);
  assert.deepEqual([large.context, large.defaultContext, large.maxContext, large.contextSource],
    [872000, 500000, 872000, 'max_context_window']);
  assert.equal(large.fetchedAt, '2026-10-16');
  assert.equal(large.verifiedAt, undefined);
  assert.deepEqual([standard.context, standard.maxContext, standard.contextSource], [200000, undefined, 'context_window']);
  assert.equal(maxOnly.context, 1000000);
  assert.equal(maxOnly.defaultContext, undefined);
  assert.equal(inconsistent.context, 400000);
});

test('invalid catalog capacities never become routing limits or native context settings', async t => {
  const home = await mkdtemp(join(tmpdir(), 'claudapter-context-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const invalid = [null, 0, -1, 1023, 1234.5, '872000', {}, [], Number.MAX_SAFE_INTEGER + 1];
  await writeFile(join(home, 'models_cache.json'), JSON.stringify({models:invalid.flatMap((value, i) => [
    {slug:'bad-max-'+i, context_window:200000, max_context_window:value},
    {slug:'bad-both-'+i, context_window:value, max_context_window:value},
  ])}));
  const models = await chatgptModels('authenticated', home);
  for (const [i, model] of models.entries()) {
    assert.equal(model.context, i % 2 === 0 ? 200000 : undefined);
    assert.equal(model.maxContext, undefined);
  }
  await writeFile(join(home, 'models_cache.json'), 'null');
  assert.deepEqual(await chatgptModels('authenticated', home), []);
});

test('native context settings use per-model windows and reject unrepresentable mixed capacities', () => {
  const registry = new Registry([
    {id:'large', provider:'chatgpt', context:872000},
    {id:'small', provider:'chatgpt', context:272000},
    {id:'sonnet', provider:'anthropic'},
  ]);
  assert.deepEqual(nativeContextSettings(registry), {
    env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:'872000'},
    modelSettings:{large:{autoCompactWindow:872000},small:{autoCompactWindow:272000}},
  });
  assert.deepEqual(nativeContextSettings(new Registry()), {env:{},modelSettings:{}});
  assert.throws(() => nativeContextSettings(new Registry([{id:'unknown',provider:'chatgpt'}])), /unknown or invalid/);
  registry.add({id:'tiny',provider:'vendor',context:32000});
  assert.throws(() => nativeContextSettings(registry), /cannot configure a distinct/);
  assert.deepEqual(nativeContextSettings(new Registry([{id:'tiny',provider:'vendor',context:32000}])),
    {env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:'32000'},modelSettings:{}});
});

test('installed Claude honors mixed model windows, preserves Claude and supports runtime context updates',
  {skip:!process.env.CLAUDAPTER_NATIVE_TEST, timeout:30000}, async t => {
    const {query} = await import('@anthropic-ai/claude-agent-sdk');
    const cwd = await mkdtemp(join(tmpdir(),'claudapter-context-native-'));
    t.after(() => rm(cwd,{recursive:true,force:true}));
    let release;
    const hold = new Promise(resolve => {release=resolve;});
    const context = nativeContextSettings(new Registry([
      {id:'fixture-context-large',provider:'chatgpt',context:872000},
      {id:'fixture-context-small',provider:'chatgpt',context:272000},
    ]));
    const q = query({prompt:(async function*(){await hold;})(),options:{
      pathToClaudeCodeExecutable:process.env.CLAUDAPTER_NATIVE_TEST === '1' ? 'claude' : process.env.CLAUDAPTER_NATIVE_TEST,
      cwd,settingSources:[],model:'fixture-context-large',settings:{modelSettings:context.modelSettings},
      env:{...process.env,...context.env,ANTHROPIC_AUTH_TOKEN:'fixture-only',ANTHROPIC_BASE_URL:'http://127.0.0.1:9',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},persistSession:false,stderr:()=>{},
    }});
    const consume = (async () => {for await (const message of q) {}})();
    try {
      for (const [model,capacity] of [['fixture-context-large',872000],['fixture-context-small',272000],['claude-sonnet-5-5',1000000]]) {
        await q.applyFlagSettings({model});
        const usage = await q.getContextUsage({detail:'summary'});
        assert.equal(usage.rawMaxTokens,capacity);
        assert.equal(usage.maxTokens,capacity);
      }
      await q.applyFlagSettings({model:'fixture-context-unlisted',env:{CLAUDE_CODE_MAX_CONTEXT_TOKENS:'400000'}});
      assert.equal((await q.getContextUsage({detail:'summary'})).rawMaxTokens,400000);
    } finally {release();q.close();await consume.catch(()=>{});}
  });
