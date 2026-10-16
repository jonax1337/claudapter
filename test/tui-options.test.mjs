import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {tuiOptions} from '../dist/tui/options.js';

test('common native flags become typed SDK options and initial prompt stays literal',async()=>{
  const parsed=await tuiOptions(['--model=gpt-fixture','--permission-mode','manual','--effort','high','--name','demo',
    '--max-budget-usd','1.25','--max-turns=4','--session-id','12345678-1234-1234-1234-123456789abc','--','inspect `literal` $(value)']);
  assert.deepEqual(parsed,{options:{model:'gpt-fixture',permissionMode:'default',effort:'high',title:'demo',maxBudgetUsd:1.25,maxTurns:4,
    sessionId:'12345678-1234-1234-1234-123456789abc'},initialPrompt:'inspect `literal` $(value)'});
  assert.deepEqual(await tuiOptions(['']),{options:{},initialPrompt:''});
  assert.deepEqual(await tuiOptions(['--model','sonnet','hello','world']),{options:{model:'sonnet'},initialPrompt:'hello world'});
});

test('resume and continue are explicit, optional picker does not consume flags',async()=>{
  assert.deepEqual(await tuiOptions(['-r','--model','sonnet']),{options:{model:'sonnet'},showResumePicker:true});
  assert.deepEqual(await tuiOptions(['--resume=fixture','--fork-session']),{options:{resume:'fixture',forkSession:true}});
  assert.deepEqual(await tuiOptions(['-c']),{options:{continue:true}});
  await assert.rejects(tuiOptions(['-c','-r']),/cannot be combined/);
});

test('permissions are never implicitly bypassed and tool rules retain spaces inside parentheses',async()=>{
  assert.deepEqual((await tuiOptions([])).options,{});
  await assert.rejects(tuiOptions(['--permission-mode','bypassPermissions']),/explicitly supplied/);
  assert.deepEqual((await tuiOptions(['--allow-dangerously-skip-permissions'])).options,{allowDangerouslySkipPermissions:true});
  assert.deepEqual((await tuiOptions(['--dangerously-skip-permissions'])).options,{allowDangerouslySkipPermissions:true,permissionMode:'bypassPermissions'});
  const {options}=await tuiOptions(['--allowedTools','Bash(git *) Edit,Read','--allowed-tools','Bash(npm run test)',
    '--disallowedTools','Bash(rm *)','--tools','','--setting-sources','']);
  assert.deepEqual(options,{allowedTools:['Bash(git *)','Edit','Read','Bash(npm run test)'],disallowedTools:['Bash(rm *)'],tools:[],settingSources:[]});
  assert.deepEqual((await tuiOptions(['--tools','default'])).options.tools,{type:'preset',preset:'claude_code'});
  assert.deepEqual((await tuiOptions(['--allowedTools',`Bash(echo '(') Read`])).options.allowedTools,[`Bash(echo '(')`,'Read']);
});

test('repeated plugin directories and MCP files merge without disabling native configuration',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'claudapter-options-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  const config={mcpServers:{local:{command:'node',args:['./server.mjs'],env:{FIXTURE:'${VARIABLE}'}}}};
  await writeFile(join(cwd,'mcp.json'),JSON.stringify(config));
  const remote={mcpServers:{remote:{type:'http',url:'https://example.invalid/mcp'}}};
  const parsed=await tuiOptions(['--plugin-dir','plugin one','--plugin-dir=plugin.zip','--mcp-config','mcp.json',JSON.stringify(remote),
    '--add-dir','extra one','extra two','--setting-sources','user,project,local','--','prompt'],cwd);
  assert.deepEqual(parsed.options.plugins,[{type:'local',path:resolve(cwd,'plugin one')},{type:'local',path:resolve(cwd,'plugin.zip')}]);
  assert.deepEqual(parsed.options.mcpServers,{...config.mcpServers,...remote.mcpServers});
  assert.equal(parsed.options.strictMcpConfig,undefined);
  assert.deepEqual(parsed.options.additionalDirectories,[resolve(cwd,'extra one'),resolve(cwd,'extra two')]);
  assert.deepEqual(parsed.options.settingSources,['user','project','local']);
  assert.equal((await tuiOptions(['--strict-mcp-config'])).options.strictMcpConfig,true);
});

test('custom agents and system prompt files preserve explicit user instructions',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'claudapter-options-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  await writeFile(join(cwd,'prompt.txt'),'Base prompt\n');
  const agents={reviewer:{description:'Review',prompt:'Be precise.',model:'gpt-fixture',tools:['Read']}};
  const parsed=await tuiOptions(['--agents',JSON.stringify(agents),'--system-prompt-file','prompt.txt','--append-system-prompt','Extra',
    '--system-prompt-snapshot','off'],cwd);
  assert.deepEqual(parsed.options.agents,agents);
  assert.deepEqual(parsed.options.systemPrompt,{type:'custom',prompt:'Base prompt\n\n\nExtra',snapshot:false});
  assert.equal((await tuiOptions(['--system-prompt',''])).options.systemPrompt,'');
  assert.deepEqual((await tuiOptions(['--append-system-prompt','Extra'])).options.systemPrompt,{type:'preset',preset:'claude_code',append:'Extra'});
});

test('transport flags cannot escape TUI ownership; unknown explicit extras are literal and duplicates fail',async()=>{
  for(const flag of ['--input-format=json','--output-format','-p','--print=true','--sdk-url=x','--permission-prompt-tool=x','--settings={}'])
    await assert.rejects(tuiOptions([flag]),/not supported/);
  assert.deepEqual((await tuiOptions(['--future-option=literal `x` $(y)','--verbose','--autocompact','500k'])).options.extraArgs,
    {'future-option':'literal `x` $(y)',verbose:null,autocompact:'500k'});
  await assert.rejects(tuiOptions(['--future-option','prompt']),/Unsupported TUI option/);
  await assert.rejects(tuiOptions(['--future-option=a','--future-option=b']),/Repeated/);
  assert.deepEqual(await tuiOptions(['--','--output-format=json']),{options:{},initialPrompt:'--output-format=json'});
});

test('malformed values fail clearly without logging JSON credentials',async()=>{
  for(const args of [['--model'],['--effort','wrong'],['--max-budget-usd','NaN'],['--max-turns','1.2'],['--setting-sources','user,unknown'],
    ['--session-id','not-uuid'],['--mcp-config','{"mcpServers":null,"secret":"do-not-log"}'],['--agents','{"reviewer":null}'],
    ['--continue=true'],['--','bad\0prompt'],['--model','bad\0model']]) await assert.rejects(tuiOptions(args),error=>!error.message.includes('do-not-log'));
});
