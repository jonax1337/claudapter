import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyText } from '../clipboard.js';

const COMMAND_TIMEOUT_MS = 5000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OUTPUT_ENV = 'CLAUDAPTER_CLIPBOARD_IMAGE';
/** Directories holding saved images, so they can be removed again when the controller closes. */
const savedDirs = new Set<string>();

function rememberDir(dir: string): string {
  savedDirs.add(dir);
  return dir;
}

/** Best-effort removal of every saved image directory; a file a viewer still holds open is left behind. */
export async function cleanupSavedImages(): Promise<void> {
  await Promise.allSettled([...savedDirs].map(dir => rm(dir, { recursive: true, force: true })));
  savedDirs.clear();
}

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
  const path = join(rememberDir(await mkdtemp(join(tmpdir(), 'claudapter-clipboard-'))), 'clipboard.png');
  const output = await run(spec, path);
  if (!output) return undefined;
  if (spec.output === 'stdout') {
    if (!output.length) return undefined;
    await writeFile(path, output, { mode: 0o600 });
    return path;
  }
  return await stat(path).then(info => (info.size > 0 ? path : undefined), () => undefined);
}

/** An image on the clipboard or in a viewer is handled by a platform command that reads the file path from the environment. */
export interface ImageFileCommand {
  command: string;
  args: string[];
  /** `argument`: the path is appended to the arguments; `stdin`: the file content is piped in; `env`: read from {@link OUTPUT_ENV}. */
  path: 'argument' | 'stdin' | 'env';
}

const WINDOWS_COPY_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  `$image = [System.Drawing.Image]::FromFile($env:${OUTPUT_ENV})`,
  '[System.Windows.Forms.Clipboard]::SetImage($image)',
  '$image.Dispose()',
].join('; ');

const MACOS_COPY_SCRIPT = `set the clipboard to (read (POSIX file (system attribute "${OUTPUT_ENV}")) as «class PNGf»)`;

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export function imageExtension(mediaType: string): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType] ?? 'img';
}

/** Command that opens an image file in the platform's default viewer. */
export function openImageCommand(platform: NodeJS.Platform): ImageFileCommand {
  if (platform === 'win32') return { command: 'powershell.exe', path: 'env', args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -LiteralPath $env:${OUTPUT_ENV}`] };
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', path: 'argument', args: [] };
}

/**
 * Command that puts an image file on the clipboard, or undefined when the platform tool cannot take this
 * format (macOS accepts PNG only; X11 and Wayland take the media type as given).
 */
export function copyImageCommand(platform: NodeJS.Platform, mediaType: string, env: NodeJS.ProcessEnv = process.env): ImageFileCommand | undefined {
  if (platform === 'win32') return { command: 'powershell.exe', path: 'env', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_COPY_SCRIPT] };
  if (platform === 'darwin') return mediaType === 'image/png' ? { command: 'osascript', path: 'env', args: ['-e', MACOS_COPY_SCRIPT] } : undefined;
  return env.WAYLAND_DISPLAY ?
    { command: 'wl-copy', path: 'stdin', args: ['--type', mediaType] } :
    { command: 'xclip', path: 'stdin', args: ['-selection', 'clipboard', '-t', mediaType, '-i'] };
}

/** Writes the base64 payload of an image to a private temporary file and returns its path. */
export async function saveImageFile(image: { mediaType: string; data?: string }): Promise<string> {
  if (!image.data) throw new Error('The image content was not kept (too large). Re-open it from the session transcript.');
  const path = join(rememberDir(await mkdtemp(join(tmpdir(), 'claudapter-image-'))), `image.${imageExtension(image.mediaType)}`);
  await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 });
  return path;
}

function runImageCommand(spec: ImageFileCommand, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = spec.path === 'argument' ? [...spec.args, filePath] : spec.args;
    const child = spawn(spec.command, args, { stdio: [spec.path === 'stdin' ? 'pipe' : 'ignore', 'ignore', 'ignore'], windowsHide: true, shell: false,
      env: { ...process.env, [OUTPUT_ENV]: filePath } });
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
    child.once('error', () => { clearTimeout(timer); reject(new Error(`${spec.command} is not available on this system.`)); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${spec.command} failed (exit ${code}).`)); });
    if (spec.path === 'stdin') readFile(filePath).then(content => child.stdin?.end(content), reject);
  });
}

/** Opens the image in the default viewer and returns the file it was saved to. */
export async function openImage(image: { mediaType: string; data?: string }): Promise<string> {
  const path = await saveImageFile(image);
  await runImageCommand(openImageCommand(process.platform), path);
  return path;
}

/**
 * Copies the image itself to the clipboard. Where the platform tool cannot take the format, the saved file's
 * path is copied as text instead; the result says which of the two happened.
 */
export async function copyImage(image: { mediaType: string; data?: string }): Promise<{ copied: 'image' | 'path'; path: string }> {
  const path = await saveImageFile(image);
  const spec = copyImageCommand(process.platform, image.mediaType);
  if (spec) {
    try {
      await runImageCommand(spec, path);
      return { copied: 'image', path };
    } catch { /* fall through to the path */ }
  }
  await copyText(path);
  return { copied: 'path', path };
}
