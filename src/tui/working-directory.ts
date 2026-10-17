import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { Config } from '../config.js';
import { prepareSettings } from '../launcher.js';
import type { Registry } from '../models.js';
import { invokeCompat } from './compat.js';

export interface WorkingDirectoryHost {
  /** Directory the session currently runs in. */
  cwd: string;
  query: Query;
  /** Launch arguments, so the target's settings are validated exactly as a launch from there would be. */
  args: string[];
  config: Config;
  registry: Registry;
  /** Asks the user whether to trust `directory`; resolves true only for an explicit yes. */
  confirmTrust(directory: string): Promise<boolean>;
}

export interface WorkingDirectoryChange {
  cwd: string;
  changed: boolean;
}

const samePath = (left: string, right: string) =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

function expandHome(input: string): string {
  if (input === '~') return homedir();
  return input.startsWith('~/') || input.startsWith('~\\') ? join(homedir(), input.slice(2)) : input;
}

/** Absolute, symlink-resolved existing directory for `/cd <input>`; relative input is relative to `base`. */
export async function resolveTargetDirectory(base: string, input: string): Promise<string> {
  const text = input.trim();
  if (!text) throw new Error('Name a directory: /cd <path>');
  const target = resolve(base, expandHome(text));
  const info = await stat(target).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Not a directory: ${target}`);
  return realpath(target);
}

/**
 * Moves the running Claude Code session to another project directory.
 * The target's settings are validated first (gateway, provider and agent overrides are refused as
 * at launch); the engine then relocates, and an untrusted target needs renewed explicit trust
 * that the engine records itself. Nothing is changed when any step refuses.
 */
export async function changeWorkingDirectory(host: WorkingDirectoryHost, input: string): Promise<WorkingDirectoryChange> {
  const target = await resolveTargetDirectory(host.cwd, input);
  if (samePath(target, host.cwd)) return { cwd: host.cwd, changed: false };
  await prepareSettings(host.args, host.registry, host.config, target);
  const outcome = await relocate(host, target);
  return { cwd: outcome.cwd, changed: outcome.changed };
}

async function relocate(host: WorkingDirectoryHost, target: string) {
  let response = await invokeCompat(host.query, 'setCwd', { path: target });
  if (response.status === 'needs_trust') {
    if (!isAbsolute(response.directory) || !await host.confirmTrust(response.directory)) throw new Error('Directory change cancelled: the project was not trusted.');
    response = await invokeCompat(host.query, 'setCwd', { path: target, trustAccepted: true, trustedDirectory: response.directory, confirmed: true });
  }
  if (response.status === 'rejected') throw new Error(`Claude Code refused to change directory: ${response.message}`);
  if (response.status !== 'ok') throw new Error('Claude Code did not confirm the directory change.');
  return response as { cwd: string; changed: boolean };
}

/** Text of the trust dialog that precedes a relocation into an untrusted directory. */
export function trustDirectoryPrompt(directory: string): string {
  return `${directory}\n\nTrust allows this project's configured tools, hooks, plugins and permission allow rules to load for this session. Only trust code you own or have reviewed. Claude Code itself records your explicit choice.`;
}
