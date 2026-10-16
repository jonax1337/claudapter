#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { TOKEN_HEADER } from './gateway.js';
import { VERSION } from './version.js';

async function request(path: string, body?: unknown) {
  const url = process.env.CLAUDAPTER_GATEWAY_URL;
  const token = process.env.CLAUDAPTER_GATEWAY_TOKEN;
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !token) throw new Error('Claudapter session is not available.');
  const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{[TOKEN_HEADER]:token,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('Claudapter discovery request failed.');
  return response.json();
}
if (process.argv[2]==='hook') {
  let text='';
  for await (const chunk of process.stdin) {text+=chunk; if(text.length>1_000_000) throw new Error('Hook input too large.');}
  try { console.log(JSON.stringify(await request('/hook',JSON.parse(text)))); }
  catch { console.log(JSON.stringify({systemMessage:'Claudapter context unavailable. Use discovery before assuming model availability.'})); }
} else {
  const lines=createInterface({input:process.stdin});
  for await (const line of lines) {
    let message: any;
    try {
      if(line.length>1_000_000) throw new Error('Input too large.');
      message=JSON.parse(line); if (message.id===undefined) continue;
      let result: unknown;
      if(message.method==='initialize') result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'claudapter',version:VERSION}};
      else if(message.method==='ping') result={};
      else if(message.method==='tools/list') result={tools:[{name:'discovery',description:'Read-only refresh of configured models, authentication readiness, explicitly enabled agents/fallback policies, cooldowns and actual routing. Does not call inference or change permissions.',
        inputSchema:{type:'object',properties:{refresh:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]};
      else if(message.method==='tools/call' && message.params?.name==='discovery') {
        const data=await request(message.params.arguments?.refresh?'/refresh':'/status',message.params.arguments?.refresh?{}:undefined);
        result={content:[{type:'text',text:JSON.stringify(data)}]};
      } else throw new Error('Unsupported MCP method or tool.');
      console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
    } catch { if(message?.id!==undefined) console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Claudapter discovery unavailable or invalid request.'}})); }
  }
}
