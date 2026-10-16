import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Options, PermissionMode, EffortLevel, SettingSource } from '@anthropic-ai/claude-agent-sdk';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function jsonArgument(value: string, cwd: string, flag: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {parsed=JSON.parse(value.trim().startsWith('{') ? value : await readFile(resolve(cwd,value),'utf8'));}
  catch {throw new Error(flag+' requires a readable JSON file or a JSON object.');}
  if (!object(parsed)) throw new Error(flag+' requires a JSON object.');
  return parsed;
}

function tools(values: string[]): string[] {
  const result: string[]=[];
  for (const value of values) {
    let rule='', depth=0, quote='', escaped=false;
    for (const char of value) {
      if(escaped) {rule+=char;escaped=false;continue;}
      if(char==='\\'&&depth>0) {rule+=char;escaped=true;continue;}
      if(quote) {rule+=char;if(char===quote)quote='';continue;}
      if(depth>0&&(char==='\"'||char==="'")) {rule+=char;quote=char;continue;}
      if (depth===0 && /[\s,]/u.test(char)) {if (rule) result.push(rule);rule='';continue;}
      rule+=char;
      if (char==='(') depth++;
      if (char===')') depth--;
      if (depth<0) throw new Error('Unbalanced tool permission rule.');
    }
    if (depth) throw new Error('Unbalanced tool permission rule.');
    if (rule) result.push(rule);
  }
  return result;
}

