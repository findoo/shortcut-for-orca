import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ISSUE_TYPES,
  POINTS_FIELD,
  SPRINT_FIELD,
  comment,
  findGroup,
  groupWorkflowIds,
  issue,
  parseKey,
  project,
  status,
  user,
  type Lookups,
} from './jira.ts';
import { JqlError, compileJql } from './jql.ts';
import { MISSING_TOKEN_MESSAGE } from './messages.ts';
import {
  ShortcutError,
  cached,
  localMedia,
  mediaFile,
  sc,
  type Comment,
  type CustomField,
  type Epic,
  type Group,
  type Iteration,
  type Member,
  type MemberInfo,
  type Story,
  type StoryCustomField,
  type Workflow,
} from './shortcut.ts';

export { MISSING_TOKEN_MESSAGE };

let workspaceSlug = process.env.SHORTCUT_WORKSPACE ?? '';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted Jira request JSON, validated per route
type Json = any;

interface Ctx {
  token: () => string;
  hooks: ProxyHooks;
  params: string[];
  url: URL;
  body: Json;
}

function tokenFrom(req: IncomingMessage): string {
  const [scheme = '', value = ''] = (req.headers.authorization ?? '').split(' ');
  if (/^bearer$/i.test(scheme) && value) return value;
  if (/^basic$/i.test(scheme) && value) {
    const decoded = Buffer.from(value, 'base64').toString();
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (password) return password;
  }
  throw new HttpError(401, MISSING_TOKEN_MESSAGE);
}

async function lookups(token: string, stories: Story[] = []): Promise<Lookups> {
  const [me, members, groups, workflows, iterations, fields] = await Promise.all([
    cached<MemberInfo>(token, '/api/v3/member'),
    cached<Member[]>(token, '/api/v3/members'),
    cached<Group[]>(token, '/api/v3/groups'),
    cached<Workflow[]>(token, '/api/v3/workflows'),
    cached<Iteration[]>(token, '/api/v3/iterations'),
    cached<CustomField[]>(token, '/api/v3/custom-fields'),
  ]);
  workspaceSlug ||= me.workspace2.url_slug;
  const epicIds = [...new Set(stories.flatMap((s) => (s.epic_id ? [s.epic_id] : [])))];
  const epics = await Promise.all(
    epicIds.map((id) => cached<Epic>(token, `/api/v3/epics/${id}`, 300_000).catch(() => null)),
  );
  return {
    me,
    members: new Map(members.map((m) => [m.id, m])),
    groups,
    workflows: new Map(workflows.map((w) => [w.id, w])),
    states: new Map(workflows.flatMap((w) => w.states.map((s) => [s.id, s] as const))),
    iterations: new Map(iterations.map((i) => [i.id, i])),
    customFields: fields.filter((f) => f.enabled !== false),
    priority: fields.find((f) => f.canonical_name === 'priority' && f.enabled !== false),
    epicNames: new Map(epics.flatMap((e) => (e ? [[e.id, e.name] as const] : []))),
  };
}

async function getStory(token: string, key: string): Promise<Story> {
  const id = parseKey(key);
  if (id === null) throw new HttpError(404, `Issue does not exist: ${key}`);
  return sc<Story>(token, `/api/v3/stories/${id}`);
}

function withPriority(existing: StoryCustomField[], l: Lookups, valueId: string | null): StoryCustomField[] {
  if (!l.priority) throw new HttpError(400, 'This Shortcut workspace has no Priority field.');
  if (valueId && !l.priority.values.some((v) => v.id === valueId)) throw new HttpError(400, 'Unknown priority.');
  const rest = existing
    .filter((f) => f.field_id !== l.priority!.id)
    .map(({ field_id, value_id }) => ({ field_id, value_id }));
  return valueId ? [...rest, { field_id: l.priority.id, value_id: valueId }] : rest;
}

const idOf = (v: Json): string | null => (typeof v === 'string' ? v : (v?.id ?? v?.name ?? null));

// ponytail: Shortcut search can't sort, so each search reads at most its share of 20 pages (500 stories)
// and stops once it has `max` matches; results are then sorted locally. Narrow the JQL if ordering looks off.
const PAGE_BUDGET = 20;

