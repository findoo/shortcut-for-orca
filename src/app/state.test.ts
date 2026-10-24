import type { RequestEvent } from '../server.ts';
import { LOG_LIMIT, initialState, withRequest } from './state.ts';

const ev = (o: Partial<RequestEvent> = {}): RequestEvent => ({ at: 1, method: 'GET', path: '/x', status: 200, ms: 1, ...o });

describe('state', () => {
  it('caps the log, newest first', () => {
    let s = initialState(8089, false);
    for (let i = 0; i < 250; i++) s = withRequest(s, ev({ at: i }));
    expect(LOG_LIMIT).toBe(200);
    expect(s.log).toHaveLength(200);
    expect(s.log[0].at).toBe(249);
  });
  it('ignores missing-auth 401 for lastRequestAt', () => {
    const s = withRequest(initialState(8089, false), ev({ status: 401, error: 'Use your Shortcut API token as the Jira personal access token.' }));
    expect(s.lastRequestAt).toBeUndefined();
    expect(s.log).toHaveLength(1);
  });
  it('sets lastRequestAt on success', () => {
    expect(withRequest(initialState(8089, false), ev({ at: 42 })).lastRequestAt).toBe(42);
  });
});
