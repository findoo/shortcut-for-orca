import { agoText, setupStatus } from './view.ts';
import type { AppState } from './state.ts';

const base: AppState = { proxy: { state: 'running', port: 8089 }, log: [], launchAtLogin: false };
const identity = { name: 'Ada', mention: 'ada', workspace: 'acme', access: 'read-write' as const };
const ev = (status: number, error?: string) => ({ at: 1000, method: 'GET', path: '/x', status, ms: 1, error });

describe('agoText', () => {
  it('formats seconds, minutes and hours', () => {
    expect(agoText(10_000, 10_000)).toBe('0s ago');
    expect(agoText(10_000, 14_900)).toBe('4s ago');
    expect(agoText(0, 125_000)).toBe('2m ago');
    expect(agoText(0, 7_300_000)).toBe('2h ago');
    expect(agoText(5000, 1000)).toBe('0s ago');
  });
});

describe('setupStatus', () => {
  it('waits when there is no identity', () => {
    expect(setupStatus(base, 0)).toEqual({ line: 'Waiting for Orca to connect…', warnings: [] });
  });
  it('warns about a rejected token even before any identity is known', () => {
    const r = setupStatus({ ...base, log: [ev(401, 'Shortcut said no')] }, 0);
    expect(r.line).toBe('Waiting for Orca to connect…');
    expect(r.warnings[0]).toMatch(/Shortcut rejected/);
    expect(setupStatus({ ...base, log: [ev(401, 'Missing Shortcut API token')] }, 0)).toEqual({ line: 'Waiting for Orca to connect…', warnings: [] });
  });
  it('shows the connected line', () => {
    const s = { ...base, identity, lastRequestAt: 1000 };
    expect(setupStatus(s, 4000).line).toBe('Orca connected as Ada · acme · read-write token · last request 3s ago');
  });
  it('omits last request when none yet', () => {
    expect(setupStatus({ ...base, identity }, 0).line).toBe('Orca connected as Ada · acme · read-write token');
  });
  it('warns on read-only and unknown access', () => {
    expect(setupStatus({ ...base, identity: { ...identity, access: 'read-only' } }, 0).warnings[0]).toMatch(/read-only/);
    expect(setupStatus({ ...base, identity: { ...identity, access: 'unknown' } }, 0).warnings).toEqual([
      "Couldn't verify write access for this token.",
    ]);
  });
  it('warns when Shortcut rejected the token (401 not about a missing token)', () => {
    const rejected = { ...base, identity, log: [ev(401, 'Shortcut said no')] };
    expect(setupStatus(rejected, 0).warnings[0]).toMatch(/Shortcut rejected/);
    const missing = { ...base, identity, log: [ev(401, 'Missing Shortcut API token')] };
    expect(setupStatus(missing, 0).warnings).toEqual([]);
    expect(setupStatus({ ...base, identity, log: [ev(401), ev(200)] }, 0).warnings[0]).toMatch(/Shortcut rejected/);
    expect(setupStatus({ ...base, identity, log: [ev(200), ev(401, 'x')] }, 0).warnings).toEqual([]);
  });
});
