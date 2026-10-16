import type { IncomingMessage } from 'node:http';
import type { Config } from './config.js';
import { CodexAuth } from './auth.js';
import type { Model } from './models.js';
import { toResponsesRequest } from './translate.js';

export interface ProviderRequest {
  model: Model; body: any; request: IncomingMessage; path: string; session: string; signal: AbortSignal;
}
/** The transport boundary shares model enumeration/readiness through the registry. */
export class Providers {
  constructor(readonly config: Config, readonly auth: CodexAuth, readonly send: typeof fetch = fetch) {}
  async request(input: ProviderRequest): Promise<Response> {
    const {model,body,request,path,session,signal} = input;
    if (model.provider==='chatgpt') {
      if (!this.config.chatgpt) throw new Error('ChatGPT provider is disabled.');
      const credential = await this.auth.credentials();
      const payload = toResponsesRequest(body,{model:model.upstream,sessionId:session});
      const effort = (payload.reasoning as any).effort;
      if (model.efforts.length && !model.efforts.includes(effort)) throw new Error('Requested reasoning effort is not supported by this model.');
      return this.send('https://chatgpt.com/backend-api/codex/responses', {
        method:'POST',redirect:'error',signal,
        headers:{authorization:'Bearer '+credential.accessToken,'chatgpt-account-id':credential.accountId,
          'content-type':'application/json',accept:'text/event-stream',originator:'codex_cli_rs','session-id':session},
        body:JSON.stringify(payload)
      });
    }
    const headers = new Headers({'content-type':'application/json'});
    let url: string;
    if (model.provider==='anthropic') {
      if (!this.config.claude) throw new Error('Claude provider is disabled.');
      url='https://api.anthropic.com';
      for (const [key,value] of Object.entries(request.headers))
        if (value && (key.startsWith('anthropic-') || key.startsWith('x-claude-code-') || key.startsWith('x-stainless-') || ['authorization','x-api-key','user-agent','x-app'].includes(key)))
          headers.set(key,Array.isArray(value)?value.join(', '):value);
      if (headers.get('authorization')==='Bearer claudapter-local-only') throw new Error('No Claude credential is configured.');
    } else {
      const provider = this.config.providers.find(p=>p.id===model.provider);
      if (!provider) throw new Error('Provider not configured.');
      const key = process.env[provider.keyEnv];
      if (!key) throw new Error('Provider credential environment variable is missing: '+provider.keyEnv);
      url=provider.baseUrl;
      headers.set('authorization','Bearer '+key);
      headers.set('anthropic-version',String(request.headers['anthropic-version'] ?? '2023-06-01'));
      const beta=String(request.headers['anthropic-beta'] ?? '').split(',').filter(b=>!b.trim().startsWith('oauth')).join(',');
      if (beta) headers.set('anthropic-beta',beta);
    }
    return this.send(url.replace(/\/$/,'')+path,{method:'POST',headers,body:JSON.stringify({...body,model:model.upstream}),redirect:'error',signal});
  }
}
