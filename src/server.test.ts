import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lookups, stories } from './fixtures.ts';
import { handle, tokenAccess, type Identity, type RequestEvent } from './server.ts';

const realFetch = global.fetch; // `call` talks to the proxy for real; Shortcut is mocked
const events: RequestEvent[] = [];
const identities: Identity[] = [];
let server: Server;
let base: string;
let forbidWrites = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function shortcut(url: string, method: string): Response {
  const path = new URL(url).pathname;
  if (method === 'POST' && forbidWrites) return json({ message: 'Forbidden' }, 403);
  const found: Record<string, unknown> = {
    '/api/v3/member': { ...lookups.me, name: 'Ada Lovelace' },
    '/api/v3/members': [...lookups.members.values()],
    '/api/v3/groups': lookups.groups,
    '/api/v3/workflows': [],
    '/api/v3/iterations': [...lookups.iterations.values()],
    '/api/v3/custom-fields': lookups.customFields,
    '/api/v3/stories/1': stories[0],
  };
  return path in found ? json(found[path]) : json({ message: 'not found' }, 404);
}

beforeAll(async () => {
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (input, init) => shortcut(String(input), init?.method ?? 'GET'));
  const hooks = { onRequest: (e: RequestEvent) => events.push(e), onIdentity: (i: Identity) => identities.push(i) };
  server = createServer((q, s) => void handle(q, s, hooks));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  jest.restoreAllMocks();
});

const call = (path: string, token?: string, method = 'GET') =>
  realFetch(base + path, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify({ body: 'hi' }),
    redirect: 'manual',
  });

it('emits a 401 event without auth', async () => {
  const res = await call('/rest/api/2/myself');
  expect(res.status).toBe(401);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ method: 'GET', path: '/rest/api/2/myself', status: 401 });
  expect(events[0].error).toMatch(/Shortcut API token/);
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

it('reports redirects as events without identity', async () => {
  const before = identities.length;
  const res = await call('/browse/SC-1');
  expect(res.status).toBe(302);
  expect(events.at(-1)).toMatchObject({ path: '/browse/SC-1', status: 302 });
  expect(identities).toHaveLength(before);
});

it('never leaks the token', () => {
  expect(JSON.stringify([events, identities])).not.toContain('TESTTOKEN');
});

it('tokenAccess', () => {
  expect(tokenAccess('sct_rw_x')).toBe('read-write');
  expect(tokenAccess('sct_ro_x')).toBe('read-only');
  expect(tokenAccess('3f2c1a9e-0000-4000-8000-000000000000')).toBe('unknown');
});
