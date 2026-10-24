import { marked } from 'marked';
import jql from '../../docs/jql.md';
import type { AppApi } from './preload.ts';
import type { AppState } from './state.ts';
import { rejectedWarning, setupStatus } from './view.ts';

declare global {
  interface Window {
    app: AppApi;
  }
}

const api = window.app;
let state: AppState | undefined;

type Child = Node | string;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
const button = (label: string, onclick: () => void) => el('button', { textContent: label, onclick });

// --- Setup
const baseUrl = el('code');
const statusLine = el('div', { className: 'status' });
const warnings = el('div');
const setup = el(
  'section',
  {},
  el('h1', { textContent: 'Setup' }),
  el(
    'ol',
    {},
    el(
      'li',
      {},
      el('strong', { textContent: 'Get a Shortcut token' }),
      el('div', {}, 'Shortcut → Settings → API Tokens → Generate Token. Use one with ', el('strong', { textContent: 'write' }), ' access, or Orca can only read.'),
      el('div', { className: 'row' }, button('Open Shortcut API tokens', () => void api.openExternal('https://app.shortcut.com/settings/account/api-tokens'))),
    ),
    el(
      'li',
      {},
      el('strong', { textContent: 'Connect Orca' }),
      el('div', {}, 'In Orca: Settings → Integrations → Jira → ', el('strong', { textContent: 'Self-hosted' }), ' → ', el('strong', { textContent: 'Personal access token' }), '.'),
      el('div', { className: 'row' }, 'Jira site URL ', baseUrl, button('Copy', () => void api.copy(baseUrl.textContent ?? ''))),
      el('div', {}, 'Paste your Shortcut token as the Jira personal access token.'),
    ),
    el('li', {}, el('strong', { textContent: 'Check the connection' }), statusLine, warnings),
  ),
);

function renderSetup(s: AppState): void {
  baseUrl.textContent = `http://localhost:${s.proxy.port}`;
  const v = setupStatus(s, Date.now());
  statusLine.textContent = v.line;
  warnings.replaceChildren(...v.warnings.map((w) => el('div', { className: 'warn', textContent: w })));
}

// --- Status
const proxyLine = el('div', { className: 'status' });
const statusWarning = el('div');
const logBody = el('tbody');
const status = el(
  'section',
  {},
  el('h1', { textContent: 'Status' }),
  proxyLine,
  statusWarning,
  el('h2', { textContent: 'Requests' }),
  el('table', {}, el('thead', {}, el('tr', {}, ...['Time', 'Method', 'Path', 'Status', 'ms', 'Error'].map((h) => el('th', { textContent: h })))), logBody),
);

function renderStatus(s: AppState): void {
  const p = s.proxy;
  proxyLine.className = p.state === 'error' ? 'status err' : 'status';
  proxyLine.textContent = p.state === 'running' ? `Running on port ${p.port}` : p.state === 'starting' ? `Starting on port ${p.port}…` : p.state === 'error' ? `Not running on port ${p.port}: ${p.message}` : '';
  const w = rejectedWarning(s);
  statusWarning.replaceChildren(...(w ? [el('div', { className: 'warn', textContent: w })] : []));
  // textContent only: paths and errors come from the network.
  logBody.replaceChildren(
    ...s.log.map((e) =>
      el('tr', {}, ...[new Date(e.at).toLocaleTimeString(), e.method, e.path, String(e.status), String(e.ms), e.error ?? ''].map((t, i) => el('td', { textContent: t, className: i === 2 ? 'path' : '' }))),
    ),
  );
}

// --- JQL guide (our own docs/jql.md, rendered at build time)
const guide = el('section', { id: 'guide' });
guide.innerHTML = marked.parse(jql, { async: false });
guide.querySelectorAll('pre').forEach((pre) => pre.append(button('Copy', () => void api.copy(pre.querySelector('code')?.textContent ?? ''))));
guide.addEventListener('click', (ev) => {
  const a = (ev.target as Element).closest('a');
  if (!a) return;
  ev.preventDefault();
  void api.openExternal(a.href);
});

// --- Settings
const portInput = el('input', { type: 'number', min: '1024', max: '65535' });
const portError = el('div', { className: 'err' });
const login = el('input', { type: 'checkbox', onchange: () => void api.setLaunchAtLogin(login.checked) });
const settings = el(
  'section',
  {},
  el('h1', { textContent: 'Settings' }),
  el('div', {}, 'Port (1024–65535)'),
  el(
    'div',
    { className: 'row' },
    portInput,
    button('Save', () => {
      void api.setPort(Number(portInput.value)).then((r) => {
        portError.textContent = r.ok ? '' : r.error;
        if (state) renderSettings(state); // the real port may differ from what was typed
      });
    }),
  ),
  portError,
  el('div', { className: 'row' }, el('label', {}, login, ' Open at login')),
);

function renderSettings(s: AppState): void {
  if (document.activeElement !== portInput) portInput.value = String(s.proxy.port);
  login.checked = s.launchAtLogin;
}

// --- Tabs
const tabs: [string, HTMLElement][] = [['Setup', setup], ['Status', status], ['JQL guide', guide], ['Settings', settings]];
const buttons = tabs.map(([name, sec]) =>
  el('button', {
    textContent: name,
    onclick: () => {
      tabs.forEach(([, s], i) => {
        s.classList.toggle('active', s === sec);
        buttons[i].classList.toggle('active', s === sec);
      });
    },
  }),
);
buttons[0].click();
document.getElementById('root')!.append(el('nav', {}, ...buttons), ...tabs.map(([, s]) => s));

function render(s: AppState): void {
  state = s;
  renderSetup(s);
  renderStatus(s);
  renderSettings(s);
  document.body.dataset.rendered = '1';
}
api.onState(render);
void api.getState().then(render);
setInterval(() => state && renderSetup(state), 1000); // keeps "last request Ns ago" fresh
