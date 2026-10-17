import { spawn } from 'node:child_process';

/** Hosts the TUI may open for the user; everything else is refused, whatever asked for it. */
export const OFFICIAL_HOSTS = ['claude.ai', 'www.anthropic.com', 'support.anthropic.com', 'code.claude.com'] as const;

export type BrowserOpener = (url: string) => Promise<void>;

/** Parses `value` and returns it only when it is an https URL on an official host without credentials. */
export function officialUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Not a valid URL.'); }
  const official = (OFFICIAL_HOSTS as readonly string[]).includes(url.hostname);
  if (url.protocol !== 'https:' || !official || url.username || url.password || url.port) {
    throw new Error(`Refusing to open ${url.origin}: only official https pages on ${OFFICIAL_HOSTS.join(', ')} are allowed.`);
  }
  return url;
}

function launcherFor(url: string): [command: string, args: string[]] {
  if (process.platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
}

/** Starts the platform browser without a shell; resolves once the launcher process has started. */
export const systemBrowser: BrowserOpener = url => new Promise((resolve, reject) => {
  const [command, args] = launcherFor(url);
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', error => reject(new Error(`Could not start a browser (${command}): ${error.message}`)));
  child.once('spawn', () => { child.unref(); resolve(); });
});

/** Opens an official page. Callers must have asked the user first; this never opens anything silently. */
export async function openOfficialPage(value: string, opener: BrowserOpener = systemBrowser): Promise<string> {
  const url = officialUrl(value).toString();
  await opener(url);
  return url;
}
