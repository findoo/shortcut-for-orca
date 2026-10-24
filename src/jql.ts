import { findGroup, parseKey, type Lookups } from './jira.ts';
import type { CustomField, Member, Story } from './shortcut.ts';

export class JqlError extends Error {}

// ---------------------------------------------------------------------------
// Tokenizer + parser: JQL text -> AST
// ---------------------------------------------------------------------------

type Tok = { t: 'word' | 'str' | 'op' | 'punct'; v: string };

type Value =
  | { kind: 'lit'; text: string }
  | { kind: 'fn'; name: string; args: string[] }
  | { kind: 'list'; items: Value[] }
  | { kind: 'empty' };

type Op = '=' | '!=' | '~' | '!~' | '>' | '>=' | '<' | '<=' | 'in' | 'not in' | 'is' | 'is not';

type Node =
  | { kind: 'and' | 'or'; items: Node[] }
  | { kind: 'not'; item: Node }
  | { kind: 'clause'; field: string; op: Op; value: Value };

interface Sort {
  field: string;
  desc: boolean;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '"' || c === "'") {
      let v = '';
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        v += src[j];
      }
      if (j >= src.length) throw new JqlError(`Unterminated string starting at position ${i}.`);
      out.push({ t: 'str', v });
      i = j + 1;
    } else if ('(),'.includes(c)) {
      out.push({ t: 'punct', v: c });
      i++;
    } else {
      const op = /^(!=|!~|>=|<=|&&|\|\||=|~|>|<|&|\||!)/.exec(src.slice(i))?.[0];
      if (op) {
        const alias = { '&&': 'AND', '&': 'AND', '||': 'OR', '|': 'OR', '!': 'NOT' }[op];
        out.push(alias ? { t: 'word', v: alias } : { t: 'op', v: op });
        i += op.length;
      } else {
        const word = /^[^\s()=!~<>,"'&|]+/.exec(src.slice(i))![0];
        out.push({ t: 'word', v: word });
        i += word.length;
      }
    }
  }
  return out;
}

