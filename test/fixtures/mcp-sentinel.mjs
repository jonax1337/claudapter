// Pre-existing MCP fixture used alongside the launcher's additive plugin.
import { createInterface } from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
  const request=JSON.parse(line);
  if(request.id===undefined)continue;
  let result={};
  if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'sentinel',version:'1.0.0'}};
  if(request.method==='tools/list')result={tools:[{name:'marker',description:'Return the read-only acceptance marker.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]};
  if(request.method==='tools/call')result={content:[{type:'text',text:'EXISTING_MCP_OK'}]};
  console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
}