async function search(token: string, jql: string, max: number) {
  const base = await lookups(token);
  const { searches, compare } = compileJql(jql, base);
  const pagesEach = Math.max(1, Math.floor(PAGE_BUDGET / searches.length));
  const found = new Map<number, Story>();
  for (const { query, test } of searches) {
    let next: string | null = `/api/v3/search/stories?${new URLSearchParams({ query, page_size: '25', detail: 'slim' })}`;
    let matched = 0;
    for (let page = 0; next && page < pagesEach && matched < max; page++) {
      const res: { data: Story[]; next: string | null } = await sc(token, next);
      for (const s of res.data.filter(test)) {
        found.set(s.id, s);
        matched++;
      }
      next = res.next;
    }
  }
  const stories = [...found.values()].sort(compare).slice(0, max);
  const l = await lookups(token, stories);
  return stories.map((s) => issue(s, l));
}

function searchUsers(l: Lookups, url: URL) {
  const q = (url.searchParams.get('username') ?? url.searchParams.get('query') ?? '').trim().toLowerCase();
  const max = Math.min(Number(url.searchParams.get('maxResults') ?? 50) || 50, 1000);
  return [...l.members.values()]
    .filter((m) => !m.disabled && !m.profile.deactivated)
    .filter(
      (m) =>
        !q ||
        q === '.' ||
        [m.profile.name, m.profile.mention_name, m.profile.email_address ?? ''].some((v) =>
          v.toLowerCase().includes(q),
        ),
    )
    .slice(0, max)
    .map((m) => user(m));
}

