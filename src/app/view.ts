import { MISSING_TOKEN_MESSAGE } from '../messages.ts';
import type { AppState } from './state.ts';

export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const rejectedMsg = "Shortcut rejected the token Orca is using. Check it in Orca's Jira settings.";

// Set when the newest request was a 401 from Shortcut (not just a missing token).
export function rejectedWarning(s: AppState): string | undefined {
  const newest = s.log[0];
  return newest?.status === 401 && newest.error !== MISSING_TOKEN_MESSAGE ? rejectedMsg : undefined;
}

export function setupStatus(s: AppState, now: number): { line: string; warnings: string[] } {
  const id = s.identity;
  const rejected = rejectedWarning(s) !== undefined;
  if (s.proxy.state === 'error') {
    return {
      line: `Not running on port ${s.proxy.port}: ${s.proxy.message}`,
      warnings: ['Change the port in Settings, then use the new address in Orca.'],
    };
  }
  if (!id) return { line: 'Waiting for Orca to connect…', warnings: rejected ? [rejectedMsg] : [] };
  const last = s.lastRequestAt === undefined ? '' : ` · last request ${agoText(s.lastRequestAt, now)}`;
  const warnings: string[] = [];
  if (id.access === 'read-only') {
    warnings.push("This token is read-only: Orca can show stories but can't comment, assign or change status. Create a token with write access.");
  } else if (id.access === 'unknown') {
    warnings.push("Couldn't verify write access for this token.");
  }
  if (rejected) warnings.push(rejectedMsg);
  return { line: `Orca connected as ${id.name} · ${id.workspace} · ${id.access} token${last}`, warnings };
}
