import { MISSING_TOKEN_MESSAGE } from '../messages.ts';
import type { Identity, RequestEvent, SavedFilter } from '../server.ts';

export type ProxyStatus =
  | { state: 'starting' | 'running'; port: number }
  | { state: 'error'; port: number; message: string };

export interface AppState {
  proxy: ProxyStatus;
  identity?: Identity;
  lastRequestAt?: number;
  log: RequestEvent[];
  launchAtLogin: boolean;
  filters: SavedFilter[];
}

export const LOG_LIMIT = 200;

export function initialState(port: number, launchAtLogin: boolean, filters: SavedFilter[] = []): AppState {
  return { proxy: { state: 'starting', port }, log: [], launchAtLogin, filters };
}

export function withRequest(s: AppState, e: RequestEvent): AppState {
  const missingAuth = e.status === 401 && e.error === MISSING_TOKEN_MESSAGE;
  return {
    ...s,
    log: [e, ...s.log].slice(0, LOG_LIMIT),
    lastRequestAt: missingAuth ? s.lastRequestAt : e.at,
  };
}

export function withIdentity(s: AppState, identity: Identity): AppState {
  return { ...s, identity };
}

export function withProxy(s: AppState, proxy: ProxyStatus): AppState {
  return { ...s, proxy };
}