class Parser {
  private i = 0;
  private readonly toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new JqlError('Unexpected end of query.');
    return t;
  }
  private isKw(kw: string, t = this.peek()): boolean {
    return t?.t === 'word' && t.v.toUpperCase() === kw;
  }
  private isPunct(p: string): boolean {
    const t = this.peek();
    return t?.t === 'punct' && t.v === p;
  }
  private expectPunct(p: string) {
    const t = this.next();
    if (t.t !== 'punct' || t.v !== p) throw new JqlError(`Expected "${p}" but found "${t.v}".`);
  }

  parse(): { where?: Node; orderBy: Sort[] } {
    const where = this.peek() && !this.isKw('ORDER') ? this.parseOr() : undefined;
    const orderBy: Sort[] = [];
    if (this.isKw('ORDER')) {
      this.next();
      if (!this.isKw('BY')) throw new JqlError('Expected BY after ORDER.');
      this.next();
      do {
        if (orderBy.length) this.next(); // comma
        const field = this.next();
        if (field.t !== 'word' && field.t !== 'str') throw new JqlError(`Unexpected "${field.v}" in ORDER BY.`);
        let desc = false;
        if (this.isKw('ASC') || this.isKw('DESC')) desc = this.next().v.toUpperCase() === 'DESC';
        orderBy.push({ field: field.v, desc });
      } while (this.isPunct(','));
    }
    const rest = this.peek();
    if (rest) throw new JqlError(`Unexpected "${rest.v}".`);
    return { where, orderBy };
  }

  private parseOr(): Node {
    const items = [this.parseAnd()];
    while (this.isKw('OR')) {
      this.next();
      items.push(this.parseAnd());
    }
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }

  private parseAnd(): Node {
    const items = [this.parseNot()];
    while (this.isKw('AND')) {
      this.next();
      items.push(this.parseNot());
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  private parseNot(): Node {
    if (this.isKw('NOT')) {
      this.next();
      return { kind: 'not', item: this.parseNot() };
    }
    if (this.isPunct('(')) {
      this.next();
      const node = this.parseOr();
      this.expectPunct(')');
      return node;
    }
    return this.parseClause();
  }

  private parseClause(): Node {
    const f = this.next();
    if (f.t !== 'word' && f.t !== 'str') throw new JqlError(`Expected a field name but found "${f.v}".`);
    const o = this.next();
    let op: Op;
    if (o.t === 'op') op = o.v as Op;
    else if (this.isKw('IN', o)) op = 'in';
    else if (this.isKw('NOT', o) && this.isKw('IN')) {
      this.next();
      op = 'not in';
    } else if (this.isKw('IS', o)) {
      op = 'is';
      if (this.isKw('NOT')) {
        this.next();
        op = 'is not';
      }
    } else if (this.isKw('WAS', o) || this.isKw('CHANGED', o)) {
      throw new JqlError('History searches (WAS / CHANGED) are not supported by the Shortcut proxy.');
    } else throw new JqlError(`Expected an operator after "${f.v}" but found "${o.v}".`);

    let value: Value;
    if (op === 'is' || op === 'is not') {
      const v = this.next();
      if (!this.isKw('EMPTY', v) && !this.isKw('NULL', v)) throw new JqlError(`Expected EMPTY after IS but found "${v.v}".`);
      value = { kind: 'empty' };
    } else if ((op === 'in' || op === 'not in') && this.isPunct('(')) {
      this.next();
      const items: Value[] = [];
      while (!this.isPunct(')')) {
        if (items.length) this.expectPunct(',');
        items.push(this.parseScalar());
      }
      this.next();
      value = { kind: 'list', items };
    } else {
      value = this.parseScalar();
    }
    return { kind: 'clause', field: f.v, op, value };
  }

  private parseScalar(): Value {
    const t = this.next();
    if (t.t === 'str') return { kind: 'lit', text: t.v };
    if (t.t !== 'word') throw new JqlError(`Unexpected "${t.v}".`);
    if (this.isPunct('(')) {
      this.next();
      const args: string[] = [];
      while (!this.isPunct(')')) {
        if (args.length) this.expectPunct(',');
        const a = this.next();
        if (a.t !== 'word' && a.t !== 'str') throw new JqlError(`Unexpected "${a.v}" in ${t.v}().`);
        args.push(a.v);
      }
      this.next();
      return { kind: 'fn', name: t.v.toLowerCase(), args };
    }
    if (this.isKw('EMPTY', t) || this.isKw('NULL', t)) return { kind: 'empty' };
    return { kind: 'lit', text: t.v };
  }
}

export function parseJql(jql: string) {
  return new Parser(tokenize(jql)).parse();
}

// ---------------------------------------------------------------------------
// Compiler: AST -> Shortcut searches (push-down) + exact in-memory predicate
// ---------------------------------------------------------------------------

/**
 * One JQL condition. `push` terms, ANDed, must match a superset of the stories `test` accepts
 * (`negPush` likewise for the negated condition). A missing `test` means only Shortcut can
 * evaluate it (text search), so its push terms are taken as exact.
 */
interface Atom {
  desc: string;
  test?: (s: Story) => boolean;
  push?: string[];
  negPush?: string[];
}

type Expr = { kind: 'and' | 'or'; items: Expr[] } | { kind: 'not'; item: Expr } | { kind: 'atom'; atom: Atom };

interface Field {
  eq?: (v: Value) => Atom;
  empty?: Atom;
  text?: (v: string) => Atom;
  cmp?: (op: '>' | '>=' | '<' | '<=', v: Value) => Atom;
}

const DAY = 86_400_000;
const q = (v: string) => `"${v.replace(/"/g, '')}"`;
const lower = (v: string) => v.trim().toLowerCase();
const atomExpr = (atom: Atom): Expr => ({ kind: 'atom', atom });

function litText(v: Value, what: string): string {
  if (v.kind !== 'lit') throw new JqlError(`Expected a ${what} value.`);
  return v.text;
}

/** Jira-style words for a Shortcut free-text search (wildcards and operator characters stripped). */
function words(v: string): string {
  return v
    .replace(/[*?:"!]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, ''))
    .filter(Boolean)
    .join(' ');
}

// ponytail: weeks start on Monday; Jira uses the user's locale.
function startOf(unit: 'day' | 'week' | 'month' | 'year', d: Date): Date {
  const r = new Date(d.getFullYear(), unit === 'year' ? 0 : d.getMonth(), unit === 'month' || unit === 'year' ? 1 : d.getDate());
  if (unit === 'week') r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function addUnit(d: Date, n: number, unit: string): Date {
  const r = new Date(d);
  if (unit === 'y' || unit === 'year') r.setFullYear(r.getFullYear() + n);
  else if (unit === 'M' || unit === 'month') r.setMonth(r.getMonth() + n);
  else if (unit === 'w' || unit === 'week') r.setDate(r.getDate() + 7 * n);
  else if (unit === 'd' || unit === 'day') r.setDate(r.getDate() + n);
  else if (unit === 'h') r.setHours(r.getHours() + n);
  else if (unit === 'm') r.setMinutes(r.getMinutes() + n);
  return r;
}

/** "-7d", "+1w 2d", "-3M": Jira relative offsets. */
function applyOffset(d: Date, offset: string, defaultUnit?: string): Date | null {
  const t = offset.trim();
  if (defaultUnit && /^[+-]?\d+$/.test(t)) return addUnit(d, Number(t), defaultUnit);
  if (!/^[+-]?(\d+[yMwdhm]\s*)+$/.test(t)) return null;
  const sign = t.startsWith('-') ? -1 : 1;
  let r = d;
  for (const [, n, unit] of t.matchAll(/(\d+)([yMwdhm])/g)) r = addUnit(r, sign * Number(n), unit);
  return r;
}

function parseDate(v: Value, now: Date): { at: Date; dayOnly: boolean } {
  if (v.kind === 'fn') {
    if (v.name === 'now') return { at: now, dayOnly: false };
    const m = /^(start|end)of(day|week|month|year)$/.exec(v.name);
    if (!m) throw new JqlError(`Unsupported date function ${v.name}().`);
    const unit = m[2] as 'day' | 'week' | 'month' | 'year';
    let base = startOf(unit, now);
    if (v.args[0]) {
      base = applyOffset(base, v.args[0], unit) ?? (() => {
        throw new JqlError(`Bad increment "${v.args[0]}" in ${v.name}().`);
      })();
    }
    return { at: m[1] === 'end' ? new Date(addUnit(base, 1, unit).getTime() - 1) : base, dayOnly: false };
  }
  const text = litText(v, 'date');
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text.trim());
  if (m) {
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    return { at, dayOnly: m[4] === undefined };
  }
  const rel = applyOffset(now, text);
  if (rel) return { at: rel, dayOnly: false };
  throw new JqlError(`Unrecognised date "${text}". Use yyyy-MM-dd, yyyy-MM-dd HH:mm, or a relative value like -7d.`);
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function dateField(name: string, op: string, now: Date, get: (s: Story) => string | null | undefined): Field {
  const ts = (s: Story) => {
    const v = get(s);
    return v ? Date.parse(v) : null;
  };
  return {
    eq: (v) => {
      const { at, dayOnly } = parseDate(v, now);
      const start = at.getTime();
      const end = dayOnly ? addUnit(at, 1, 'day').getTime() : start + 1; // next local midnight: days aren't always 24h
      return {
        desc: `${name} = ${v.kind === 'lit' ? v.text : 'date'}`,
        test: (s) => {
          const t = ts(s);
          return t !== null && t >= start && t < end;
        },
        push: [`${op}:${ymd(start - DAY)}..${ymd(end + DAY)}`],
      };
    },
    cmp: (cmpOp, v) => {
      const at = parseDate(v, now).at.getTime();
      const after = cmpOp === '>' || cmpOp === '>=';
      return {
        desc: `${name} ${cmpOp} date`,
        test: (s) => {
          const t = ts(s);
          if (t === null) return false;
          return cmpOp === '>' ? t > at : cmpOp === '>=' ? t >= at : cmpOp === '<' ? t < at : t <= at;
        },
        // Widened by a day either side: Shortcut ranges are whole days in the workspace's time zone.
        push: [after ? `${op}:${ymd(at - DAY)}..*` : `${op}:*..${ymd(at + DAY)}`],
      };
    },
  };
}

function numberField(name: string, get: (s: Story) => number | null | undefined, opts: { push?: string; empty?: Atom } = {}): Field {
  const num = (v: Value) => {
    const n = Number(litText(v, 'number'));
    if (!Number.isFinite(n)) throw new JqlError(`${name} needs a number.`);
    return n;
  };
  return {
    eq: (v) => {
      const n = num(v);
      return {
        desc: `${name} = ${n}`,
        test: (s) => get(s) === n,
        push: opts.push && Number.isInteger(n) ? [`${opts.push}:${n}`] : undefined,
      };
    },
    empty: opts.empty,
    cmp: (op, v) => {
      const n = num(v);
      return {
        desc: `${name} ${op} ${n}`,
        test: (s) => {
          const x = get(s);
          return x != null && (op === '>' ? x > n : op === '>=' ? x >= n : op === '<' ? x < n : x <= n);
        },
      };
    },
  };
}

// Canonical Shortcut custom fields that the search API accepts as operators (verified live).
const SEARCHABLE_CUSTOM_FIELDS = new Set(['priority', 'technical-area', 'severity', 'product-area', 'skill-set']);

function customField(cf: CustomField, displayName: string): Field {
  const resolve = (v: Value) => {
    const text = lower(litText(v, displayName));
    const exact = cf.values.find((x) => x.value.toLowerCase() === text || x.id === text);
    const prefixed = cf.values.filter((x) => x.value.toLowerCase().startsWith(text));
    const value = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
    if (!value) {
      throw new JqlError(
        `"${litText(v, displayName)}" is not a ${displayName} value. Options: ${cf.values.map((x) => x.value).join(', ')}.`,
      );
    }
    return value;
  };
  const valueOf = (s: Story) => s.custom_fields?.find((f) => f.field_id === cf.id)?.value_id;
  const position = (s: Story) => cf.values.find((x) => x.id === valueOf(s))?.position;
  const canonical = cf.canonical_name && SEARCHABLE_CUSTOM_FIELDS.has(cf.canonical_name) ? cf.canonical_name : undefined;
  return {
    eq: (v) => {
      const value = resolve(v);
      return {
        desc: `${displayName} = ${value.value}`,
        test: (s) => valueOf(s) === value.id,
        push: canonical ? [`${canonical}:${q(value.value)}`] : undefined,
      };
    },
    empty: { desc: `${displayName} is EMPTY`, test: (s) => !valueOf(s) },
    // Ordered by the field's option order: "priority > P3" means more important than P3.
    cmp: (op, v) => {
      const target = resolve(v).position;
      return {
        desc: `${displayName} ${op} ${litText(v, displayName)}`,
        test: (s) => {
          const p = position(s);
          return p !== undefined && (op === '>' ? p < target : op === '>=' ? p <= target : op === '<' ? p > target : p >= target);
        },
      };
    },
  };
}

function resolveUsers(v: Value, l: Lookups): Member[] {
  if (v.kind === 'fn') {
    if (v.name === 'currentuser') {
      const me = l.members.get(l.me.id);
      if (!me) throw new JqlError('Could not resolve currentUser().');
      return [me];
    }
    if (v.name === 'membersof') {
      const g = findGroup(l.groups, v.args[0] ?? '') ?? l.groups.find((x) => lower(x.name) === lower(v.args[0] ?? ''));
      if (!g) throw new JqlError(`Unknown team in membersOf("${v.args[0] ?? ''}").`);
      return (g.member_ids ?? []).flatMap((id) => l.members.get(id) ?? []);
    }
    throw new JqlError(`Unsupported user function ${v.name}().`);
  }
  const t = lower(litText(v, 'user'));
  const m = [...l.members.values()].find(
    (x) =>
      x.id === t ||
      x.profile.mention_name.toLowerCase() === t.replace(/^@/, '') ||
      x.profile.email_address?.toLowerCase() === t ||
      x.profile.name.toLowerCase() === t,
  );
  if (!m) throw new JqlError(`Unknown user "${litText(v, 'user')}". Use a Shortcut mention name, email or full name.`);
  return [m];
}

function userField(
  l: Lookups,
  name: string,
  get: (s: Story) => string[],
  op: string,
  negatable: boolean,
  empty?: Atom,
): Field {
  return {
    eq: (v) => {
      const users = resolveUsers(v, l);
      const ids = new Set(users.map((u) => u.id));
      const single = users.length === 1 ? users[0].profile.mention_name : undefined;
      return {
        desc: `${name} = ${users.map((u) => u.profile.mention_name).join(', ')}`,
        test: (s) => get(s).some((id) => ids.has(id)),
        push: single ? [`${op}:${single}`] : undefined,
        negPush: single && negatable ? [`!${op}:${single}`] : undefined,
      };
    },
    empty,
  };
}

function fields(l: Lookups, now: Date): Map<string, Field> {
  const map = new Map<string, Field>();
  const add = (names: string[], f: Field) => names.forEach((n) => map.set(n, f));
  const stateType = (s: Story) => l.states.get(s.workflow_state_id)?.type;
  const NOT_DONE: Atom = { desc: 'unresolved', test: (s) => stateType(s) !== 'done', push: ['!is:done'], negPush: ['is:done'] };

  add(['project'], {
    eq: (v) => {
      const text = litText(v, 'project');
      const g = findGroup(l.groups, text) ?? l.groups.find((x) => lower(x.name) === lower(text));
      if (!g) throw new JqlError(`Unknown project (Shortcut team) "${text}".`);
      return {
        desc: `project = ${g.mention_name}`,
        test: (s) => s.group_id === g.id,
        push: [`team:${g.mention_name}`],
        negPush: [`!team:${g.mention_name}`],
      };
    },
    empty: { desc: 'project is EMPTY', test: (s) => !s.group_id },
  });

  add(['key', 'issuekey', 'id', 'issue'], {
    eq: (v) => {
      const id = parseKey(litText(v, 'key'));
      if (id === null) throw new JqlError(`"${litText(v, 'key')}" is not a Shortcut story key (expected SC-123).`);
      return { desc: `key = SC-${id}`, test: (s) => s.id === id, push: [`id:${id}`] };
    },
    cmp: (op, v) => {
      const id = parseKey(litText(v, 'key'));
      if (id === null) throw new JqlError(`"${litText(v, 'key')}" is not a Shortcut story key (expected SC-123).`);
      return {
        desc: `key ${op} SC-${id}`,
        test: (s) => (op === '>' ? s.id > id : op === '>=' ? s.id >= id : op === '<' ? s.id < id : s.id <= id),
      };
    },
  });

  add(
    ['assignee', 'owner'],
    userField(l, 'assignee', (s) => s.owner_ids, 'owner', true, {
      desc: 'assignee is EMPTY',
      test: (s) => s.owner_ids.length === 0,
      push: ['!has:owner'],
      negPush: ['has:owner'],
    }),
  );
  add(['reporter', 'creator', 'requester'], userField(l, 'reporter', (s) => [s.requested_by_id], 'requester', false));

  add(['status'], {
    eq: (v) => {
      const text = litText(v, 'status');
      const matches = [...l.states.values()].filter((x) => x.name.toLowerCase() === lower(text) || String(x.id) === text);
      if (!matches.length) throw new JqlError(`Unknown status "${text}".`);
      const ids = new Set(matches.map((x) => x.id));
      return {
        desc: `status = ${matches[0].name}`,
        test: (s) => ids.has(s.workflow_state_id),
        push: [`state:${q(matches[0].name)}`],
        negPush: [`!state:${q(matches[0].name)}`],
      };
    },
  });

  add(['statuscategory'], {
    eq: (v) => {
      const cat = lower(litText(v, 'status category'));
      if (cat === 'done') return { desc: 'statusCategory = Done', test: (s) => stateType(s) === 'done', push: ['is:done'], negPush: ['!is:done'] };
      if (cat === 'in progress' || cat === 'indeterminate')
        return { desc: 'statusCategory = In Progress', test: (s) => stateType(s) === 'started', push: ['is:started'], negPush: ['!is:started'] };
      if (cat === 'to do' || cat === 'new')
        return {
          desc: 'statusCategory = To Do',
          test: (s) => stateType(s) === 'unstarted' || stateType(s) === 'backlog',
          push: ['!is:started', '!is:done'],
        };
      throw new JqlError(`Unknown statusCategory "${litText(v, 'status category')}". Use "To Do", "In Progress" or Done.`);
    },
  });

  add(['resolution'], {
    eq: (v) => {
      if (lower(litText(v, 'resolution')) === 'unresolved') return NOT_DONE;
      return { desc: 'resolved', test: (s) => !NOT_DONE.test!(s), push: NOT_DONE.negPush, negPush: NOT_DONE.push };
    },
    empty: NOT_DONE,
  });

  add(['type', 'issuetype'], {
    eq: (v) => {
      const t = { story: 'feature', feature: 'feature', bug: 'bug', chore: 'chore', task: 'chore' }[lower(litText(v, 'type'))];
      if (!t) throw new JqlError(`Unknown issue type "${litText(v, 'type')}". Use Feature (or Story), Bug or Chore (or Task).`);
      return { desc: `type = ${t}`, test: (s) => s.story_type === t, push: [`type:${t}`], negPush: [`!type:${t}`] };
    },
  });

  add(['labels', 'label'], {
    eq: (v) => {
      const name = litText(v, 'label');
      return {
        desc: `labels = ${name}`,
        test: (s) => s.labels.some((x) => x.name.toLowerCase() === lower(name)),
        push: [`label:${q(name)}`],
        negPush: [`!label:${q(name)}`],
      };
    },
    empty: { desc: 'labels is EMPTY', test: (s) => s.labels.length === 0, push: ['!has:label'], negPush: ['has:label'] },
  });

  add(['sprint', 'cf[10020]', 'customfield_10020', 'iteration'], {
    eq: (v) => {
      const status = v.kind === 'fn' ? { opensprints: 'started', closedsprints: 'done', futuresprints: 'unstarted' }[v.name] : undefined;
      if (v.kind === 'fn' && !status) throw new JqlError(`Unsupported sprint function ${v.name}().`);
      if (status) {
        return {
          desc: `sprint in ${(v as { name: string }).name}()`,
          test: (s) => l.iterations.get(s.iteration_id ?? -1)?.status === status,
          push: ['has:iteration'],
        };
      }
      const text = litText(v, 'sprint');
      const ids = new Set([...l.iterations.values()].filter((i) => lower(i.name) === lower(text) || String(i.id) === text).map((i) => i.id));
      if (!ids.size) throw new JqlError(`Unknown sprint (Shortcut iteration) "${text}".`);
      return { desc: `sprint = ${text}`, test: (s) => ids.has(s.iteration_id ?? -1), push: ['has:iteration'] };
    },
    empty: { desc: 'sprint is EMPTY', test: (s) => !s.iteration_id, push: ['!has:iteration'], negPush: ['has:iteration'] },
  });

  add(['parent', 'epic', 'epic link'], {
    eq: (v) => {
      const m = /^(?:epic-)?(\d+)$/i.exec(litText(v, 'epic').trim());
      if (!m) throw new JqlError(`"${litText(v, 'epic')}" is not an epic key (expected EPIC-123).`);
      const id = Number(m[1]);
      return { desc: `parent = EPIC-${id}`, test: (s) => s.epic_id === id, push: [`epic:${id}`] };
    },
    empty: { desc: 'parent is EMPTY', test: (s) => !s.epic_id, push: ['!has:epic'], negPush: ['has:epic'] },
  });

  add(
    ['story points', 'storypoints', 'story point estimate', 'estimate', 'cf[10016]', 'customfield_10016'],
    numberField('story points', (s) => s.estimate, {
      push: 'estimate',
      empty: { desc: 'story points is EMPTY', test: (s) => s.estimate == null, push: ['is:unestimated'], negPush: ['!is:unestimated'] },
    }),
  );

  add(['flagged', 'blocked'], {
    eq: () => ({ desc: 'flagged', test: (s) => !!s.blocked, push: ['is:blocked'], negPush: ['!is:blocked'] }),
    empty: { desc: 'flagged is EMPTY', test: (s) => !s.blocked, push: ['!is:blocked'], negPush: ['is:blocked'] },
  });

  add(['created', 'createddate'], dateField('created', 'created', now, (s) => s.created_at));
  add(['updated', 'updateddate'], dateField('updated', 'updated', now, (s) => s.updated_at));
  add(['resolved', 'resolutiondate'], { ...dateField('resolved', 'completed', now, (s) => s.completed_at), empty: NOT_DONE });
  add(['due', 'duedate'], {
    ...dateField('due', 'due', now, (s) => s.deadline),
    empty: { desc: 'due is EMPTY', test: (s) => !s.deadline, push: ['!has:deadline'], negPush: ['has:deadline'] },
  });

  add(['text'], { text: (v) => ({ desc: `text ~ "${v}"`, push: [words(v)] }) });
  add(['summary'], {
    text: (v) => {
      const ws = words(v).toLowerCase().split(' ').filter(Boolean);
      return {
        desc: `summary ~ "${v}"`,
        test: (s) => ws.every((w) => s.name.toLowerCase().includes(w)),
        push: [words(v)],
      };
    },
  });
  add(['description'], { text: (v) => ({ desc: `description ~ "${v}"`, push: [`description:${q(words(v))}`] }) });
  add(['comment'], { text: (v) => ({ desc: `comment ~ "${v}"`, push: [`comment:${q(words(v))}`] }) });

  for (const cf of l.customFields) {
    const f = customField(cf, cf.name);
    // Built-in fields win over custom fields of the same name.
    for (const n of [lower(cf.name), cf.canonical_name]) if (n && !map.has(n)) map.set(n, f);
  }
  return map;
}

function compileClause(c: Extract<Node, { kind: 'clause' }>, fieldMap: Map<string, Field>, expandIn: boolean): Expr {
  const name = lower(c.field);
  const f = fieldMap.get(name);
  if (!f) throw new JqlError(`Unsupported field "${c.field}".`);
  const unsupported = () => new JqlError(`Operator "${c.op}" is not supported for ${c.field}.`);
  const not = (e: Expr): Expr => ({ kind: 'not', item: e });
  // Jira: != and NOT IN never match issues where the field is empty.
  const notEmpty = (e: Expr): Expr => (f.empty ? { kind: 'and', items: [e, not(atomExpr(f.empty))] } : e);
  const eq = (v: Value): Expr => {
    if (!f.eq) throw unsupported();
    if (v.kind === 'empty') {
      if (!f.empty) throw unsupported();
      return atomExpr(f.empty);
    }
    return atomExpr(f.eq(v));
  };
  const anyOf = (items: Value[]): Expr => {
    if (items.length === 1 || expandIn) return items.length === 1 ? eq(items[0]) : { kind: 'or', items: items.map(eq) };
    // Collapsed: one test-only atom, so a long IN list doesn't multiply Shortcut searches.
    const atoms = items.map((v) => {
      const a = v.kind === 'empty' ? f.empty : f.eq?.(v);
      if (!a) throw unsupported();
      return a;
    });
    return atomExpr({
      desc: `${c.field} in (…)`,
      test: (s) => atoms.some((a) => a.test?.(s) ?? true),
    });
  };
  const list = (v: Value) => (v.kind === 'list' ? v.items : [v]);

  switch (c.op) {
    case '=':
      return eq(c.value);
    case '!=':
      return notEmpty(not(eq(c.value)));
    case 'in':
      return anyOf(list(c.value));
    case 'not in':
      return notEmpty(not(anyOf(list(c.value))));
    case 'is':
    case 'is not': {
      if (!f.empty) throw unsupported();
      const e = atomExpr(f.empty);
      return c.op === 'is' ? e : not(e);
    }
    case '~':
    case '!~': {
      if (!f.text) throw unsupported();
      const e = atomExpr(f.text(litText(c.value, 'text')));
      return c.op === '~' ? e : not(e);
    }
    default: {
      if (!f.cmp) throw unsupported();
      return atomExpr(f.cmp(c.op, c.value));
    }
  }
}

function compileNode(n: Node, fieldMap: Map<string, Field>, expandIn: boolean): Expr {
  if (n.kind === 'clause') return compileClause(n, fieldMap, expandIn);
  if (n.kind === 'not') return { kind: 'not', item: compileNode(n.item, fieldMap, expandIn) };
  return { kind: n.kind, items: n.items.map((i) => compileNode(i, fieldMap, expandIn)) };
}

interface Lit {
  atom: Atom;
  neg: boolean;
}

/** Disjunctive normal form, or null when it would exceed `limit` conjunctions. */
function dnf(e: Expr, limit: number, neg = false): Lit[][] | null {
  if (e.kind === 'atom') return [[{ atom: e.atom, neg }]];
  if (e.kind === 'not') return dnf(e.item, limit, !neg);
  const parts = e.items.map((i) => dnf(i, limit, neg));
  if (parts.some((p) => p === null)) return null;
  if ((e.kind === 'or') !== neg) {
    const all = (parts as Lit[][][]).flat();
    return all.length > limit ? null : all;
  }
  let acc: Lit[][] = [[]];
  for (const p of parts as Lit[][][]) {
    acc = acc.flatMap((a) => p.map((b) => [...a, ...b]));
    if (acc.length > limit) return null;
  }
  return acc;
}

function evaluate(e: Expr, s: Story): boolean {
  if (e.kind === 'atom') {
    if (!e.atom.test) throw new JqlError(`Query is too complex to combine with ${e.atom.desc}. Simplify the OR/IN parts.`);
    return e.atom.test(s);
  }
  if (e.kind === 'not') return !evaluate(e.item, s);
  return e.kind === 'and' ? e.items.every((i) => evaluate(i, s)) : e.items.some((i) => evaluate(i, s));
}

function sortKey(field: string, l: Lookups): (s: Story) => string | number | null | undefined {
  const priority = l.customFields.find((f) => f.canonical_name === 'priority');
  switch (lower(field)) {
    case 'created':
    case 'createddate':
      return (s) => s.created_at;
    case 'updated':
    case 'updateddate':
      return (s) => s.updated_at;
    case 'resolved':
    case 'resolutiondate':
      return (s) => s.completed_at;
    case 'due':
    case 'duedate':
      return (s) => s.deadline;
    case 'key':
    case 'issuekey':
    case 'id':
      return (s) => s.id;
    case 'summary':
      return (s) => s.name.toLowerCase();
    case 'rank':
      return (s) => s.position;
    case 'story points':
    case 'storypoints':
    case 'estimate':
    case 'cf[10016]':
      return (s) => s.estimate;
    case 'priority': {
      // Higher priority (lower option position) sorts as the larger value, like Jira.
      return (s) => {
        const id = s.custom_fields?.find((f) => f.field_id === priority?.id)?.value_id;
        const p = priority?.values.find((v) => v.id === id)?.position;
        return p === undefined ? null : -p;
      };
    }
    case 'status':
      return (s) => {
        const st = l.states.get(s.workflow_state_id);
        return st ? ['backlog', 'unstarted', 'started', 'done'].indexOf(st.type) * 1e6 + st.position : null;
      };
    case 'assignee':
      return (s) => l.members.get(s.owner_ids[0] ?? '')?.profile.name.toLowerCase();
    case 'project':
      return (s) => l.groups.find((g) => g.id === s.group_id)?.name.toLowerCase();
    case 'type':
    case 'issuetype':
      return (s) => s.story_type;
    default:
      throw new JqlError(`Cannot ORDER BY "${field}".`);
  }
}

export interface Compiled {
  /** Shortcut searches to run; union their results, keeping only stories that pass `test`. */
  searches: { query: string; test: (s: Story) => boolean }[];
  compare: (a: Story, b: Story) => number;
}

const MAX_SEARCHES = 8;

export function compileJql(jql: string, l: Lookups, now = new Date()): Compiled {
  const { where, orderBy } = parseJql(jql);
  const fieldMap = fields(l, now);
  const terms = (lits: Lit[]) =>
    lits.flatMap(({ atom, neg }) => {
      const t = neg ? atom.negPush : atom.push;
      if (!t && !atom.test) throw new JqlError(`Shortcut can't search for NOT (${atom.desc}).`);
      return t ?? [];
    });
  const testAll = (lits: Lit[]) => (s: Story) => lits.every(({ atom, neg }) => !atom.test || atom.test(s) !== neg);
  const search = (pushed: string[], test: (s: Story) => boolean) => ({
    query: [...new Set([...pushed, '!is:archived'])].join(' '),
    test,
  });

  let searches: Compiled['searches'];
  if (!where) {
    searches = [search([], () => true)];
  } else {
    const conj = dnf(compileNode(where, fieldMap, true), MAX_SEARCHES) ?? dnf(compileNode(where, fieldMap, false), MAX_SEARCHES);
    if (conj) {
      searches = conj.map((lits) => search(terms(lits), testAll(lits)));
    } else {
      // ponytail: too many OR branches to push down; scans recent stories and filters in memory.
      const expr = compileNode(where, fieldMap, false);
      const textOnly = (e: Expr): Atom | undefined =>
        e.kind === 'atom' ? (e.atom.test ? undefined : e.atom) : e.kind === 'not' ? textOnly(e.item) : e.items.map(textOnly).find(Boolean);
      const text = textOnly(expr);
      if (text) throw new JqlError(`Too many OR branches to combine with ${text.desc}. Simplify the query.`);
      searches = [search([], (s) => evaluate(expr, s))];
    }
  }

  const keys = (orderBy.length ? orderBy : [{ field: 'updated', desc: true }]).map((o) => ({
    get: sortKey(o.field, l),
    desc: o.desc,
  }));
  const compare = (a: Story, b: Story) => {
    for (const { get, desc } of keys) {
      const x = get(a);
      const y = get(b);
      if (x === y) continue;
      if (x == null) return 1; // empty values last, either direction
      if (y == null) return -1;
      const c = x < y ? -1 : 1;
      return desc ? -c : c;
    }
    return b.id - a.id;
  };
  return { searches, compare };
}
