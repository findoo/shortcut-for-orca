// Set before any Date is made: whole-day matches must follow local midnights, which aren't always 24h apart.
process.env.TZ = 'Europe/London';

import { lookups, stories } from './fixtures.ts';
import { compileJql } from './jql.ts';

const at = (created_at: string) => ({ ...stories[0], created_at });
const matches = (jql: string, created_at: string) =>
  compileJql(jql, lookups, new Date(2026, 9, 23)).searches.some((s) => s.test(at(created_at)));

it('includes the extra hour of the day clocks go back', () => {
  expect(matches('created = 2026-10-25', '2026-10-25T23:30:00Z')).toBe(true); // 23:30 GMT on the 25th
});

it('excludes the next day after clocks go forward', () => {
  expect(matches('created = 2026-03-29', '2026-03-29T22:30:00Z')).toBe(true); // 23:30 BST on the 29th
  expect(matches('created = 2026-03-29', '2026-03-29T23:30:00Z')).toBe(false); // 00:30 BST on the 30th
});
