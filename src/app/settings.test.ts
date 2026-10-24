import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, validatePort } from './settings.ts';

const file = () => join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json');

describe('validatePort', () => {
  it('accepts valid ports', () => expect(validatePort('8089')).toBe(8089));
  it.each([80, 70000, 'abc', 8089.5])('rejects %p', (v) => {
    expect(validatePort(v)).toMatch(/1024 and 65535/);
  });
});

describe('settings file', () => {
  it('defaults on missing file', () => expect(loadSettings(file())).toEqual({ port: 8089 }));
  it('defaults on corrupt json', () => {
    const f = file();
    writeFileSync(f, '{not json');
    expect(loadSettings(f)).toEqual({ port: 8089 });
  });
  it('defaults on invalid port', () => {
    const f = file();
    writeFileSync(f, '{"port": 5}');
    expect(loadSettings(f)).toEqual({ port: 8089 });
  });
  it('round-trips', () => {
    const f = file();
    saveSettings(f, { port: 9000 });
    expect(loadSettings(f)).toEqual({ port: 9000 });
  });
});
