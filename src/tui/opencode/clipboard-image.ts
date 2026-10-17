import { spawn } from 'node:child_process';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMMAND_TIMEOUT_MS = 5000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OUTPUT_ENV = 'CLAUDAPTER_CLIPBOARD_IMAGE';

export interface ClipboardImageCommand {
  command: string;
  args: string[];
  /** `file`: the command writes the PNG to the path in {@link OUTPUT_ENV}; `stdout`: the PNG is read from its output. */
  output: 'file' | 'stdout';
}

const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$image = [System.Windows.Forms.Clipboard]::GetImage()',
  'if ($null -eq $image) { exit 3 }',
  `$image.Save($env:${OUTPUT_ENV}, [System.Drawing.Imaging.ImageFormat]::Png)`,
].join('; ');

const MACOS_SCRIPT = [
  'set data to the clipboard as «class PNGf»',
  `set target to open for access POSIX file (system attribute "${OUTPUT_ENV}") with write permission`,
  'write data to target',
  'close access target',
];

/** Platform specific command that exports the clipboard image as PNG. The output path never enters a command line. */
export function clipboardImageCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): ClipboardImageCommand {
  if (platform === 'win32') return { command: 'powershell.exe', output: 'file', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT] };
  if (platform === 'darwin') return { command: 'osascript', output: 'file', args: MACOS_SCRIPT.flatMap(line => ['-e', line]) };
  return env.WAYLAND_DISPLAY ?
    { command: 'wl-paste', output: 'stdout', args: ['--type', 'image/png'] } :
    { command: 'xclip', output: 'stdout', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] };
}

function run(spec: ClipboardImageCommand, outputPath: string): Promise<Buffer | undefined> {
  return new Promise(resolve => {
    const child = spawn(spec.command, spec.args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false,
      env: { ...process.env, [OUTPUT_ENV]: outputPath } });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) child.kill(); else chunks.push(chunk);
    });
    child.once('error', () => { clearTimeout(timer); resolve(undefined); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0 && size <= MAX_IMAGE_BYTES ? Buffer.concat(chunks) : undefined); });
  });
}

/**
 * Saves the clipboard image to a private temporary PNG and returns its path, or undefined when the
 * clipboard holds no image or the platform tool is unavailable.
 */
export async function saveClipboardImage(): Promise<string | undefined> {
  const spec = clipboardImageCommand(process.platform);
  const path = join(await mkdtemp(join(tmpdir(), 'claudapter-clipboard-')), 'clipboard.png');
  const output = await run(spec, path);
  if (!output) return undefined;
  if (spec.output === 'stdout') {
    if (!output.length) return undefined;
    await writeFile(path, output, { mode: 0o600 });
    return path;
  }
  return await stat(path).then(info => (info.size > 0 ? path : undefined), () => undefined);
}
