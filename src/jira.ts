import type {
  Comment,
  CustomField,
  Group,
  Iteration,
  Member,
  MemberInfo,
  Story,
  Workflow,
  WorkflowState,
} from './shortcut.ts';

// Orca discovers these by their Jira Software schema.custom ids (see /field).
export const SPRINT_FIELD = 'customfield_10020';
export const POINTS_FIELD = 'customfield_10016';

export interface Lookups {
  me: MemberInfo;
  members: Map<string, Member>;
  groups: Group[];
  workflows: Map<number, Workflow>;
  states: Map<number, WorkflowState>;
  iterations: Map<number, Iteration>;
  customFields: CustomField[];
  priority?: CustomField;
  epicNames: Map<number, string>;
  /** Origin the proxy serves /avatar/<member id> from; no avatars without it. */
  avatarBase?: string;
}

export const toKey = (id: number) => `SC-${id}`;

export function parseKey(key: string): number | null {
  const m = /^(?:sc-)?(\d+)$/i.exec(key.trim());
  return m ? Number(m[1]) : null;
}

export function findGroup(groups: Group[], idOrKey: string): Group | undefined {
  const k = idOrKey.toLowerCase();
  return groups.find((g) => g.id === idOrKey || g.mention_name.toLowerCase() === k);
}

export function groupWorkflowIds(g: Group): number[] {
  return g.workflow_ids?.length ? g.workflow_ids : g.default_workflow_id ? [g.default_workflow_id] : [];
}

export function project(g: Group | undefined) {
  return g
    ? { id: g.id, key: g.mention_name.toUpperCase(), name: g.name }
    : { id: 'none', key: 'SC', name: 'No team' };
}

export function user(m: Member | undefined, l: Pick<Lookups, 'avatarBase'>, fallbackId?: string | null) {
  if (!m) return fallbackId ? { name: fallbackId, key: fallbackId, displayName: 'Unknown' } : null;
  const avatar = l.avatarBase && m.profile.display_icon ? `${l.avatarBase}/avatar/${encodeURIComponent(m.id)}` : undefined;
  return {
    name: m.id,
    key: m.id,
    displayName: m.profile.name,
    emailAddress: m.profile.email_address ?? undefined,
    active: !m.disabled && !m.profile.deactivated,
    ...(avatar ? { avatarUrls: { '48x48': avatar } } : {}),
  };
}

export function status(s: WorkflowState | undefined) {
  if (!s) return { id: '0', name: 'Unknown', statusCategory: { key: 'undefined', name: 'No Category' } };
  const statusCategory =
    s.type === 'done'
      ? { key: 'done', name: 'Done', colorName: 'green' }
      : s.type === 'started'
        ? { key: 'indeterminate', name: 'In Progress', colorName: 'yellow' }
        : { key: 'new', name: 'To Do', colorName: 'blue-gray' };
  return { id: String(s.id), name: s.name, statusCategory };
}

const typeName = (t: string) => t[0].toUpperCase() + t.slice(1);
export const ISSUE_TYPES = (['feature', 'bug', 'chore'] as const).map((id) => ({
  id,
  name: typeName(id),
  subtask: false,
}));

const SPRINT_STATE = { unstarted: 'future', started: 'active', done: 'closed' } as const;

export function issue(s: Story, l: Lookups) {
  const pri = l.priority && s.custom_fields?.find((f) => f.field_id === l.priority!.id);
  const priName = pri && l.priority!.values.find((v) => v.id === pri.value_id)?.value;
  const iter = s.iteration_id ? l.iterations.get(s.iteration_id) : undefined;
  const epicName = s.epic_id ? l.epicNames.get(s.epic_id) : undefined;
  return {
    id: String(s.id),
    key: toKey(s.id),
    fields: {
      summary: s.name,
      description: s.description ?? '',
      project: project(l.groups.find((g) => g.id === s.group_id)),
      issuetype: { id: s.story_type, name: typeName(s.story_type), subtask: false },
      status: status(l.states.get(s.workflow_state_id)),
      assignee: s.owner_ids[0] ? user(l.members.get(s.owner_ids[0]), l, s.owner_ids[0]) : null,
      reporter: user(l.members.get(s.requested_by_id), l, s.requested_by_id),
      priority: pri ? { id: pri.value_id, name: priName ?? pri.value ?? 'Priority' } : null,
      labels: s.labels.map((x) => x.name),
      created: s.created_at,
      updated: s.updated_at,
      parent:
        s.epic_id && epicName
          ? { key: `EPIC-${s.epic_id}`, fields: { summary: epicName, issuetype: { name: 'Epic' } } }
          : undefined,
      [SPRINT_FIELD]: iter ? [{ name: iter.name, state: SPRINT_STATE[iter.status] }] : null,
      [POINTS_FIELD]: s.estimate,
      attachment: [],
    },
  };
}

export function comment(c: Comment, l: Lookups) {
  const author = c.author_id ? user(l.members.get(c.author_id), l, c.author_id) : null;
  return { id: String(c.id), body: c.text ?? '', created: c.created_at, updated: c.updated_at, author };
}
