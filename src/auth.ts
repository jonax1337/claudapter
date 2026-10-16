import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), '.codex');
export type AuthState = 'authenticated' | 'missing' | 'expired' | 'unsupported' | 'unknown';
export interface Credentials { accessToken: string; accountId: string }

/** Read-only sharing: Codex alone owns refresh-token rotation and persistence. */
export class CodexAuth {
  private account?: string;
  constructor(readonly home = codexHome()) {}

  async credentials(): Promise<Credentials> {
    let auth;
    try { auth = JSON.parse(await readFile(join(this.home, 'auth.json'), 'utf8')); }
    catch { throw new Error('ChatGPT file session unavailable. Run `codex login`; keyring-only storage is not supported.'); }
    if (auth.auth_mode !== 'chatgpt' || !auth.tokens?.access_token || !auth.tokens?.account_id)
      throw new Error('A file-backed ChatGPT subscription login is required. Run `codex login`.');
    let expiry = 0;
    try { expiry = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString()).exp * 1000; } catch { /* Unknown expiry is not permission to spend. */ }
    if (!Number.isFinite(expiry) || expiry < Date.now() + 60_000)
      throw new Error('ChatGPT access token expired or expiry unknown. Refresh with the official Codex CLI, then retry. Claudapter never rotates shared tokens.');
    if (this.account && this.account !== auth.tokens.account_id)
      throw new Error('ChatGPT account changed during this session. Restart Claudapter to use the new account.');
    this.account = auth.tokens.account_id;
    return { accessToken: auth.tokens.access_token, accountId: this.account! };
  }

  async status(): Promise<AuthState> {
    try { await this.credentials(); return 'authenticated'; }
    catch (e) {
      const message = (e as Error).message;
      return message.includes('expired') ? 'expired' : message.includes('file session unavailable') ? 'missing' : 'unsupported';
    }
  }
}
