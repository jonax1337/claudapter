import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function runTui(args: string[]): Promise<number> {
  const entry = fileURLToPath(new URL('./opencode.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [entry, ...args], { stdio: 'inherit', windowsHide: false });
    // The child owns terminal Ctrl+C; keep the parent alive until it restores the terminal.
    const interrupt = () => {};
    process.on('SIGINT', interrupt);
    child.once('error', error => {
      process.off('SIGINT', interrupt);
      reject(new Error('Cannot start the TUI. Install Bun >=1.3.14 and ensure bun is on PATH.', { cause: error }));
    });
    child.once('exit', code => {
      process.off('SIGINT', interrupt);
      resolve(code ?? 1);
    });
  });
}
