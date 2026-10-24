import { readFileSync, writeFileSync } from 'node:fs';
import type { SavedFilter } from '../server.ts';

export interface Settings {
  port: number;
  filters: SavedFilter[];
}

export const DEFAULT_SETTINGS: Settings = { port: 8089, filters: [] };

export function validatePort(value: unknown): number | string {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1024 || n > 65535) {
    return 'Port must be a whole number between 1024 and 65535.';
  }
  return n;
}

export function validateFilters(value: unknown): SavedFilter[] | string {
  if (!Array.isArray(value)) return 'Filters must be a list.';
  const filters: SavedFilter[] = [];
  for (const f of value) {
    const name = typeof f?.name === 'string' ? f.name.trim() : '';
    const jql = typeof f?.jql === 'string' ? f.jql.trim() : '';
    if (!name || !jql) return 'Every filter needs a name and a JQL query.';
    filters.push({ name, jql });
  }
  return filters;
}

export function loadSettings(file: string): Settings {
  let raw: { port?: unknown; filters?: unknown } = {};
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // missing or corrupt: defaults
  }
  const port = validatePort(raw?.port);
  const filters = validateFilters(raw?.filters);
  return {
    port: typeof port === 'number' ? port : DEFAULT_SETTINGS.port,
    filters: typeof filters === 'string' ? [] : filters,
  };
}

export function saveSettings(file: string, s: Settings): void {
  writeFileSync(file, JSON.stringify(s, null, 2));
}
