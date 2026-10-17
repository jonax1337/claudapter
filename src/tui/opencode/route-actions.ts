import { createComponent } from 'solid-js';
import type { TuiController } from '../../../dist/tui/controller.js';
import type { RouteAction } from '../../../dist/tui/route-model.js';
import { QUOTA_PREEMPT_PERCENT } from '../../../dist/gateway.js';
import { applyPreset, explainRule, fallbackPresets, type FallbackPreset } from '../../../dist/fallback-presets.js';
import type { FallbackRule } from '../../../dist/config.js';
import type { ActionDialogs } from './actions';
import { FallbackSetup } from './fallback-setup';
import { OFFER_KEYS, offerLabel } from './route-offers';

const CONTROLLER_ACTIONS = ['retry', 'back', 'pin'] as const;
type ControllerAction = typeof CONTROLLER_ACTIONS[number];

/** `/route [retry|back|pin|setup]`: one explicit recovery step, or a menu of the current ones. */
export function createRouteCommand(controller: TuiController, dialogs: ActionDialogs) {
  return async (argument: string) => {
    if (!argument) return openRouteMenu(controller, dialogs);
    if (argument === 'setup') return openFallbackSetup(controller, dialogs);
    if (!(CONTROLLER_ACTIONS as readonly string[]).includes(argument))
      throw new Error('Unknown route action "' + argument + '". Available: ' + [...CONTROLLER_ACTIONS, 'setup'].join(', ') + '.');
    await controller.runRouteOffer(argument as ControllerAction);
    dialogs.close();
  };
}

function openRouteMenu(controller: TuiController, dialogs: ActionDialogs) {
  const offers = controller.state.routeOffers ?? [];
  const run = (action: RouteAction) => action === 'setup' ? openFallbackSetup(controller, dialogs)
    : controller.runRouteOffer(action).then(() => dialogs.close());
  dialogs.menu('Model route', [
    ...offers.map(offer => ({ title: offerLabel(offer), hint: 'alt+' + OFFER_KEYS[offer.action], run: () => run(offer.action) })),
    ...(offers.some(offer => offer.action === 'setup') ? [] : [{ title: 'Guided fallback setup', description: 'Presets from your signed-in models',
      run: () => openFallbackSetup(controller, dialogs) }]),
  ]);
}

/** The guided setup inside /settings; it saves only after an explicit confirmation. */
export function openFallbackSetup(controller: TuiController, dialogs: ActionDialogs) {
  const models = controller.state.models;
  const primary = defaultPrimary(controller);
  const save = async (rule: FallbackRule) => {
    await controller.updateFallback(applyPreset(controller.config, models, rule));
    dialogs.close();
  };
  if (dialogs.panel) {
    dialogs.panel(close => createComponent(FallbackSetup, { models, primary, preemptPercent: QUOTA_PREEMPT_PERCENT, onSave: save, onClose: close }));
    return;
  }
  dialogs.menu('Fallback presets', fallbackPresets(models, primary).map(preset => ({ title: preset.title,
    description: preset.warnings.length + ' capability warning(s)', run: () => confirmPreset(preset, models, dialogs, save) })));
}

function confirmPreset(preset: FallbackPreset, models: TuiController['state']['models'], dialogs: ActionDialogs, save: (rule: FallbackRule) => Promise<void>) {
  const description = [...explainRule(preset.rule, models, QUOTA_PREEMPT_PERCENT), ...preset.warnings].join('\n');
  dialogs.confirm('Enable ' + preset.title + '?', description, () => save(preset.rule));
}

/** The session's model when it is a known one, else the configured default, else the first Claude model. */
function defaultPrimary(controller: TuiController): string {
  const known = (id: string | undefined) => id !== undefined && controller.state.models.some(model => model.id === id);
  if (known(controller.state.model)) return controller.state.model;
  if (known(controller.config.model)) return controller.config.model!;
  return (controller.state.models.find(model => model.provider === 'anthropic') ?? controller.state.models[0])?.id ?? '';
}