type Handler = (ctx: Ctx) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  [
    'GET',
    /^\/browse\/([^/]+)$/,
    async ({ params }) => {
      const id = parseKey(params[0]);
      if (id === null || !workspaceSlug) throw new HttpError(404, 'Unknown story.');
      return { redirect: `https://app.shortcut.com/${workspaceSlug}/story/${id}` };
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/myself$/,
    async ({ token }) => {
      const l = await lookups(token());
      return user(l.members.get(l.me.id)) ?? { name: l.me.id, key: l.me.id, displayName: l.me.name };
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/field$/,
    async () => [
      { id: SPRINT_FIELD, name: 'Sprint', schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
      {
        id: POINTS_FIELD,
        name: 'Story Points',
        schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' },
      },
    ],
  ],
  [
    'GET',
    /^\/rest\/api\/2\/project$/,
    async ({ token }) => (await lookups(token())).groups.filter((g) => !g.archived).map(project),
  ],
  [
    'GET',
    /^\/rest\/api\/2\/priority$/,
    async ({ token }) =>
      (await lookups(token())).priority?.values
        .filter((v) => v.enabled !== false)
        .sort((a, b) => a.position - b.position)
        .map((v) => ({ id: v.id, name: v.value })) ?? [],
  ],
  [
    'GET',
    /^\/rest\/api\/2\/filter\/favourite$/,
    // Shortcut has no saved searches, so Orca's "Jira favourites" are presets plus the user's own from the app.
    async ({ token, hooks }) => {
      const l = await lookups(token());
      const teams = l.groups.filter((g) => !g.archived && g.member_ids?.includes(l.me.id));
      const filters: SavedFilter[] = [
        { name: 'My open stories', jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC' },
        { name: 'Requested by me', jql: 'reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC' },
        // Only when there is one: many workspaces don't use iterations, and an always-empty favourite is noise.
        ...([...l.iterations.values()].some((i) => i.status === 'started')
          ? [{ name: 'Current sprint', jql: 'sprint in openSprints() AND statusCategory != Done ORDER BY rank' }]
          : []),
        ...teams.map((g) => ({
          name: `${g.name}: open stories`,
          jql: `project = "${project(g).key}" AND statusCategory != Done ORDER BY updated DESC`,
        })),
        ...(hooks.filters?.() ?? []),
      ];
      return filters.map((f, i) => ({ id: String(i + 1), name: f.name, jql: f.jql, favourite: true }));
    },
  ],
  [
    'POST',
    /^\/rest\/api\/2\/search$/,
    async ({ token, body }) => {
      if (typeof body?.jql !== 'string') throw new HttpError(400, 'jql is required.');
      const max = Math.min(Math.max(1, Number(body.maxResults) || 50), 100);
      const issues = await search(token(), body.jql, max);
      return { startAt: 0, maxResults: max, total: issues.length, issues };
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/issue\/createmeta\/([^/]+)\/issuetypes$/,
    async () => ({ startAt: 0, maxResults: ISSUE_TYPES.length, total: ISSUE_TYPES.length, isLast: true, values: ISSUE_TYPES }),
  ],
  [
    'GET',
    /^\/rest\/api\/2\/issue\/createmeta\/([^/]+)\/issuetypes\/([^/]+)$/,
    async ({ token }) => {
      const l = await lookups(token());
      const values: object[] = [
        { fieldId: 'assignee', key: 'assignee', name: 'Assignee', required: false, schema: { type: 'user', system: 'assignee' } },
      ];
      if (l.priority) {
        values.push({
          fieldId: 'priority',
          key: 'priority',
          name: 'Priority',
          required: false,
          schema: { type: 'priority', system: 'priority' },
          allowedValues: l.priority.values.map((v) => ({ id: v.id, name: v.value })),
        });
      }
      return { startAt: 0, maxResults: values.length, total: values.length, isLast: true, values };
    },
  ],
  [
    'POST',
    /^\/rest\/api\/2\/issue$/,
    async ({ token, body }) => {
      const t = token();
      const f = body?.fields ?? {};
      const unknown = Object.keys(f).filter(
        (k) => !['project', 'issuetype', 'summary', 'description', 'assignee', 'priority'].includes(k),
      );
      if (unknown.length) throw new HttpError(400, `Unsupported fields: ${unknown.join(', ')}`);
      const type = idOf(f.issuetype);
      if (!ISSUE_TYPES.some((x) => x.id === type)) throw new HttpError(400, 'Issue type must be feature, bug or chore.');
      if (typeof f.summary !== 'string' || !f.summary.trim()) throw new HttpError(400, 'Summary is required.');
      const l = await lookups(t);
      const g = findGroup(l.groups, idOf(f.project) ?? '');
      const workflow = l.workflows.get((g && groupWorkflowIds(g)[0]) || l.me.workspace2.default_workflow_id);
      const states = [...(workflow?.states ?? [])].sort((a, b) => a.position - b.position);
      const state = states.find((s) => s.type === 'unstarted') ?? states[0];
      if (!state) throw new HttpError(400, 'Could not find a workflow state for this team.');
      const assignee = idOf(f.assignee);
      const priority = idOf(f.priority);
      const created = await sc<Story>(t, '/api/v3/stories', {
        method: 'POST',
        body: {
          name: f.summary.trim(),
          description: typeof f.description === 'string' ? f.description : undefined,
          story_type: type,
          group_id: g?.id,
          workflow_state_id: state.id,
          owner_ids: assignee ? [assignee] : undefined,
          custom_fields: priority ? withPriority([], l, priority) : undefined,
        },
      });
      return { status: 201, body: { id: String(created.id), key: `SC-${created.id}`, self: created.app_url } };
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/issue\/([^/]+)$/,
    async ({ token, params }) => {
      const s = await getStory(token(), params[0]);
      return issue(s, await lookups(token(), [s]));
    },
  ],
  [
    'PUT',
    /^\/rest\/api\/2\/issue\/([^/]+)$/,
    async ({ token, params, body }) => {
      const t = token();
      const fields = body?.fields ?? {};
      const unknown = Object.keys(fields).filter((k) => !['summary', 'labels', 'priority'].includes(k));
      const unknownOps = Object.keys(body?.update ?? {}).filter((k) => k !== 'labels');
      if (unknown.length || unknownOps.length)
        throw new HttpError(400, `Unsupported fields: ${[...unknown, ...unknownOps].join(', ')}`);
      const s = await getStory(t, params[0]);
      const patch: Record<string, unknown> = {};
      if ('summary' in fields) patch.name = fields.summary;
      let labels: string[] | undefined = Array.isArray(fields.labels) ? fields.labels : undefined;
      if (Array.isArray(body?.update?.labels)) {
        labels ??= s.labels.map((x) => x.name);
        for (const op of body.update.labels) {
          if (typeof op?.add === 'string') labels.push(op.add);
          if (typeof op?.remove === 'string') labels = labels.filter((x) => x !== op.remove);
        }
      }
      if (labels) patch.labels = [...new Set(labels)].map((name) => ({ name }));
      if ('priority' in fields) patch.custom_fields = withPriority(s.custom_fields ?? [], await lookups(t), idOf(fields.priority));
      if (Object.keys(patch).length) await sc(t, `/api/v3/stories/${s.id}`, { method: 'PUT', body: patch });
      return null;
    },
  ],
  [
    'PUT',
    /^\/rest\/api\/2\/issue\/([^/]+)\/assignee$/,
    async ({ token, params, body }) => {
      const s = await getStory(token(), params[0]);
      const owner = idOf(body);
      await sc(token(), `/api/v3/stories/${s.id}`, { method: 'PUT', body: { owner_ids: owner ? [owner] : [] } });
      return null;
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/,
    async ({ token, params }) => {
      const s = await getStory(token(), params[0]);
      const l = await lookups(token());
      const comments = (s.comments ?? []).filter((c) => !c.deleted).map((c) => comment(c, l));
      return { startAt: 0, maxResults: comments.length, total: comments.length, isLast: true, comments };
    },
  ],
  [
    'POST',
    /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/,
    async ({ token, params, body }) => {
      if (typeof body?.body !== 'string' || !body.body.trim()) throw new HttpError(400, 'Comment body is required.');
      const s = await getStory(token(), params[0]);
      const c = await sc<Comment>(token(), `/api/v3/stories/${s.id}/comments`, {
        method: 'POST',
        body: { text: body.body },
      });
      return { status: 201, body: comment(c, await lookups(token())) };
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/issue\/([^/]+)\/transitions$/,
    async ({ token, params }) => {
      const s = await getStory(token(), params[0]);
      const l = await lookups(token());
      const states = [...(l.workflows.get(s.workflow_id)?.states ?? [])].sort((a, b) => a.position - b.position);
      const transitions = states
        .filter((x) => x.id !== s.workflow_state_id)
        .map((x) => ({ id: String(x.id), name: x.name, to: status(x) }));
      return { transitions };
    },
  ],
  [
    'POST',
    /^\/rest\/api\/2\/issue\/([^/]+)\/transitions$/,
    async ({ token, params, body }) => {
      const t = token();
      const s = await getStory(t, params[0]);
      const target = Number(body?.transition?.id);
      const l = await lookups(t);
      if (!l.workflows.get(s.workflow_id)?.states.some((x) => x.id === target))
        throw new HttpError(400, 'Transition is not valid for this story.');
      await sc(t, `/api/v3/stories/${s.id}`, { method: 'PUT', body: { workflow_state_id: target } });
      const text = body?.update?.comment?.[0]?.add?.body;
      if (typeof text === 'string' && text.trim())
        await sc(t, `/api/v3/stories/${s.id}/comments`, { method: 'POST', body: { text } });
      return null;
    },
  ],
  [
    'GET',
    /^\/rest\/api\/2\/user\/(?:assignable\/)?search$/,
    async ({ token, url }) => searchUsers(await lookups(token()), url),
  ],
  [
    'GET',
    /^\/rest\/agile\/1\.0\/board$/,
    async ({ token, url }) => {
      const g = findGroup((await lookups(token())).groups, url.searchParams.get('projectKeyOrId') ?? '');
      const values = g ? [{ id: g.id, name: g.name, type: 'kanban' }] : [];
      return { startAt: 0, maxResults: 2, total: values.length, isLast: true, values };
    },
  ],
  [
    'GET',
    /^\/rest\/agile\/1\.0\/board\/([^/]+)\/configuration$/,
    async ({ token, params }) => {
      const l = await lookups(token());
      const g = findGroup(l.groups, params[0]);
      if (!g) throw new HttpError(404, 'Board does not exist.');
      const columns = groupWorkflowIds(g).flatMap((id) =>
        [...(l.workflows.get(id)?.states ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ name: s.name, statuses: [{ id: String(s.id) }] })),
      );
      return { id: g.id, name: g.name, columnConfig: { columns } };
    },
  ],
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

export interface RequestEvent {
  at: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  error?: string;
}
export type TokenAccess = 'read-write' | 'read-only' | 'unknown';
export interface Identity {
  name: string;
  mention: string;
  workspace: string;
  access: TokenAccess;
}
export interface SavedFilter {
  name: string;
  jql: string;
}
export interface ProxyHooks {
  onRequest?(e: RequestEvent): void;
  onIdentity?(i: Identity): void;
  /** The user's own saved filters, listed after the presets in Orca's "Jira favourites". */
  filters?(): SavedFilter[];
}

export function tokenAccess(token: string): TokenAccess {
  return token.startsWith('sct_rw_') ? 'read-write' : token.startsWith('sct_ro_') ? 'read-only' : 'unknown';
}

const lastIdentity = new WeakMap<ProxyHooks, string>();
// Tokens Shortcut refused a write for. Keyed by hash so the token itself is never kept.
const readOnlyTokens = new Set<string>();
const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

async function emitIdentity(hooks: ProxyHooks, token: string, access: TokenAccess) {
  if (!hooks.onIdentity) return;
  if (readOnlyTokens.has(tokenId(token))) access = 'read-only';
  try {
    const l = await lookups(token);
    const identity: Identity = {
      name: l.members.get(l.me.id)?.profile.name ?? l.me.name,
      mention: l.me.mention_name,
      workspace: l.me.workspace2.url_slug,
      access,
    };
    const key = JSON.stringify(identity);
    if (lastIdentity.get(hooks) === key) return;
    lastIdentity.set(hooks, key);
    hooks.onIdentity(identity);
  } catch {
    // identity is best-effort; never fail the Jira response over it
  }
}

interface Reply {
  status: number;
  body?: unknown;
  location?: string;
}

export async function handle(req: IncomingMessage, res: ServerResponse, hooks: ProxyHooks = {}) {
  const start = performance.now();
  const at = Date.now();
  const method = req.method ?? 'GET';
  let path = req.url ?? '/';
  let origin = '';
  let token: string | undefined;
  let shortcutForbidden = false;
  let reply: Reply;
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    path = url.pathname;
    // Blocks DNS-rebinding: a web page can't reach this proxy under a hostname it controls.
    if (!LOCAL_HOSTS.has(url.hostname)) throw new HttpError(403, 'Forbidden host.');
    const trimmed = path.replace(/\/+$/, '');
    origin = url.origin;
    // Images for Orca's <img> tags (see localMedia): no token, and kept out of the request log.
    if (method === 'GET' && trimmed.startsWith('/media/')) {
      const img = await mediaFile(trimmed.slice('/media/'.length));
      if (img) res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'max-age=3600' }).end(img.bytes);
      else res.writeHead(404).end();
      return;
    }
    reply = await (async (): Promise<Reply> => {
      for (const [m, pattern, handler] of routes) {
        const match = m === method ? pattern.exec(trimmed) : null;
        if (!match) continue;
        const body = method === 'GET' ? undefined : await readJson(req);
        const result = (await handler({
          token: () => (token = tokenFrom(req)),
          hooks,
          params: match.slice(1).map(decodeURIComponent),
          url,
          body,
        })) as Json;
        if (result?.redirect) return { status: 302, location: result.redirect };
        if (result?.status && result.body) return { status: result.status, body: result.body };
        return result === null || result === undefined ? { status: 204 } : { status: 200, body: result };
      }
      throw new HttpError(404, `Not supported by the Shortcut proxy: ${method} ${trimmed}`);
    })();
  } catch (e) {
    const status = e instanceof HttpError || e instanceof ShortcutError ? e.status : e instanceof JqlError ? 400 : 500;
    if (status === 500) console.error(e);
    shortcutForbidden = e instanceof ShortcutError && status === 403 && method !== 'GET';
    reply = { status, body: { errorMessages: [e instanceof Error ? e.message : String(e)], errors: {} } };
  }
  // Resolved before replying so identity is visible by the time the client has its response.
  if (token && reply.status < 400) await emitIdentity(hooks, token, tokenAccess(token));
  else if (token && shortcutForbidden) {
    readOnlyTokens.add(tokenId(token));
    await emitIdentity(hooks, token, 'read-only');
  }
  const t = token;
  respond(res, reply, t ? (json) => localMedia(t, json, origin) : undefined);
  const error = reply.status >= 400 ? (reply.body as { errorMessages?: string[] }).errorMessages?.[0] : undefined;
  hooks.onRequest?.({ at, method, path, status: reply.status, ms: Math.round(performance.now() - start), ...(error && { error }) });
}

function respond(res: ServerResponse, { status, body, location }: Reply, rewrite = (json: string) => json) {
  if (location) res.writeHead(status, { Location: location }).end();
  else if (body === null || body === undefined) res.writeHead(204).end();
  else res.writeHead(status, { 'Content-Type': 'application/json' }).end(rewrite(JSON.stringify(body)));
}
