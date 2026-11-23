// Tests without login on a mock page with a Fluent-like model menu (picker -> menu -> submenu), a
// Work IQ switch and a chat input. The mock mimics the parts of the real page the script depends on:
// the menu opens in a popover (.fui-MenuPopover > [role="menu"]), focus moves into the menu and returns
// to the picker when it closes, and Escape closes it. Query parameters steer the scenario:
//   sub=hover|click|key  how the "GPT" entry opens its submenu (default: all three work)
//   lastDisabled=1       the last submenu entry is disabled
//   reset=1              the page resets the label to "Auto" 400 ms after every selection
//   nomenu=1             the picker does nothing (the menu never opens)
//   delay=<ms>           the menu opens only after this delay (long busy window)
//   nofocus=1            nothing has the keyboard focus at the start (default: the chat input has it)
//   flipback=1|always    the page switches Work IQ back on by itself 1.2 s after it was switched off
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { root } from '../tools/lib.mjs';

// M365_SCRIPT lets tools/mutation-check.mjs run this test against a deliberately broken copy of the script.
const src = fs.readFileSync(process.env.M365_SCRIPT || path.join(root, 'm365-best-model.user.js'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const MOCK_SCRIPT = `
const Q = window.Q;
window.__selected = [];
window.__wclicks = 0;
window.__esc = 0;
const picker = document.getElementById('picker');
const label = document.getElementById('pl');
const input = document.getElementById('input');
let menus = [];
let opening = false;
if (!Q.nofocus) addEventListener('DOMContentLoaded', () => input.focus());
input.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; });

function closeAll() {
  for (const m of menus) m.pop.remove();
  menus = [];
  picker.focus(); // like Fluent: the focus returns to the trigger
}
function makeMenu(items, left) {
  const pop = document.createElement('div');
  pop.className = 'fui-MenuPopover';
  pop.style.cssText = 'position:fixed;top:80px;left:' + left + 'px;background:#fff;border:1px solid #888;padding:4px;z-index:9';
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  items.forEach((item) => menu.appendChild(item));
  pop.appendChild(menu);
  document.body.appendChild(pop);
  menus.push({ pop, menu });
  menu.focus(); // like Fluent: the focus moves into the menu
  return menu;
}
function radio(text, checked, disabled) {
  const el = document.createElement('div');
  el.setAttribute('role', 'menuitemradio');
  el.setAttribute('aria-checked', String(Boolean(checked)));
  if (disabled) el.setAttribute('aria-disabled', 'true');
  el.tabIndex = -1;
  el.textContent = text;
  el.addEventListener('click', () => { if (!disabled) choose(text); });
  return el;
}
function choose(text) {
  window.__selected.push(text);
  label.textContent = text;
  closeAll();
  if (Q.reset) setTimeout(() => { label.textContent = 'Auto'; }, 400);
}
function openSubmenu(trigger) {
  if (menus.length > 1) return;
  const m = makeMenu([radio('GPT-A'), radio('GPT-B'), radio('GPT-Y'), radio('GPT-Z', false, Boolean(Q.lastDisabled))], 300);
  m.focus();
}
picker.addEventListener('click', () => {
  if (Q.nomenu || opening) return;
  if (menus.length) { closeAll(); return; }
  const build = () => {
    opening = false;
    const gpt = document.createElement('div');
    gpt.setAttribute('role', 'menuitem');
    gpt.setAttribute('aria-haspopup', 'menu');
    gpt.tabIndex = -1;
    gpt.textContent = 'GPT OpenAI';
    const mode = Q.sub || 'any';
    if (mode === 'any' || mode === 'hover') gpt.addEventListener('mouseover', () => openSubmenu(gpt));
    if (mode === 'any' || mode === 'click') gpt.addEventListener('click', () => openSubmenu(gpt));
    if (mode === 'any' || mode === 'key') gpt.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') openSubmenu(gpt); });
    makeMenu([radio('Auto', label.textContent === 'Auto'), radio('Fast'), radio('Deep'), gpt], 20);
  };
  if (Number(Q.delay)) { opening = true; setTimeout(build, Number(Q.delay)); } else build();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && menus.length) closeAll(); });

const work = document.getElementById('w');
window.__flips = 0;
function setWork(on) {
  work.setAttribute('aria-checked', String(on));
  work.setAttribute('aria-label', on ? 'Work IQ deaktivieren' : 'Work IQ aktivieren');
}
work.addEventListener('click', () => {
  window.__wclicks++;
  const wasOn = work.getAttribute('aria-checked') === 'true';
  setWork(!wasOn);
  // The page itself switches Work IQ back on 1.2 s after it was switched off (once, or every time).
  if (Q.flipback && wasOn && (Q.flipback === 'always' || window.__flips < 1)) {
    window.__flips++;
    setTimeout(() => setWork(true), 1200);
  }
});
`;

const mockPage = (url) => {
  const q = Object.fromEntries(new URL(url).searchParams);
  return `<!doctype html><meta charset="utf-8"><title>mock</title><body>
<input id="input" aria-label="Message"><input id="other" aria-label="Other">
<button id="w" type="button" role="switch" aria-checked="true" aria-label="Work IQ deaktivieren"><span>Work IQ</span></button>
<button id="picker" type="button" aria-haspopup="menu" aria-label="Auto, Model picker"><span id="pl">Auto</span></button>
<script>window.Q = ${JSON.stringify(q)};</script><script>${MOCK_SCRIPT}</script></body>`;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function run({ name, query = '', hash = '', waitForSwitch = true, act }) {
  const ctx = await browser.newContext({ locale: 'en-US' });
  await ctx.route('https://copilot.cloud.microsoft/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: mockPage(route.request().url()) }),
  );
  const page = await ctx.newPage();
  const lines = [];
  page.on('console', (m) => m.text().startsWith('[m365-best-model]') && lines.push(m.text().replace('[m365-best-model] ', '')));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('m365-best-model-debug', '1');
    } catch (_) {}
  });
  await page.addInitScript({ content: src });
  await page.goto(`https://copilot.cloud.microsoft/chat?${query}${hash}`);
  if (waitForSwitch) {
    await page.waitForFunction(() => document.getElementById('pl').textContent !== 'Auto', null, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(900); // let the menu close and the focus settle
  }
  if (act) await act(page);
  const state = await page.evaluate(() => ({
    label: document.getElementById('pl').textContent,
    selected: window.__selected,
    work: document.getElementById('w').getAttribute('aria-checked'),
    wclicks: window.__wclicks,
    esc: window.__esc,
    active: document.activeElement?.id || document.activeElement?.tagName,
    popovers: document.querySelectorAll('.fui-MenuPopover').length,
  }));
  await ctx.close();
  return { name, ...state, lines };
}

const user = {
  /** The user opens the model menu and picks "Auto" with real (trusted) clicks, then the SPA changes the URL. */
  choosesAutoThenUrlChanges: async (page) => {
    await page.click('#picker');
    await page.click('[role="menuitemradio"]:has-text("Auto")');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      history.pushState(null, '', '/chat/conversation/abc'); // like the first message of a new chat
      document.body.appendChild(document.createElement('div')); // any DOM change
    });
    await page.waitForTimeout(4500);
  },
};

