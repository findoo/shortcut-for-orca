import type { Lookups } from './jira.ts';
import type { Member, Story } from './shortcut.ts';

const member = (id: string, name: string, mention: string, email: string, icon?: string): Member => ({
  id,
  disabled: false,
  profile: { name, mention_name: mention, email_address: email, deactivated: false, display_icon: icon ? { url: icon } : null },
});

export const ADA_ICON = 'https://media.app.shortcut.com/api/attachments/user-icons/ada.png';

const priority = {
  id: 'pf',
  name: 'Priority',
  canonical_name: 'priority',
  values: [
    { id: 'p1', value: 'P1 - Critical', position: 0 },
    { id: 'p2', value: 'P2 - High', position: 1 },
    { id: 'p3', value: 'P3 - Medium', position: 2 },
  ],
};

export const lookups: Lookups = {
  me: { id: 'u1', mention_name: 'ada', name: 'Ada', workspace2: { url_slug: 'acme', default_workflow_id: 1 } },
  members: new Map([
    ['u1', member('u1', 'Ada Lovelace', 'ada', 'ada@example.com', ADA_ICON)],
    ['u2', member('u2', 'Grace Hopper', 'grace', 'grace@example.com')],
  ]),
  groups: [
    { id: 'g1', name: 'WEB', mention_name: 'web', archived: false, workflow_ids: [1], member_ids: ['u1'] },
    { id: 'g2', name: 'MOBILE', mention_name: 'mobile', archived: false, workflow_ids: [1], member_ids: ['u2'] },
  ],
  workflows: new Map(),
  states: new Map([
    [1, { id: 1, name: 'Backlog', type: 'backlog', position: 0 }],
    [12, { id: 12, name: 'Ready for Dev', type: 'unstarted', position: 1 }],
    [10, { id: 10, name: 'In Dev', type: 'started', position: 2 }],
    [11, { id: 11, name: 'Done', type: 'done', position: 3 }],
  ]),
  iterations: new Map([
    [5, { id: 5, name: 'Sprint 42', status: 'started' }],
    [6, { id: 6, name: 'Sprint 41', status: 'done' }],
  ]),
  customFields: [
    priority,
    {
      id: 'ta',
      name: 'Technical Area',
      canonical_name: 'technical-area',
      values: [
        { id: 'web', value: 'Web', position: 0 },
        { id: 'ios', value: 'iOS', position: 1 },
      ],
    },
    { id: 'tier', name: 'Customer Tier', values: [{ id: 'gold', value: 'Gold', position: 0 }] },
  ],
  priority,
  epicNames: new Map([[7, 'Big epic']]),
};

const base: Story = {
  id: 0,
  name: '',
  story_type: 'feature',
  workflow_id: 1,
  workflow_state_id: 1,
  owner_ids: [],
  requested_by_id: 'u1',
  labels: [],
  epic_id: null,
  iteration_id: null,
  group_id: 'g1',
  estimate: null,
  custom_fields: [],
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  app_url: '',
};

export const stories: Story[] = [
  {
    ...base,
    id: 1,
    name: 'Fix avatar crash',
    description: '**md**',
    story_type: 'bug',
    workflow_state_id: 10,
    owner_ids: ['u1'],
    labels: [{ id: 1, name: 'web' }],
    epic_id: 7,
    iteration_id: 5,
    estimate: 3,
    custom_fields: [
      { field_id: 'pf', value_id: 'p1', value: 'P1 - Critical' },
      { field_id: 'tier', value_id: 'gold', value: 'Gold' },
    ],
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
    position: 300,
    blocked: true,
  },
  {
    ...base,
    id: 2,
    name: 'Group picker',
    workflow_state_id: 11,
    owner_ids: ['u2'],
    requested_by_id: 'u2',
    group_id: 'g2',
    iteration_id: 6,
    custom_fields: [{ field_id: 'pf', value_id: 'p3', value: 'P3 - Medium' }],
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
    completed_at: '2026-10-10T10:00:00Z',
    deadline: '2026-11-01T12:00:00Z',
    position: 100,
  },
  {
    ...base,
    id: 3,
    name: 'Login page polish',
    story_type: 'chore',
    labels: [{ id: 2, name: 'iOS' }],
    estimate: 5,
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
    position: 200,
  },
];
