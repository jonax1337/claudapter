// Explicit, opt-in subscription acceptance run. Never included by npm test.
import { launch } from '../dist/launcher.js';
import { defaults } from '../dist/config.js';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
if(process.env.CLAUDAPTER_LIVE_ACCEPTANCE!=='1')throw new Error('Set CLAUDAPTER_LIVE_ACCEPTANCE=1 for the authorized live acceptance run.');
const root=resolve(import.meta.dirname,'..');
process.env.CLAUDE_CONFIG_DIR=resolve(root,'.test-live','Claude Home');
process.env.CLAUDAPTER_HOME=resolve(root,'.test-live','Adapter Home');
process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS='4096';
process.chdir(resolve(root,'.test-live','demo project'));
const model=process.argv[2];if(!model)throw new Error('Pass an account-catalog GPT model ID.');
const events=[];let simulated=0;
const config={...defaults(),agents:{'gpt-reviewer':model},fallback:[{enabled:true,from:'claude-sonnet-5-5',targets:[model],scopes:['main'],errors:['rate_limit'],retries:0,timeoutMs:60000,cooldownMs:60000}]};
const code=await launch(['--model','sonnet','-p','Read sum.mjs, run node sum.test.mjs, and report the exact test output. Do not delegate.','--output-format','json'],config,{
  onEvent:e=>events.push(e),
  fetch:async(url,init)=>{
    if(new URL(url).hostname==='api.anthropic.com') {simulated++;return new Response(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'SIMULATED acceptance usage limit'}}),{status:429,headers:{'content-type':'application/json','retry-after':'1'}});}
    return fetch(url,init);
  }
});
await writeFile(resolve(root,'.artifacts','live-fallback.json'),JSON.stringify({simulatedFailures:simulated,events,exitCode:code},null,2));
assert.equal(code,0);assert.ok(events.some(e=>e.event==='fallback'&&e.actual===model));assert.ok(events.filter(e=>e.event==='response'&&e.provider==='chatgpt'&&e.status===200).length>=2);
assert.equal(events.filter(e=>e.event==='response'&&e.provider==='anthropic'&&e.requestClass==='main').length,1,'cooldown must avoid repeated primary requests');
console.log('LIVE_FALLBACK_AND_COOLDOWN_OK (primary failure simulated; GPT inference real)');
