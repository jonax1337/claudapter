import type { RouteAction, RouteOffer } from '../../../dist/tui/route-model.js';
import type { KeyHint } from './dialog';

/** Alt chords stay free of the composer's typing and of the ctrl shortcuts. */
export const OFFER_KEYS: Record<RouteAction, string> = { retry: 'r', back: 'b', pin: 'p', setup: 'f' };
export const ROUTE_COMMAND = '/route';

export function offerLabel(offer: RouteOffer): string {
  switch (offer.action) {
    case 'retry': return offer.target ? 'retry this turn on ' + offer.target : 'retry this turn';
    case 'back': return 'switch back to ' + offer.requested;
    case 'pin': return 'pin ' + offer.model + ' for this session';
    case 'setup': return 'set up fallback';
  }
}

export function offerHints(offers: readonly RouteOffer[]): KeyHint[] {
  return offers.map(offer => ['alt+' + OFFER_KEYS[offer.action], offerLabel(offer)]);
}

/** The offer an `alt+<key>` press selects, if that key belongs to one of the current offers. */
export function offerForKey(offers: readonly RouteOffer[], key: { name: string; meta?: boolean; ctrl?: boolean }): RouteOffer | undefined {
  if (!key.meta || key.ctrl) return;
  return offers.find(offer => OFFER_KEYS[offer.action] === key.name);
}
