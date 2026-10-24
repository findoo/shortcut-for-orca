import { randomBytes } from 'node:crypto';

const BASE = 'https://api.app.shortcut.com';

export interface Member {
  id: string;
  disabled: boolean;
  profile: {
    name: string;
    mention_name: string;
    email_address?: string | null;
    deactivated: boolean;
    display_icon?: { url: string } | null;
  };
}

export interface MemberInfo {
  id: string;
  mention_name: string;
  name: string;
  workspace2: { url_slug: string; default_workflow_id: number };
}

export interface Group {
  id: string;
  name: string;
  mention_name: string;
  archived: boolean;
  workflow_ids: number[];
  default_workflow_id?: number | null;
  member_ids?: string[];
}

export interface WorkflowState {
  id: number;
  name: string;
  type: 'backlog' | 'unstarted' | 'started' | 'done';
  position: number;
}

export interface Workflow {
  id: number;
  name: string;
  states: WorkflowState[];
}

export interface Iteration {
  id: number;
  name: string;
  status: 'unstarted' | 'started' | 'done';
}

export interface CustomField {
  id: string;
  name: string;
  canonical_name?: string;
  enabled?: boolean;
  values: { id: string; value: string; position: number; enabled?: boolean }[];
}

export interface StoryCustomField {
  field_id: string;
  value_id: string;
  value?: string;
}

export interface Comment {
  id: number;
  text: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
}

export interface Story {
  id: number;
  name: string;
  description?: string;
  story_type: 'feature' | 'bug' | 'chore';
  workflow_id: number;
  workflow_state_id: number;
  owner_ids: string[];
  requested_by_id: string;
  labels: { id: number; name: string }[];
  epic_id: number | null;
  iteration_id: number | null;
  group_id: string | null;
  estimate: number | null;
  custom_fields?: StoryCustomField[];
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  deadline?: string | null;
  position?: number;
  blocked?: boolean;
  app_url: string;
  comments?: Comment[];
}

export interface Epic {
  id: number;
  name: string;
}

export class ShortcutError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function sc<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'Shortcut-Token': token },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      // non-JSON error body, keep raw text
    }
    throw new ShortcutError(res.status, `Shortcut: ${message}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

// ponytail: in-memory TTL cache, never evicts beyond expiry; fine for one user's token.
export function cached<T>(token: string, path: string, ttlMs = 60_000): Promise<T> {
  const key = `${token}\n${path}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = sc<T>(token, path);
  value.catch(() => cache.delete(key));
  cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

export interface Image {
  type: string;
  bytes: Buffer;
}

// Shortcut's media URLs (avatars, images in descriptions and comments) need the token, which an <img> in
// Orca can't send. So every one in a response is fetched now, while the token is in hand, and swapped
// for a link to the proxy, which serves the cached copy without asking for the token.
const MEDIA_URL = /https:\/\/media\.app\.shortcut\.com\/[^\s"'()<>\\]+/g;
const MEDIA_LIMIT = 500; // ponytail: oldest-first eviction by count, not bytes; add a byte budget if memory bites
// Ids are random per process, not derived from the URL: whoever knows an id can read the image without a token.
const media = new Map<string, { url: string; image: Promise<Image | null> }>(); // id -> image
const mediaIds = new Map<string, string>(); // Shortcut URL -> id

function fetchMedia(token: string, url: string): Promise<Image | null> {
  return fetch(url, { headers: { 'Shortcut-Token': token } })
    .then(async (r) =>
      r.ok ? { type: r.headers.get('content-type') ?? 'application/octet-stream', bytes: Buffer.from(await r.arrayBuffer()) } : null,
    )
    .catch(() => null);
}

function forget(id: string): void {
  const entry = media.get(id);
  media.delete(id);
  if (entry && mediaIds.get(entry.url) === id) mediaIds.delete(entry.url);
}

/** Rewrites Shortcut media URLs in `text` to `${origin}/media/<id>` and starts fetching them. */
export function localMedia(token: string, text: string, origin: string): string {
  return text.replace(MEDIA_URL, (url) => {
    let id = mediaIds.get(url);
    if (!id) {
      const newId = randomBytes(16).toString('hex');
      const image = fetchMedia(token, url);
      media.set(newId, { url, image });
      mediaIds.set(url, newId);
      void image.then((img) => img || forget(newId)); // failed: fetch again next time it's seen
      if (media.size > MEDIA_LIMIT) forget(media.keys().next().value!);
      id = newId;
    }
    return `${origin}/media/${id}`;
  });
}

export const mediaFile = async (id: string): Promise<Image | null> => (await media.get(id)?.image) ?? null;
