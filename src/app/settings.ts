import { readFileSync, writeFileSync } from 'node:fs';

export interface Settings {
  port: number;
}

export const DEFAULT_SETTINGS: Settings = { port: 8089 };

export function validatePort(value: unknown): number | string {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1024 || n > 65535) {
    return 'Port must be a whole number between 1024 and 65535.';
  }
  return n;
}

export function loadSettings(file: string): Settings {
  try {
    const port = validatePort(JSON.parse(readFileSync(file, 'utf8')).port);
    return typeof port === 'number' ? { port } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(file: string, s: Settings): void {
  writeFileSync(file, JSON.stringify(s, null, 2));
}
