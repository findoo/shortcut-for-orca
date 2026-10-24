import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, validateFilters, validatePort } from './settings.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json');

describe('validatePort', () => {
  it('accepts valid ports', () => expect(validatePort('8089')).toBe(8089));
  it.each([80, 70000, 'abc', 8089.5])('rejects %p', (v) => {
    expect(validatePort(v)).toMatch(/1024 and 65535/);
  });
});

describe('settings file', () => {
  it('defaults on missing file', () => expect(loadSettings(file())).toEqual({ port: 8089, filters: [] }));
  it('defaults on corrupt json', () => {
    const f = file();
    writeFileSync(f, '{not json');
    expect(loadSettings(f)).toEqual({ port: 8089, filters: [] });
  });
  it('defaults on invalid port', () => {
    const f = file();
    writeFileSync(f, '{"port": 5}');
    expect(loadSettings(f)).toEqual({ port: 8089, filters: [] });
  });
  it('round-trips', () => {
    const f = file();
    const s = { port: 9000, filters: [{ name: 'Mine', jql: 'assignee = currentUser()' }] };
    saveSettings(f, s);
    expect(loadSettings(f)).toEqual(s);
  });
  it('keeps the port when the filters are invalid', () => {
    const f = file();
    writeFileSync(f, '{"port": 9000, "filters": "nope"}');
    expect(loadSettings(f)).toEqual({ port: 9000, filters: [] });
  });
});

describe('validateFilters', () => {
  it('trims names and queries', () => {
    expect(validateFilters([{ name: ' Mine ', jql: ' type = bug ' }])).toEqual([{ name: 'Mine', jql: 'type = bug' }]);
  });
  it.each([[[{ name: '', jql: 'type = bug' }]], [[{ name: 'x' }]], ['nope']])('rejects %p', (v) => {
    expect(typeof validateFilters(v)).toBe('string');
  });
});