const cases = await Promise.all([
  // --- the rule: bottom entry, submenu opening, disabled entries ---
  run({ name: 'bottom model via submenu' }),
  run({ name: 'submenu opens on hover only', query: 'sub=hover' }),
  run({ name: 'submenu opens on click only', query: 'sub=click' }),
  run({ name: 'submenu opens on ArrowRight only', query: 'sub=key' }),
  run({ name: 'last entry disabled', query: 'lastDisabled=1' }),
  // --- focus ---
  run({ name: 'focus: chat input had it' }),
  run({ name: 'focus: nothing had it', query: 'nofocus=1' }),
  // --- finding 1: user choice survives a URL change without reload ---
  run({ name: 'user chooses Auto, URL changes', act: user.choosesAutoThenUrlChanges }),
  // --- finding 2: a real click during the busy window counts ---
  run({
    name: 'user clicks the picker while the script is busy',
    query: 'delay=2000',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForTimeout(900);
      await page.click('#picker'); // trusted click inside the script's busy window
      await page.waitForTimeout(3000);
    },
  }),
  // --- finding 3: loop guard ---
  run({ name: 'page keeps resetting the model', query: 'reset=1', waitForSwitch: false, act: (page) => page.waitForTimeout(21000) }),
  // --- finding 4a/4b: retries without DOM changes, counter reset on URL change ---
  run({
    name: 'menu never opens',
    query: 'nomenu=1',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForTimeout(29000); // five attempts
      await page.evaluate(() => {
        history.pushState(null, '', '/chat/conversation/xyz');
        document.body.appendChild(document.createElement('div'));
      });
      await page.waitForTimeout(8000);
    },
  }),
  // The menu never opens: the 3 s wait is the busy window and no DOM change follows. A hash flag that
  // arrives in that window must not be lost (only the re-run after the busy window can save it).
  run({
    name: 'hash change during a failing switch',
    query: 'nomenu=1',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        location.hash = '#nowork';
      });
      await page.waitForTimeout(7000);
    },
  }),
  // --- finding 12: the page flips a switch back by itself ---
  run({ name: 'page flips Work IQ back once', query: 'flipback=1', hash: '#nowork', waitForSwitch: false, act: (page) => page.waitForTimeout(6000) }),
  run({ name: 'page flips Work IQ back every time', query: 'flipback=always', hash: '#nowork', waitForSwitch: false, act: (page) => page.waitForTimeout(14000) }),
  run({
    name: 'user switches Work IQ on within the verify window',
    hash: '#nowork',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForTimeout(1800);
      await page.click('#w'); // real (trusted) user click
      await page.waitForTimeout(5000);
    },
  }),
  run({
    name: 'hash change during a successful switch',
    query: 'delay=2000',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        location.hash = '#nowork';
      });
      await page.waitForTimeout(7000);
    },
  }),
]);
await browser.close();

