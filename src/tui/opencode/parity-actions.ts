// Slash commands that close native-parity gaps: side questions, /cd, editor mode, references, account pages and honest "not here" entries.
import { createComponent } from 'solid-js';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { AdminContext } from '../../../dist/tui/admin.js';
import { adminSnapshot } from '../../../dist/tui/admin.js';
import { summarizeFromCheckpointCommand } from '../../../dist/tui/checkpoint-summary.js';
import type { TuiController } from '../../../dist/tui/controller.js';
import { openOfficialPage, type BrowserOpener } from '../../../dist/tui/external-link.js';
import {
  confirmationText, OFFICIAL_PAGES, TUTORIAL_SECTIONS, UNAVAILABLE_FEATURES, unavailableText,
} from '../../../dist/tui/parity-info.js';
import { loadPreferences, savePreferences } from '../../../dist/tui/preferences.js';
import { askSideQuestion, requireSideQuestion, type SideAnswer } from '../../../dist/tui/side-question.js';
import type { ActionDialogs } from './actions';
import { editorMode, setEditorMode } from './editor-mode';
import { keymapSections } from './keymap';
import { SideQuestionPanel } from './side-question-view';

export interface ParityHost {
  controller: TuiController;
  dialogs: ActionDialogs;
  liveQuery(): Query;
  show(title: string, value: unknown): void;
  adminContext(): AdminContext;
  /** Replaces the system browser, for tests. */
  openBrowser?: BrowserOpener;
}

type Register = (name: string, description: string, run: (argument: string) => void | Promise<void>) => void;

interface AskedQuestion {
  question: string;
  task: Promise<SideAnswer | undefined>;
}

const SIDE_QUESTION_HISTORY = 20;
const NO_SIDE_QUESTIONS = 'No side questions yet. Ask one with /btw <question>.';

export function registerParityCommands(register: Register, host: ParityHost) {
  registerSideQuestions(register, host);
  registerDirectoryAndEditor(register, host);
  registerReferences(register, host);
  registerAccountPages(register, host);
}

function registerSideQuestions(register: Register, host: ParityHost) {
  const { dialogs } = host;
  const asked: AskedQuestion[] = [];

  function open({ question, task }: AskedQuestion, cancel: () => void) {
    if (dialogs.panel) dialogs.panel(close => createComponent(SideQuestionPanel, { question, task, onCancel: cancel, onClose: close }));
    else void task.then(answer => dialogs.view('Side question', `${question}\n\n${answer?.text || 'The model returned no answer.'}`));
  }
  function ask(text: string) {
    const question = requireSideQuestion(text);
    const abort = new AbortController();
    const entry = { question, task: askSideQuestion(host.liveQuery(), question, abort.signal) };
    entry.task.catch(() => undefined);
    asked.push(entry);
    if (asked.length > SIDE_QUESTION_HISTORY) asked.shift();
    open(entry, () => abort.abort());
  }
  function browse() {
    if (!asked.length) throw new Error(NO_SIDE_QUESTIONS);
    dialogs.menu('Earlier side questions', [...asked].reverse().map(entry => ({ title: entry.question.slice(0, 100), run: () => open(entry, () => undefined) })));
  }
  register('/btw', 'Ask a side question without interrupting the turn', argument => argument.trim() ? ask(argument) : browse());
}

function registerDirectoryAndEditor(register: Register, host: ParityHost) {
  const { dialogs, controller } = host;
  const move = async (path: string) => { await controller.changeDirectory(path); dialogs.close(); };
  register('/cd', 'Move this session to another directory', argument => argument.trim()
    ? move(argument)
    : dialogs.form('Change directory', 'Moves the session and keeps the conversation. A project you have not trusted asks for your consent first.',
      [{ key: 'path', label: 'Directory', required: true }], fields => move(fields.path)));
  register('/vim', 'Switch the prompt between default and Vim editing', async () => {
    const next = editorMode() === 'vim' ? 'normal' : 'vim';
    await savePreferences({ ...await loadPreferences(), editorMode: next });
    setEditorMode(next);
    controller.notice(next === 'vim' ? 'Vim mode on: the prompt starts in INSERT; Esc enters NORMAL. See /keymap.' : 'Default prompt editing restored.');
    dialogs.close();
  });
}

function registerReferences(register: Register, host: ParityHost) {
  const { dialogs, show } = host;
  register('/keymap', 'Every keyboard shortcut, generated from the registered keys', async () =>
    show('Keyboard reference', { sections: keymapSections((await loadPreferences()).keybindings) }));
  register('/tutorial', 'A short guided tour of Claudapter', () => show('Getting started', { sections: TUTORIAL_SECTIONS }));
  for (const feature of UNAVAILABLE_FEATURES) {
    register(feature.command, `${feature.title} (not available here)`, () => dialogs.view(`${feature.title}: not available in Claudapter`, unavailableText(feature)));
  }
}

function registerAccountPages(register: Register, host: ParityHost) {
  const { dialogs, controller, show } = host;
  register('/account', 'Show the signed-in Claude account (read-only)', async () => show('Account', await adminSnapshot('auth', host.adminContext())));
  for (const page of OFFICIAL_PAGES) {
    register(page.command, `${page.title} in your browser (asks first)`, () => dialogs.confirm(`Open ${page.title}?`, confirmationText(page), async () => {
      const url = await openOfficialPage(page.url, host.openBrowser);
      controller.notice(`Opened ${url} in your browser.`);
      dialogs.close();
    }));
  }
}

/** Rewind menu entry: compaction focused on the work from a checkpoint onward. */
export function summarizeFromCheckpointItem(host: Pick<ParityHost, 'controller' | 'dialogs'>, prompt: string) {
  const { controller, dialogs } = host;
  return {
    title: 'Summarize from here',
    description: 'Compacts the whole conversation, keeping detail from this point on',
    run: () => dialogs.confirm('Summarize from this checkpoint?',
      'Claude compacts the conversation with a model request, keeping the detail of this checkpoint and everything after it. Unlike the native partial summary it also condenses the earlier part, and files are not restored.',
      () => {
        if (controller.state.busy) throw new Error('Wait for the turn to finish before summarizing.');
        controller.send(summarizeFromCheckpointCommand(prompt));
        dialogs.close();
      }),
  };
}
