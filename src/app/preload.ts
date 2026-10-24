import { contextBridge, ipcRenderer } from 'electron';
import type { SavedFilter } from '../server.ts';
import type { AppState } from './state.ts';

export interface AppApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  setPort(port: number): Promise<{ ok: true } | { ok: false; error: string }>;
  setLaunchAtLogin(on: boolean): Promise<void>;
  setFilters(filters: SavedFilter[]): Promise<{ ok: true } | { ok: false; error: string }>;
  copy(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

const api: AppApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => void ipcRenderer.on('state:changed', (_e, s: AppState) => cb(s)),
  setPort: (port) => ipcRenderer.invoke('settings:port', port),
  setLaunchAtLogin: (on) => ipcRenderer.invoke('settings:login', on),
  setFilters: (filters) => ipcRenderer.invoke('settings:filters', filters),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
};

contextBridge.exposeInMainWorld('app', api);