const by = Object.fromEntries(cases.map((c) => [c.name, c]));
const show = (c) => `label=${c.label} selected=${JSON.stringify(c.selected)} work=${c.work}/${c.wclicks} esc=${c.esc} active=${c.active} popovers=${c.popovers} log=[${c.lines.join(' | ')}]`;
const attempts = (c) => c.lines.filter((l) => /^attempt \d failed/.test(l));

for (const name of ['bottom model via submenu', 'submenu opens on hover only', 'submenu opens on click only', 'submenu opens on ArrowRight only']) {
  const c = by[name];
  check(`${name}: bottom model is chosen`, c.label === 'GPT-Z' && c.selected.length === 1 && c.selected[0] === 'GPT-Z' && c.popovers === 0, show(c));
}
{
  const c = by['last entry disabled'];
  check('last entry disabled: the last enabled entry is chosen', c.label === 'GPT-Y' && c.selected.join() === 'GPT-Y', show(c));
}
{
  const c = by['focus: chat input had it'];
  check('focus returns to the chat input after switching', c.active === 'input' && c.label === 'GPT-Z', show(c));
}
{
  const c = by['focus: nothing had it'];
  check('focus is not left on the picker if nothing had it before', c.active === 'BODY' && c.label === 'GPT-Z', show(c));
}
{
  const c = by['user chooses Auto, URL changes'];
  check('user choice "Auto" survives a URL change without reload (finding 1)', c.label === 'Auto' && c.selected.join() === 'GPT-Z,Auto', show(c));
}
{
  const c = by['user clicks the picker while the script is busy'];
  check('real user click during the busy window counts as user choice (finding 2)', c.lines.some((l) => l.includes('user selection detected')), show(c));
}
{
  const c = by['page keeps resetting the model'];
  check('loop guard: exactly 5 switches, then pause (finding 3)', c.selected.length === 5, show(c));
  check('loop guard: pause is logged', c.lines.some((l) => l.includes('pausing model switching for 120 s')), show(c));
}
{
  const c = by['menu never opens'];
  const n = attempts(c);
  check('failed attempts are retried without DOM changes, up to 5 (finding 4a)', n.slice(0, 5).map((l) => l[8]).join('') === '12345', show(c));
  check('after 5 failures no sixth attempt before the URL changes', !c.lines.some((l) => l.startsWith('attempt 6')), show(c));
  check('URL change resets the failure counter: attempts start again (finding 4b)', n.filter((l) => l.startsWith('attempt 1 failed')).length === 2, show(c));
  check('no Escape is sent to the chat input when no menu is open (finding 5)', c.esc === 0, show(c));
}
{
  const c = by['page flips Work IQ back once'];
  check('page flips Work IQ back once: the flag is applied again (finding 12)', c.work === 'false' && c.wclicks === 2, show(c));
  check('page flips Work IQ back once: re-apply is logged', c.lines.some((l) => l.includes('changed the switch for "#nowork" back')), show(c));
}
{
  const c = by['page flips Work IQ back every time'];
  check('page flips Work IQ back every time: bounded to 1 + 2 clicks, then the page wins', c.wclicks === 3 && c.work === 'true', show(c));
}
{
  const c = by['user switches Work IQ on within the verify window'];
  check('user switch within the verify window is respected: no re-apply', c.work === 'true' && c.wclicks === 2 && !c.lines.some((l) => l.includes('back by itself')), show(c));
}
{
  const c = by['hash change during a failing switch'];
  check('hash change during a failing switch is not lost (finding 4a)', c.work === 'false' && c.wclicks === 1, show(c));
}
{
  const c = by['hash change during a successful switch'];
  check('hash change during a successful switch is not lost', c.work === 'false' && c.wclicks === 1 && c.label === 'GPT-Z', show(c));
}

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exit(failedChecks.length ? 1 : 0);
