import { createEffect, createMemo, createSignal } from 'solid-js';
import type { MenuItem } from './menu';
import type { TaskMap } from './tasks-model';
import { MAIN_VIEW, ViewHistory, addresseeOf, agentTabs, cycleView, type AgentStreamMap } from './agent-model';

export interface AgentSource {
  tasks(): TaskMap | undefined;
  streams(): AgentStreamMap | undefined;
  messaging(): boolean | undefined;
}

interface NavigationKey { name: string; meta?: boolean; option?: boolean; ctrl?: boolean; shift?: boolean }

/** Which view the session shows (main or one sub-agent), the tab strip, and where the composer sends. */
export function useAgentNavigation(source: AgentSource) {
  const history = new ViewHistory();
  const [view, setView] = createSignal(MAIN_VIEW);
  const tabs = createMemo(() => agentTabs(source.tasks(), source.streams()));
  const show = () => setView(history.view);
  const open = (id: string) => { history.open(id); show(); };
  const back = () => { history.back(); show(); };
  const cycle = (delta: number) => open(cycleView(view(), tabs(), delta));
  createEffect(() => {
    const known = new Set(tabs().map(tab => tab.id));
    history.retain(id => known.has(id));
    show();
  });

  /** Alt+←/→ cycles, Alt+0…9 picks a tab, Esc in an agent view returns to the previous view. True when handled. */
  function handleKey(event: NavigationKey): boolean {
    const alt = Boolean(event.meta || event.option) && !event.ctrl;
    if (alt && (event.name === 'left' || event.name === 'right')) { cycle(event.name === 'left' ? -1 : 1); return true; }
    if (alt && /^[0-9]$/.test(event.name)) {
      const tab = tabs()[Number(event.name)];
      if (tab) open(tab.id);
      return Boolean(tab);
    }
    if (event.name === 'escape' && view() !== MAIN_VIEW) { back(); return true; }
    return false;
  }

  const menuItems = (): MenuItem[] => tabs().map((tab, index) => ({
    title: tab.label, description: tab.id === MAIN_VIEW ? 'Main conversation' : tab.status ?? 'agent', hint: 'alt+' + index,
    current: tab.id === view(), run: () => open(tab.id),
  }));

  return {
    view, tabs, open, back, handleKey, menuItems,
    focused: () => view() !== MAIN_VIEW,
    addressee: () => addresseeOf(view(), source.tasks()?.[view()], source.messaging()),
  };
}