export async function tuiOptions(args: string[], cwd=process.cwd()): Promise<{
  options:Partial<Options>; initialPrompt?:string; showResumePicker?:boolean;
}> {
  if(args.some(argument=>argument.includes('\0')))throw new Error('Arguments cannot contain NUL characters.');
  const options:Partial<Options>={};
  const prompts:string[]=[];
  let showResumePicker=false, system:string|undefined, append:string|undefined, snapshot:boolean|undefined, excludeDynamic=false;
  const aliases:Record<string,string>={'-r':'--resume','-c':'--continue','-d':'--debug','-n':'--name','-p':'--print',
    '--allowed-tools':'--allowedTools','--disallowed-tools':'--disallowedTools'};
  const extra = (name: string, value: string|null) => {
    if (Object.hasOwn(options.extraArgs??{},name)) throw new Error('Repeated --'+name+' cannot be represented by the TUI SDK; use native mode.');
    options.extraArgs={...options.extraArgs,[name]:value};
  };
  for (let index=0;index<args.length;index++) {
    const raw=args[index];
    if (raw==='--') {prompts.push(...args.slice(index+1));break;}
    if (!raw.startsWith('-') || raw==='-') {prompts.push(raw);continue;}
    const equal=raw.indexOf('=');
    const original=equal<0?raw:raw.slice(0,equal);
    const flag=aliases[original]??original;
    const inline=equal<0?undefined:raw.slice(equal+1);
    const value = () => {
      if (inline!==undefined) return inline;
      if (index+1>=args.length || /^--?[^\d]/.test(args[index+1])) throw new Error(flag+' requires a value (use '+flag+'=value for values beginning with a dash).');
      return args[++index];
    };
    const nonempty = () => {const result=value();if (!result) throw new Error(flag+' requires a non-empty value.');return result;};
    const values = () => {const result=[value()];while(index+1<args.length && !args[index+1].startsWith('-')) result.push(args[++index]);return result;};
    const boolean = () => {if(inline!==undefined) throw new Error(flag+' does not take a value.');};
    switch(flag) {
      case '--print': case '--input-format': case '--output-format': case '--permission-prompt-tool':
      case '--sdk-url': case '--replay-user-messages': case '--settings':
      case '--desktop': case '--bg': case '--background': case '--cloud': case '--environment':
      case '--remote-control': case '--teleport': case '--tmux': case '--worktree':
      case '--help': case '-h': case '--version': case '-v':
        throw new Error(flag+' is not supported inside the TUI; use claudapter native mode for this option.');
      case '--resume': {
        const id=inline??(index+1<args.length && !args[index+1].startsWith('-')?args[++index]:undefined);
        if(id) {options.resume=id;showResumePicker=false;} else {delete options.resume;showResumePicker=true;}
        break;
      }
      case '--continue': boolean();options.continue=true;break;
      case '--model': options.model=nonempty();break;
      case '--agent': options.agent=nonempty();break;
      case '--name': options.title=value();break;
      case '--session-id': {
        const id=nonempty();
        if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) throw new Error('--session-id requires a UUID.');
        options.sessionId=id;break;
      }
      case '--resume-session-at': options.resumeSessionAt=nonempty();break;
      case '--resume-drops-turn': options.resumeDropsTurn=nonempty();break;
      case '--fork-session': boolean();options.forkSession=true;break;
      case '--no-session-persistence': boolean();options.persistSession=false;break;
      case '--permission-mode': {
        const mode=nonempty();
        if(!['default','manual','acceptEdits','auto','bypassPermissions','dontAsk','plan'].includes(mode)) throw new Error('Unsupported permission mode.');
        options.permissionMode=mode==='manual'?'default':mode as PermissionMode;break;
      }
      case '--allow-dangerously-skip-permissions': boolean();options.allowDangerouslySkipPermissions=true;break;
      case '--dangerously-skip-permissions': boolean();options.allowDangerouslySkipPermissions=true;options.permissionMode='bypassPermissions';break;
      case '--permission-prompts': {
        const target=nonempty();if(target!=='host'&&target!=='none')throw new Error('--permission-prompts must be host or none.');
        options.permissionPrompts=target;break;
      }
      case '--effort': {
        const effort=nonempty();if(!['low','medium','high','xhigh','max'].includes(effort))throw new Error('Unsupported effort level.');
        options.effort=effort as EffortLevel;break;
      }
      case '--plugin-dir': options.plugins=[...(options.plugins??[]),{type:'local',path:resolve(cwd,nonempty())}];break;
      case '--add-dir': options.additionalDirectories=[...(options.additionalDirectories??[]),...values().map(path=>resolve(cwd,path))];break;
      case '--allowedTools': options.allowedTools=[...(options.allowedTools??[]),...tools(values())];break;
      case '--disallowedTools': options.disallowedTools=[...(options.disallowedTools??[]),...tools(values())];break;
      case '--tools': {
        const list=tools(values());
        options.tools=list.length===1&&list[0]==='default'?{type:'preset',preset:'claude_code'}:list;break;
      }
      case '--setting-sources': {
        const sources=value().split(',').map(source=>source.trim()).filter(Boolean);
        if(sources.some(source=>!['user','project','local'].includes(source)))throw new Error('Unknown settings source; use user, project or local.');
        options.settingSources=[...new Set(sources)] as SettingSource[];break;
      }
      case '--mcp-config': {
        for(const input of values()) {
          const config=await jsonArgument(input,cwd,flag);
          if(!object(config.mcpServers)||Object.values(config.mcpServers).some(server=>!object(server)))throw new Error('--mcp-config requires an mcpServers object containing server definitions.');
          options.mcpServers={...options.mcpServers,...config.mcpServers as NonNullable<Options['mcpServers']>};
        }
        break;
      }
      case '--strict-mcp-config': boolean();options.strictMcpConfig=true;break;
      case '--agents': {
        const agents=await jsonArgument(nonempty(),cwd,flag);
        if(Object.values(agents).some(agent=>!object(agent)||typeof agent.description!=='string'||typeof agent.prompt!=='string'))throw new Error('--agents requires definitions with description and prompt strings.');
        if(Object.keys(agents).some(name=>name.startsWith('claudapter:')))throw new Error('Explicit agents collide with the reserved claudapter plugin namespace.');
        options.agents={...options.agents,...agents as NonNullable<Options['agents']>};break;
      }
      case '--system-prompt': system=value();break;
      case '--append-system-prompt': append=value();break;
      case '--system-prompt-file': system=await readFile(resolve(cwd,nonempty()),'utf8');break;
      case '--append-system-prompt-file': append=await readFile(resolve(cwd,nonempty()),'utf8');break;
      case '--system-prompt-snapshot': {
        const mode=nonempty();if(mode!=='on'&&mode!=='off')throw new Error('--system-prompt-snapshot must be on or off.');snapshot=mode==='on';break;
      }
      case '--exclude-dynamic-system-prompt-sections': boolean();excludeDynamic=true;break;
      case '--max-budget-usd': {
        const budget=Number(nonempty());if(!Number.isFinite(budget)||budget<=0)throw new Error('--max-budget-usd must be positive.');options.maxBudgetUsd=budget;break;
      }
      case '--max-turns': {
        const turns=Number(nonempty());if(!Number.isSafeInteger(turns)||turns<=0)throw new Error('--max-turns must be a positive integer.');options.maxTurns=turns;break;
      }
      case '--fallback-model': options.fallbackModel=nonempty();break;
      case '--json-schema': options.outputFormat={type:'json_schema',schema:await jsonArgument(nonempty(),cwd,flag)};break;
      case '--debug': {
        const filter=inline??(index+1<args.length&&!args[index+1].startsWith('-')?args[++index]:undefined);
        if(filter!==undefined)extra('debug',filter);else options.debug=true;break;
      }
      case '--debug-file': options.debugFile=resolve(cwd,nonempty());break;
      case '--include-hook-events': boolean();options.includeHookEvents=true;break;
      case '--include-partial-messages': boolean();options.includePartialMessages=true;break;
      case '--forward-subagent-text': boolean();options.forwardSubagentText=true;break;
      case '--prompt-suggestions': {
        const accepted=['true','false','1','0','yes','no','on','off'];
        const setting=inline??(accepted.includes(args[index+1])?args[++index]:'true');
        if(!accepted.includes(setting))throw new Error('--prompt-suggestions requires a boolean.');
        options.promptSuggestions=['true','1','yes','on'].includes(setting);break;
      }
      case '--verbose': case '--chrome': case '--no-chrome': case '--bare': case '--restricted':
      case '--safe-mode': case '--brief': case '--disable-slash-commands': case '--ide':
        boolean();extra(flag.slice(2),null);break;
      case '--autocompact': extra('autocompact',nonempty());break;
      default:
        if(!/^--[a-zA-Z][\w-]*$/.test(flag)||inline===undefined)
          throw new Error('Unsupported TUI option '+flag+'. Use --name=value for an additional backend option, or launch native mode.');
        extra(flag.slice(2),inline);
    }
  }
  if(options.continue&&(options.resume||showResumePicker))throw new Error('--continue and --resume cannot be combined.');
  if(options.permissionMode==='bypassPermissions'&&!options.allowDangerouslySkipPermissions)
    throw new Error('bypassPermissions requires an explicitly supplied --allow-dangerously-skip-permissions flag.');
  if(system!==undefined) {
    const prompt=append===undefined?system:system+'\n\n'+append;
    options.systemPrompt=snapshot===undefined?prompt:{type:'custom',prompt,snapshot};
  } else if(append!==undefined||snapshot!==undefined||excludeDynamic)
    options.systemPrompt={type:'preset',preset:'claude_code',...(append!==undefined?{append}:{}),...(snapshot!==undefined?{snapshot}:{}),...(excludeDynamic?{excludeDynamicSections:true}:{})};
  return {options,...(prompts.length?{initialPrompt:prompts.join(' ')}:{}),...(showResumePicker?{showResumePicker:true}:{})};
}
