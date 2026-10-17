import { createCliRenderer } from '@opentui/core';
import { render, useKeyboard } from '@opentui/solid';
import { App } from './app';
import { createActions } from './actions';
import { TuiController } from '../../../dist/tui/controller.js';
import { loadConfig } from '../../../dist/config.js';
import { loadPreferences } from '../../../dist/tui/preferences.js';
import { copyText } from '../../../dist/tui/clipboard.js';

const controller = new TuiController(process.argv.slice(2), await loadConfig());
const preferences = await loadPreferences();
const renderer = await createCliRenderer({ exitOnCtrlC: false });
let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  try { await controller.close(); }
  finally { renderer.destroy(); }
}

function TerminalApp() {
  useKeyboard(event => {
    if (!event.ctrl || event.name !== 'c') return;
    event.preventDefault();
    const selected = renderer.getSelection()?.getSelectedText();
    const operation = selected ? copyText(selected).then(()=>renderer.clearSelection()) : controller.state.busy ? controller.interrupt() : close();
    void operation.catch(error => controller.notice((error as Error).message, true));
  });
  return <App controller={controller} preferences={preferences} actions={dialogs=>createActions(controller,dialogs,close)} />;
}

try {
  await render(() => <TerminalApp />, renderer);
  await controller.start();
} catch (error) {
  await close();
  throw error;
}
