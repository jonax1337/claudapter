import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { configHome } from '../config.js';
import { isThemeName, type ThemeName } from './theme-names.js';

export type { ThemeName } from './theme-names.js';
export type EditorMode='normal'|'vim';
/** `editorMode` is stored only once chosen, so files written before it existed round-trip unchanged. */
export interface Preferences {theme:ThemeName;thinking:boolean;favorites:string[];keybindings:Record<string,string>;editorMode?:EditorMode}
export function defaultPreferences(): Preferences {
  return {theme:'midnight',thinking:false,favorites:[],keybindings:{
    'ctrl+p':'/help','ctrl+o':'/thinking',f2:'/model',f3:'/agents',f4:'/usage',f6:'/theme',
  }};
}

function canonicalChord(value: string): string | undefined {
  const parts=value.toLowerCase().split('+');
  const base=parts.pop()??'';
  const modifiers=new Set(parts);
  if(modifiers.size!==parts.length||parts.some(part=>!['ctrl','alt','shift'].includes(part)))return;
  const functionKey=/^f(?:[1-9]|1[0-2])$/.test(base);
  if(!functionKey&&(!/^[a-z0-9]$/.test(base)||!modifiers.has('ctrl')&&!modifiers.has('alt')))return;
  // Ctrl+I/J/M are terminal aliases for reserved Tab/newline/Enter actions.
  if(modifiers.has('ctrl')&&['c','i','j','m'].includes(base))return;
  return [...['ctrl','alt','shift'].filter(modifier=>modifiers.has(modifier)),base].join('+');
}

function validate(value: unknown): Preferences {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('UI preferences must be a JSON object.');
  const saved=value as Record<string,unknown>, defaults=defaultPreferences();
  if(Object.keys(saved).some(key=>!['theme','thinking','favorites','keybindings','editorMode'].includes(key)))throw new Error('Unknown UI preference field.');
  const theme=saved.theme===undefined?defaults.theme:saved.theme, thinking=saved.thinking===undefined?defaults.thinking:saved.thinking;
  const favorites=saved.favorites===undefined?defaults.favorites:saved.favorites, bindings=saved.keybindings===undefined?defaults.keybindings:saved.keybindings;
  if(!isThemeName(theme))throw new Error('Unknown Claudapter theme.');
  if(typeof thinking!=='boolean')throw new Error('The thinking preference must be boolean.');
  if(!Array.isArray(favorites)||favorites.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(id)))throw new Error('Favorites must contain valid model IDs.');
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))throw new Error('Keybindings must map key chords to slash commands.');
  const entries:[string,string][]=[];
  for(const [key,command] of Object.entries(bindings)) {
    const chord=canonicalChord(key);
    if(!chord)throw new Error('Unsupported or reserved keybinding. Use Ctrl/Alt combinations or F1 through F12.');
    if(typeof command!=='string'||!/^\/[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(command))throw new Error('Keybinding targets must be slash command names without arguments.');
    if(entries.some(([existing])=>existing===chord))throw new Error('Duplicate keybinding after normalization.');
    entries.push([chord,command]);
  }
  if(saved.editorMode!==undefined&&saved.editorMode!=='normal'&&saved.editorMode!=='vim')throw new Error('The editor mode must be normal or vim.');
  return {theme:theme as ThemeName,thinking,favorites:[...new Set(favorites)],keybindings:Object.fromEntries(entries),...(saved.editorMode?{editorMode:saved.editorMode as EditorMode}:{})};
}

function preferencesFile(home: string): string {
  if(!isAbsolute(home))throw new Error('Claudapter UI home must be an absolute path.');
  return join(home,'ui.json');
}

export async function loadPreferences(home=configHome()): Promise<Preferences> {
  let text:string;
  try {text=await readFile(preferencesFile(home),'utf8');}
  catch(error:any) {if(error.code==='ENOENT')return defaultPreferences();throw error;}
  let value:unknown;
  try {value=JSON.parse(text);}catch{throw new Error('Cannot parse Claudapter ui.json; correct its JSON before continuing.');}
  return validate(value);
}

export async function savePreferences(preferences: Preferences,home=configHome()): Promise<void> {
  const value=validate(preferences), destination=preferencesFile(home);
  await mkdir(home,{recursive:true,mode:0o700});
  const temporary=join(home,'ui.'+randomUUID()+'.tmp');
  const file=await open(temporary,'wx',0o600);
  try {
    try {await file.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await file.sync();}
    finally {await file.close();}
    await rename(temporary,destination);
  } finally {await rm(temporary,{force:true});}
}
