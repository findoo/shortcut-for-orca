import { lookups, stories } from './fixtures.ts';
import { POINTS_FIELD, SPRINT_FIELD, issue, parseKey, user } from './jira.ts';

describe('issue', () => {
  it('maps a story to the Jira fields Orca reads', () => {
    const { key, fields } = issue(stories[0], lookups);
    expect(key).toBe('SC-1');
    expect(fields).toMatchObject({
      summary: 'Fix avatar crash',
      description: '**md**',
      project: { id: 'g1', key: 'WEB' },
      issuetype: { id: 'bug', name: 'Bug' },
      status: { id: '10', name: 'In Dev', statusCategory: { key: 'indeterminate' } },
      assignee: { name: 'u1', displayName: 'Ada Lovelace' },
      priority: { id: 'p1', name: 'P1 - Critical' },
      labels: ['web'],
      parent: { fields: { summary: 'Big epic' } },
      [SPRINT_FIELD]: [{ name: 'Sprint 42', state: 'active' }],
      [POINTS_FIELD]: 3,
    });
  });

  it('points avatars at the proxy, never at Shortcut', () => {
    const base = { avatarBase: 'http://127.0.0.1:8089' };
    expect(user(lookups.members.get('u1'), base)).toHaveProperty('avatarUrls', { '48x48': 'http://127.0.0.1:8089/avatar/u1' });
    expect(user(lookups.members.get('u2'), base)).not.toHaveProperty('avatarUrls'); // no photo in Shortcut
    expect(user(lookups.members.get('u1'), {})).not.toHaveProperty('avatarUrls');
  });

  it('parses story keys', () => {
    expect(parseKey('SC-9')).toBe(9);
    expect(parseKey('9')).toBe(9);
    expect(parseKey('JIRA-9')).toBeNull();
  });
});
