import { readFile,realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join,resolve,isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const nativeConfigPath=()=>process.env.CLAUDE_CONFIG_DIR?join(process.env.CLAUDE_CONFIG_DIR,'.claude.json'):join(homedir(),'.claude.json');
const normalizedPath=(value:string)=>{const path=resolve(value).replaceAll('\\','/').replace(/\/$/,'');return process.platform==='win32'?path.toLowerCase():path;};
export async function isHomeDirectory(directory:string):Promise<boolean>{
  const [target,home]=await Promise.all([realpath(directory).catch(()=>resolve(directory)),realpath(homedir()).catch(()=>resolve(homedir()))]);
  return normalizedPath(target)===normalizedPath(home);
}
export async function trustDirectory(cwd:string):Promise<string>{
  let directory=resolve(cwd);
  try{const result=await promisify(execFile)('git',['-C',directory,'worktree','list','--porcelain','-z'],{windowsHide:true,timeout:5000});const main=result.stdout.split('\0').find(line=>line.startsWith('worktree '));if(main)directory=main.slice(9);}catch{/* Outside Git, Claude trusts the working directory. */}
  return realpath(directory).catch(()=>directory);
}
export async function isWorkspaceTrusted(directory:string,path=nativeConfigPath()):Promise<boolean>{
  try{
    const config=JSON.parse(await readFile(path,'utf8'));
    if(!config?.projects||typeof config.projects!=='object'||Array.isArray(config.projects)||!isAbsolute(directory))return false;
    return Object.entries(config.projects).some(([key,value]:[string,any])=>isAbsolute(key)&&normalizedPath(key)===normalizedPath(directory)&&value?.hasTrustDialogAccepted===true);
  }catch{return false;}
}
