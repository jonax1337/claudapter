import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaultPreferences,loadPreferences,savePreferences} from '../dist/tui/preferences.js';

async function fixture(t) {
  const home=await mkdtemp(join(tmpdir(),'claudapter-ui-preferences-'));
  t.after(()=>rm(home,{recursive:true,force:true}));return home;
}

test('old UI preferences gain default bindings without changing their appearance or favorites',async t=>{
  const home=await fixture(t);
  const prior={theme:'ocean',thinking:true,favorites:['gpt-fixture','vendor/model']};
  await writeFile(join(home,'ui.json'),JSON.stringify(prior));
  assert.deepEqual(await loadPreferences(home),{...prior,keybindings:defaultPreferences().keybindings});
  assert.deepEqual(JSON.parse(await readFile(join(home,'ui.json'),'utf8')),prior);
  const first=defaultPreferences();first.favorites.push('mutable');first.keybindings['ctrl+p']='/exit';
  assert.equal(defaultPreferences().favorites.length,0);
  assert.equal(defaultPreferences().keybindings['ctrl+p'],'/help');
});

test('atomic preference persistence replaces only the own UI file and normalizes shortcuts',async t=>{
  const home=await fixture(t);
  await writeFile(join(home,'settings.json'),'untouched');
  const prefs={...defaultPreferences(),theme:'contrast',favorites:['gpt-fixture','gpt-fixture'],keybindings:{'Ctrl+P':'/help','ALT+Shift+M':'/model','F12':'/plugin:skill'}};
  await savePreferences(prefs,home);
  const expected={...prefs,favorites:['gpt-fixture'],keybindings:{'ctrl+p':'/help','alt+shift+m':'/model',f12:'/plugin:skill'}};
  assert.deepEqual(await loadPreferences(home),expected);
  await savePreferences({...expected,thinking:true},home);
  assert.equal((await loadPreferences(home)).thinking,true);
  assert.equal(await readFile(join(home,'settings.json'),'utf8'),'untouched');
  assert.deepEqual((await readdir(home)).sort(),['settings.json','ui.json']);
  if(process.platform!=='win32')assert.equal((await stat(join(home,'ui.json'))).mode&0o777,0o600);
});

test('missing preferences use defaults; invalid mappings never replace a good file',async t=>{
  const home=await fixture(t);
  assert.deepEqual(await loadPreferences(home),defaultPreferences());
  await savePreferences(defaultPreferences(),home);
  const before=await readFile(join(home,'ui.json'),'utf8');
  for(const keybindings of [
    {'ctrl+c':'/help'},{escape:'/help'},{tab:'/help'},{enter:'/help'},
    {'ctrl+j':'/help'},{'ctrl+i':'/help'},{'ctrl+m':'/help'},
    {'ctrl+🐈':'/help'},{'ctrl+\x1b':'/help'},{'ctrl+ctrl+p':'/help'},
    {'ctrl+p':'/help\n/exit'},{'ctrl+p':'/help;rm'},{'ctrl+p':'/help arg'},
    {'ctrl+p':'/help\u202e'},{'ctrl+p':'bash command'},{f13:'/help'},
    {'Ctrl+P':'/help','ctrl+p':'/model'},
  ])await assert.rejects(savePreferences({...defaultPreferences(),keybindings},home));
  await assert.rejects(savePreferences({...defaultPreferences(),favorites:['model\x07']},home));
  assert.equal(await readFile(join(home,'ui.json'),'utf8'),before);
  assert.deepEqual(await readdir(home),['ui.json']);
});

test('invalid JSON and wrong preference types fail visibly without silently overwriting data',async t=>{
  const home=await fixture(t);
  for(const value of ['{broken',JSON.stringify({theme:'missing'}),JSON.stringify({thinking:'true'}),JSON.stringify({favorites:[1]}),JSON.stringify({keybindings:[]}),JSON.stringify({keybindings:null})]) {
    await writeFile(join(home,'ui.json'),value);
    await assert.rejects(loadPreferences(home));
    assert.equal(await readFile(join(home,'ui.json'),'utf8'),value);
  }
});
