import type { AppState } from './state.ts';

export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function setupStatus(s: AppState, now: number): { line: string; warnings: string[] } {
  const id = s.identity;
  if (!id) return { line: 'Waiting for Orca to connect…', warnings: [] };
  const last = s.lastRequestAt === undefined ? '' : ` · last request ${agoText(s.lastRequestAt, now)}`;
  const warnings: string[] = [];
  if (id.access === 'read-only') {
    warnings.push("This token is read-only: Orca can show stories but can't comment, assign or change status. Create a token with write access.");
  } else if (id.access === 'unknown') {
    warnings.push("Couldn't verify write access for this token.");
  }
  const newest = s.log[0];
  if (newest?.status === 401 && !/Shortcut API token/.test(newest.error ?? '')) {
    warnings.push("Shortcut rejected the token Orca is using. Check it in Orca's Jira settings.");
  }
  return { line: `Orca connected as ${id.name} · ${id.workspace} · ${id.access} token${last}`, warnings };
}
