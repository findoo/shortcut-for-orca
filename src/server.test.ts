import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ADA_ICON, lookups, stories } from './fixtures.ts';
import { compileJql } from './jql.ts';
import { MISSING_TOKEN_MESSAGE, handle, tokenAccess, type Identity, type RequestEvent } from './server.ts';

const realFetch = global.fetch; // `call` talks to the proxy for real; Shortcut is mocked
const events: RequestEvent[] = [];
const identities: Identity[] = [];
let server: Server;
let base: string;
let forbidWrites = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const iconTokens: string[] = [];
/** Every write the proxy sent to Shortcut, so tests can check exactly what would change. */
const writes: { method: string; path: string; body: unknown }[] = [];

function shortcut(url: string, method: string, headers?: HeadersInit, body?: unknown): Response {
  if (url === ADA_ICON) {
    iconTokens.push(new Headers(headers).get('Shortcut-Token') ?? '');
    return new Response(Buffer.from('PNG'), { headers: { 'Content-Type': 'image/png' } });
  }
  const path = new URL(url).pathname;
  if (method === 'POST' && forbidWrites) return json({ message: 'Forbidden' }, 403);
  if (method !== 'GET') writes.push({ method, path, body: typeof body === 'string' ? JSON.parse(body) : body });
  if (method === 'POST' && path === '/api/v3/stories') return json({ ...stories[0], id: 99, app_url: 'x' }, 201);
  const found: Record<string, unknown> = {
    '/api/v3/member': { ...lookups.me, name: 'Ada Lovelace' },
    '/api/v3/members': [...lookups.members.values()],
    '/api/v3/groups': lookups.groups,
    '/api/v3/workflows': [{ id: 1, name: 'Default', states: [...lookups.states.values()] }],
    '/api/v3/iterations': [...lookups.iterations.values()],
    '/api/v3/custom-fields': lookups.customFields,
    '/api/v3/stories/1': stories[0],
  };
  return path in found ? json(found[path]) : json({ message: 'not found' }, 404);
}

beforeAll(async () => {
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (input, init) => shortcut(String(input), init?.method ?? 'GET', init?.headers, init?.body));
  const hooks = {
    onRequest: (e: RequestEvent) => events.push(e),
    onIdentity: (i: Identity) => identities.push(i),
    filters: () => [{ name: 'Web bugs', jql: 'project = WEB AND type = bug' }],
  };
  server = createServer((q, s) => void handle(q, s, hooks));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  jest.restoreAllMocks();
});

const call = (path: string, token?: string, method = 'GET', body: unknown = { body: 'hi' }) =>
  realFetch(base + path, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });

it('emits a 401 event without auth', async () => {
  const res = await call('/rest/api/2/myself');
  expect(res.status).toBe(401);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ method: 'GET', path: '/rest/api/2/myself', status: 401 });
  expect(events[0].error).toBe(MISSING_TOKEN_MESSAGE);
  expect(Number.isInteger(events[0].ms)).toBe(true);
  expect(identities).toHaveLength(0);
});

it('emits identity once per token', async () => {
  await call('/rest/api/2/myself?x=1', 'sct_rw_TESTTOKEN');
  await call('/rest/api/2/myself', 'sct_rw_TESTTOKEN');
  expect(identities).toEqual([{ name: 'Ada Lovelace', mention: 'ada', workspace: 'acme', access: 'read-write' }]);
  expect(events.at(-2)).toMatchObject({ path: '/rest/api/2/myself', status: 200 });
});

it('marks read-only on Shortcut 403 write', async () => {
  forbidWrites = true;
  const res = await call('/rest/api/2/issue/SC-1/comment', 'TESTTOKEN-UUID', 'POST');
  expect(res.status).toBe(403);
  expect(events.at(-1)).toMatchObject({ method: 'POST', status: 403 });
  expect(events.at(-1)?.error).toMatch(/Forbidden/);
  expect(identities.at(-1)).toMatchObject({ name: 'Ada Lovelace', access: 'read-only' });
});

it('reports 204 no-content responses as 204', async () => {
  const res = await call('/rest/api/2/issue/SC-1/assignee', 'sct_rw_TESTTOKEN', 'PUT', { name: 'u2' });
  expect(res.status).toBe(204);
  expect(events.at(-1)).toMatchObject({ method: 'PUT', path: '/rest/api/2/issue/SC-1/assignee', status: 204 });
});

it('reports redirects as events without identity', async () => {
  const before = identities.length;
  const res = await call('/browse/SC-1');
  expect(res.status).toBe(302);
  expect(events.at(-1)).toMatchObject({ path: '/browse/SC-1', status: 302 });
  expect(identities).toHaveLength(before);
});

