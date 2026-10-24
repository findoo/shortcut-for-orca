import { lookups, stories } from './fixtures.ts';
import { JqlError, compileJql } from './jql.ts';

const NOW = new Date(2026, 9, 23, 12, 0); // Fri 23 Oct 2026, local time

const compile = (jql: string) => compileJql(jql, lookups, NOW);
const queries = (jql: string) => compile(jql).searches.map((s) => s.query);

/** Story ids the proxy would return, assuming Shortcut returns a superset of each search. */
function ids(jql: string): number[] {
  const { searches, compare } = compile(jql);
  const found = new Set(stories.filter((s) => searches.some((x) => x.test(s))));
  return [...found].sort(compare).map((s) => s.id);
}

describe('Orca built-in queries', () => {
  it('push filters down to one Shortcut search and match exactly', () => {
    const jql =
      'assignee = currentUser() AND statusCategory != Done AND status in ("In Dev", "Ready for Dev") AND sprint in openSprints() ORDER BY updated DESC';
    expect(ids(jql)).toEqual([1]);
    expect(queries(jql)).toEqual([
      'owner:ada !is:done state:"In Dev" has:iteration !is:archived',
      'owner:ada !is:done state:"Ready for Dev" has:iteration !is:archived',
    ]);
    expect(queries('reporter = currentUser() AND statusCategory = Done')).toEqual(['requester:ada is:done !is:archived']);
    expect(queries('key = "SC-42"')).toEqual(['id:42 !is:archived']);
    expect(queries('text ~ "login page*"')).toEqual(['login page !is:archived']);
  });
});

describe('boolean logic', () => {
  it('splits OR into separate searches and unions the results', () => {
    expect(queries('project = WEB OR project = MOBILE')).toEqual([
      'team:web !is:archived',
      'team:mobile !is:archived',
    ]);
    expect(ids('type = bug OR type = chore ORDER BY key')).toEqual([1, 3]);
    expect(ids('type = bug || (type = feature && assignee = grace)')).toEqual([1, 2]);
  });

  it('distributes AND over OR', () => {
    expect(queries('(type = bug OR type = chore) AND (labels = web OR labels = iOS)')).toHaveLength(4);
    expect(ids('(type = bug OR type = chore) AND (labels = web OR labels = iOS) ORDER BY key')).toEqual([1, 3]);
  });

  it('handles NOT, including pushing negations down', () => {
    expect(ids('NOT type = bug ORDER BY key')).toEqual([2, 3]);
    expect(queries('NOT (type = bug OR project = mobile)')).toEqual(['!type:bug !team:mobile !is:archived']);
    expect(ids('! (type = bug OR project = mobile)')).toEqual([3]);
  });

  it('collapses long IN lists into one search instead of many', () => {
    const jql = 'key in (SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-8, SC-9) ORDER BY key';
    expect(queries(jql)).toEqual(['!is:archived']);
    expect(ids(jql)).toEqual([1, 2, 3]);
  });
});

describe('fields', () => {
  it.each([
    ['assignee != ada', [2]], // != never matches empty fields (Jira semantics)
    ['assignee is EMPTY', [3]],
    ['assignee in membersOf("mobile")', [2]],
    ['assignee = "grace@example.com"', [2]],
    ['project not in (MOBILE)', [1, 3]],
    ['status = done', [2]],
    ['statusCategory = "To Do"', [3]],
    ['statusCategory = "In Progress"', [1]],
    ['resolution = Unresolved', [1, 3]],
    ['resolution is not EMPTY', [2]],
    ['issuetype in (Story)', [2]],
    ['issuetype in (Bug, Task)', [1, 3]],
    ['labels = ios', [3]],
    ['labels is EMPTY', [2]],
    ['sprint in openSprints()', [1]],
    ['sprint in closedSprints()', [2]],
    ['sprint = "Sprint 41"', [2]],
    ['sprint is EMPTY', [3]],
    ['parent = EPIC-7', [1]],
    ['"Epic Link" is EMPTY', [2, 3]],
    ['"Story Points" > 2', [1, 3]],
    ['cf[10016] is EMPTY', [2]],
    ['estimate = 5', [3]],
    ['priority = P1', [1]],
    ['priority >= P2', [1]],
    ['priority in (P1, "P3 - Medium")', [1, 2]],
    ['priority is EMPTY', [3]],
    ['priority != P1', [2]],
    ['"Customer Tier" = Gold', [1]],
    ['"Technical Area" is EMPTY', [1, 2, 3]],
    ['flagged is not EMPTY', [1]],
    ['key > SC-1', [2, 3]],
    ['summary ~ "login"', [3]],
    ['summary !~ login', [1, 2]],
  ])('%s', (jql, expected) => {
    expect(ids(`${jql} ORDER BY key`)).toEqual(expected);
  });

  it('pushes custom fields Shortcut can search, filters the rest in memory', () => {
    expect(queries('priority = P1')).toEqual(['priority:"P1 - Critical" !is:archived']);
    expect(queries('"Technical Area" = web')).toEqual(['technical-area:"Web" !is:archived']);
    expect(queries('"Customer Tier" = Gold')).toEqual(['!is:archived']);
  });
});

describe('dates', () => {
  it.each([
    ['created >= -7d', [3]],
    ['created >= 2026-10-01', [1, 3]],
    ['created < "2026/10/01"', [2]],
    ['created = 2026-10-22', [3]],
    ['created >= startOfWeek()', [3]],
    ['created > startOfMonth(-1)', [1, 2, 3]],
    ['resolved >= startOfMonth()', [2]],
    ['resolved is EMPTY', [1, 3]],
    ['due <= endOfMonth(+1)', [2]],
    ['due is EMPTY', [1, 3]],
    ['updated <= "2026-10-15 00:00"', [2]],
  ])('%s', (jql, expected) => {
    expect(ids(`${jql} ORDER BY key`)).toEqual(expected);
  });

  it('pushes a widened date range', () => {
    expect(queries('created >= -7d')[0]).toMatch(/^created:\d{4}-\d{2}-\d{2}\.\.\* !is:archived$/);
    expect(queries('due < 2026-11-01')[0]).toMatch(/^due:\*\.\.\d{4}-\d{2}-\d{2} !is:archived$/);
  });
});

describe('ORDER BY', () => {
  it.each([
    ['ORDER BY key DESC', [3, 2, 1]],
    ['ORDER BY created ASC', [2, 1, 3]],
    ['ORDER BY priority DESC', [1, 2, 3]], // empty last
    ['ORDER BY rank', [2, 3, 1]],
    ['ORDER BY status, key DESC', [3, 1, 2]],
    ['', [3, 1, 2]], // default: updated DESC
  ])('%s', (jql, expected) => {
    expect(ids(jql)).toEqual(expected);
  });
});

describe('errors', () => {
  it.each([
    ['assignee was ada', /History searches/],
    ['summary ~ "unterminated', /Unterminated string/],
    ['resolution = ', /Unexpected end/],
    ['type = bug bug', /Unexpected "bug"/],
    ['watcher = ada', /Unsupported field "watcher"/],
    ['status = "Nope"', /Unknown status/],
    ['assignee = nobody', /Unknown user/],
    ['priority = P9', /not a Priority value/],
    ['created > yesterday', /Unrecognised date/],
    ['labels > 3', /Operator ">" is not supported for labels/],
    ['NOT text ~ login', /can't search for NOT/],
    ['ORDER BY watchers', /Cannot ORDER BY/],
  ])('%s', (jql, message) => {
    expect(() => compile(jql)).toThrow(JqlError);
    expect(() => compile(jql)).toThrow(message);
  });
});
