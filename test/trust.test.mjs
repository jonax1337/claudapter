import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isWorkspaceTrusted,trustDirectory,nativeConfigPath} from '../dist/tui/trust.js';

test('native trust lookup reads only its supplied fixture and requires an exact boolean acceptance',async t=>{
  const root=await mkdtemp(join(tmpdir(),'claudapter-trust-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'Project With Spaces'),config=join(root,'native.json');
  await mkdir(directory);
  assert.equal(await isWorkspaceTrusted(directory,config),false);
  for(const value of [false,'true',1,null]) {
    await writeFile(config,JSON.stringify({projects:{[directory]:{hasTrustDialogAccepted:value}}}));
    assert.equal(await isWorkspaceTrusted(directory,config),false);
  }
  const saved=JSON.stringify({projects:{[directory]:{hasTrustDialogAccepted:true}}});
  await writeFile(config,saved);
  assert.equal(await isWorkspaceTrusted(directory,config),true);
  assert.equal(await isWorkspaceTrusted(directory+'/',config),true);
  assert.equal(await isWorkspaceTrusted(join(root,'other'),config),false);
  assert.equal(await readFile(config,'utf8'),saved);
  if(process.platform==='win32')assert.equal(await isWorkspaceTrusted(directory.toUpperCase(),config),true);
  assert.equal(nativeConfigPath(),join(process.env.CLAUDE_CONFIG_DIR,'.claude.json'));
});

test('malformed trust storage and relative project keys fail closed without writes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'claudapter-trust-invalid-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const config=join(root,'native.json');
  for(const text of ['{broken','null','[]','{"projects":[]}',JSON.stringify({projects:{'.':{hasTrustDialogAccepted:true}}})]) {
    await writeFile(config,text);
    assert.equal(await isWorkspaceTrusted(process.cwd(),config),false);
    assert.equal(await readFile(config,'utf8'),text);
  }
});

test('trust root matches the exact Git worktree directory including Unicode and spaces',async t=>{
  const root=await mkdtemp(join(tmpdir(),'claudapter-trust-git-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const repo=join(root,'Projekt 猫 with spaces'),nested=join(repo,'nested');
  await mkdir(nested,{recursive:true});
  await promisify(execFile)('git',['-c','init.defaultBranch=main','init','--quiet',repo],{windowsHide:true});
  assert.equal(await trustDirectory(nested),await realpath(repo));
  const nonGit=join(root,'plain');await mkdir(nonGit);
  assert.equal(await trustDirectory(nonGit),await realpath(nonGit));
  assert.equal(await trustDirectory(join(root,'absent')),resolve(root,'absent'));
});