it('keeps read-only sticky for tokens that cannot write', async () => {
  forbidWrites = true;
  await call('/rest/api/2/issue/SC-1/comment', 'TESTTOKEN-STICKY', 'POST');
  forbidWrites = false;
  const res = await call('/rest/api/2/myself', 'TESTTOKEN-STICKY');
  expect(res.status).toBe(200);
  expect(identities.at(-1)?.access).toBe('read-only');
  expect(identities.filter((i) => i.access === 'unknown')).toEqual([]);
});

it('never leaks the token', async () => {
  await call('/rest/api/2/myself', 'sct_rw_LEAKCHECK');
  await call('/rest/api/2/myself', 'LEAKCHECK-UUID');
  expect(events.length + identities.length).toBeGreaterThan(0);
  expect(JSON.stringify([events, identities])).not.toContain('LEAKCHECK');
});

it('serves Shortcut media from the proxy without a token', async () => {
  const me = await (await call('/rest/api/2/myself', 'sct_rw_media')).json();
  const url: string = me.avatarUrls['48x48'];
  expect(url).toMatch(new RegExp(`^${base}/media/[0-9a-f]{32}$`));
  expect(JSON.stringify(me)).not.toContain('shortcut.com');
  const logged = events.length;
  const img = await call(url.slice(base.length));
  expect(img.status).toBe(200);
  expect(img.headers.get('content-type')).toBe('image/png');
  expect(await img.text()).toBe('PNG');
  expect(iconTokens).toEqual(['sct_rw_TESTTOKEN']); // fetched once, with the token of the first request that showed it
  expect((await (await call('/rest/api/2/myself', 'sct_rw_media')).json()).avatarUrls['48x48']).toBe(url);
  expect(iconTokens).toHaveLength(1);
  expect(events).toHaveLength(logged + 1); // the image request is not in the log
  expect((await call('/media/nope')).status).toBe(404);
});

it('lists preset and user filters as Jira favourites', async () => {
  const res = await call('/rest/api/2/filter/favourite?expand=jql', 'sct_rw_TESTTOKEN');
  const filters: { id: string; name: string; jql: string }[] = await res.json();
  expect(filters.map((f) => [f.id, f.name])).toEqual([
    ['1', 'My open stories'],
    ['2', 'Requested by me'],
    ['3', 'Current sprint'], // Sprint 42 is started
    ['4', 'WEB: open stories'], // only teams Ada is in
    ['5', 'Web bugs'],
  ]);
  for (const f of filters) expect(() => compileJql(f.jql, lookups)).not.toThrow();
});

describe('writes send exactly what was asked', () => {
  const T = 'sct_rw_TESTTOKEN';
  beforeEach(() => {
    writes.length = 0;
  });

  it('assigns and unassigns', async () => {
    expect((await call('/rest/api/2/issue/SC-1/assignee', T, 'PUT', { name: 'u2' })).status).toBe(204);
    expect((await call('/rest/api/2/issue/SC-1/assignee', T, 'PUT', { name: null })).status).toBe(204);
    expect(writes).toEqual([
      { method: 'PUT', path: '/api/v3/stories/1', body: { owner_ids: ['u2'] } },
      { method: 'PUT', path: '/api/v3/stories/1', body: { owner_ids: [] } },
    ]);
  });

  it.each([[{ typo: 'u2' }], [{}], [{ name: 42 }], [{ name: 'nobody' }]])('rejects assignee body %p without writing', async (body) => {
    expect((await call('/rest/api/2/issue/SC-1/assignee', T, 'PUT', body)).status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('creates a story in the given team', async () => {
    const res = await call('/rest/api/2/issue', T, 'POST', {
      fields: { project: { key: 'WEB' }, issuetype: { id: 'bug' }, summary: ' Crash ', assignee: { name: 'u1' } },
    });
    expect(res.status).toBe(201);
    expect(writes).toEqual([
      {
        method: 'POST',
        path: '/api/v3/stories',
        body: { name: 'Crash', story_type: 'bug', group_id: 'g1', workflow_state_id: 12, owner_ids: ['u1'] },
      },
    ]);
  });

  it.each([[{ key: 'NOPE' }], [undefined]])('rejects project %p without writing', async (project) => {
    const res = await call('/rest/api/2/issue', T, 'POST', { fields: { project, issuetype: { id: 'bug' }, summary: 'x' } });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });
});

it('tokenAccess', () => {
  expect(tokenAccess('sct_rw_x')).toBe('read-write');
  expect(tokenAccess('sct_ro_x')).toBe('read-only');
  expect(tokenAccess('3f2c1a9e-0000-4000-8000-000000000000')).toBe('unknown');
});
