// Tests without login on mock pages served under the Copilot URL:
//  1. Localization: a model picker with an English label ("Model picker") that never opens a menu. The
//     script must find it, fail in a controlled way and report in the browser language
//     (German -> German, everything else -> English).
//  2. URL hash flags: #anonymous (temporary chat on) and #nowork (Work IQ off), alone and combined.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { root } from '../tools/lib.mjs';

const src = fs.readFileSync(path.join(root, 'm365-best-model.user.js'), 'utf8');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const meta = src.match(/==UserScript==([\s\S]*?)==\/UserScript==/)?.[1] ?? '';
check('header: @name and @name:de', /@name\s+\S/.test(meta) && /@name:de\s+\S/.test(meta));
check('header: @description and @description:de', /@description\s+\S/.test(meta) && /@description:de\s+\S/.test(meta));
{
  // German text (umlauts) is allowed only in the ":de" header lines and in the "de" message block.
  // Exception: double-quoted citations of real UI labels in comments, e.g. "Temporärer Chat".
  const lines = src.split('\n');
  const from = lines.findIndex((l) => /^\s*de: \{/.test(l));
  const to = lines.findIndex((l, i) => i > from && /^ {4}\},$/.test(l));
  const withoutQuotes = (l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? l.replace(/"[^"]*"/g, '') : l);
  const stray = lines
    .map((l, i) => ({ l: withoutQuotes(l), n: i + 1 }))
    .filter(({ l, n }) => /[äöüÄÖÜß]/.test(l) && !(n > from && n <= to + 1) && !/^\/\/ @[\w-]+:de\s/.test(l));
  check('German text only in :de header and "de" message block', from > 0 && stray.length === 0, stray.map((s) => `L${s.n}`).join(' '));
}

const cases = [
  { locale: 'de-DE', started: 'aktiv', failed: 'Fehlversuch 1: Modellmenü öffnete sich nicht' },
  { locale: 'de-AT', started: 'aktiv', failed: 'Fehlversuch 1: Modellmenü öffnete sich nicht' },
  { locale: 'en-US', started: 'active', failed: 'attempt 1 failed: model menu did not open' },
  { locale: 'fr-FR', started: 'active', failed: 'attempt 1 failed: model menu did not open' }, // fallback
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

// ---------- URL flags on a mock page ----------
// The mock rewrites the URL (drops the hash) right after loading, to prove the hash is remembered in
// memory (the real page keeps it). Query parameters steer the initial state:
//   late=1     both controls appear after 1.5 s
//   pressed=1  temporary chat starts switched on
//   work=0     Work IQ starts switched off
//   label=...  aria-label of the temporary-chat toggle (UI language)
// The Work IQ switch mimics the real one: role="switch", aria-checked, visible text "Work IQ" and an
// aria-label that changes with the state.
const mockFlagsPage = (url) => {
  const q = new URL(url).searchParams;
  const temp = `<button id="t" aria-label="${q.get('label') ?? 'Temporary chat'}" aria-pressed="${q.get('pressed') === '1'}"></button>`;
  const workOn = q.get('work') !== '0';
  const work = `<button id="w" type="button" role="switch" aria-checked="${workOn}" aria-label="${workOn ? 'Work IQ deaktivieren' : 'Work IQ aktivieren'}"><span>Work IQ</span></button>`;
  return `<!doctype html><meta charset="utf-8"><title>mock</title><body><script>
    window.__clicks = 0;
    window.__wclicks = 0;
    addEventListener('DOMContentLoaded', () => history.replaceState(null, '', location.pathname + location.search));
    function addControls() {
      document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(temp + work)});
      document.getElementById('t').addEventListener('click', (e) => {
        window.__clicks++;
        const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
        e.currentTarget.setAttribute('aria-pressed', String(!on));
      });
      document.getElementById('w').addEventListener('click', (e) => {
        window.__wclicks++;
        const on = e.currentTarget.getAttribute('aria-checked') === 'true';
        e.currentTarget.setAttribute('aria-checked', String(!on));
        e.currentTarget.setAttribute('aria-label', on ? 'Work IQ aktivieren' : 'Work IQ deaktivieren');
      });
    }
    ${q.get('late') ? 'setTimeout(addControls, 1500);' : "addEventListener('DOMContentLoaded', addControls);"}
  </script></body>`;
};

async function runMock({ name, locale = 'en-US', label, hash = '', query = '', then }) {
  const ctx = await browser.newContext({ locale });
  await ctx.route('https://copilot.cloud.microsoft/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: mockFlagsPage(route.request().url()) }),
  );
  const page = await ctx.newPage();
  const lines = [];
  page.on('console', (m) => m.text().startsWith('[m365-best-model]') && lines.push(m.text()));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('m365-best-model-debug', '1');
    } catch (_) {}
  });
  await page.addInitScript({ content: src });
  const params = new URLSearchParams(query);
  if (label) params.set('label', label);
  await page.goto(`https://copilot.cloud.microsoft/chat?${params}${hash}`);
  await page.waitForTimeout(3200);
  if (then) await then(page);
  const state = await page.evaluate(() => ({
    pressed: document.getElementById('t')?.getAttribute('aria-pressed'),
    clicks: window.__clicks,
    work: document.getElementById('w')?.getAttribute('aria-checked'),
    wclicks: window.__wclicks,
    hash: location.hash,
  }));
  await ctx.close();
  return { name, ...state, lines };
}

const userClick = (selector) => async (page) => {
  await page.click(selector); // real (trusted) user click
  await page.waitForTimeout(2500);
};

const flagCases = await Promise.all([
  // temporary chat (#anonymous)
  runMock({ name: 'de-DE #anonymous', locale: 'de-DE', label: 'Temporärer Chat', hash: '#anonymous' }),
  runMock({ name: 'en-US #anonymous', hash: '#anonymous' }),
  runMock({ name: '#Anonymous', hash: '#Anonymous' }),
  runMock({ name: 'no hash' }),
  runMock({ name: '#anonymous2', hash: '#anonymous2' }),
  runMock({ name: '#anonymous, already on', hash: '#anonymous', query: 'pressed=1' }),
  runMock({ name: '#anonymous, late', hash: '#anonymous', query: 'late=1' }),
  runMock({ name: '#anonymous, user leaves', hash: '#anonymous', then: userClick('#t') }),
  runMock({
    name: 'hashchange to #anonymous',
    then: async (page) => {
      await page.evaluate(() => (location.hash = '#anonymous'));
      await page.waitForTimeout(2500);
    },
  }),
  // Work IQ (#nowork)
  runMock({ name: 'en-US #nowork', hash: '#nowork' }),
  runMock({ name: 'de-DE #nowork', locale: 'de-DE', hash: '#nowork' }),
  runMock({ name: '#NoWork', hash: '#NoWork' }),
  runMock({ name: '#nowork, already off', hash: '#nowork', query: 'work=0' }),
  runMock({ name: '#nowork, late', hash: '#nowork', query: 'late=1' }),
  runMock({ name: '#nowork2', hash: '#nowork2' }),
  runMock({ name: '#online', hash: '#online' }),
  runMock({ name: '#nowork, user switches Work IQ on again', hash: '#nowork', then: userClick('#w') }),
  // combinations
  runMock({ name: '#nowork,anonymous', hash: '#nowork,anonymous' }),
  runMock({ name: '#anonymous,nowork', hash: '#anonymous,nowork' }),
  runMock({ name: '#nowork%2Canonymous', hash: '#nowork%2Canonymous' }),
  runMock({ name: '#nowork, anonymous (space)', hash: '#nowork,%20anonymous' }),
  runMock({ name: '#nowork,unknown,anonymous', hash: '#nowork,unknown,anonymous' }),
  runMock({ name: '#,nowork,', hash: '#,nowork,' }),
  runMock({ name: '#nowork,anonymous, late', hash: '#nowork,anonymous', query: 'late=1' }),
  runMock({
    name: 'hashchange to #nowork,anonymous',
    then: async (page) => {
      await page.evaluate(() => (location.hash = '#nowork,anonymous'));
      await page.waitForTimeout(2500);
    },
  }),
]);
const flag = Object.fromEntries(flagCases.map((c) => [c.name, c]));
const show = (c) => `temp=${c.pressed}/${c.clicks} work=${c.work}/${c.wclicks} hash="${c.hash}" log=[${c.lines.map((l) => l.replace('[m365-best-model] ', '')).join(' | ')}]`;
const has = (c, text) => c.lines.some((l) => l.endsWith(text));
const tempOn = (c) => c.pressed === 'true' && c.clicks === 1;
const tempUntouched = (c, state = 'false') => c.pressed === state && c.clicks === 0;
const workOff = (c) => c.work === 'false' && c.wclicks === 1;
const workUntouched = (c) => c.work === 'true' && c.wclicks === 0;
const order = (c, first, second) => c.lines.findIndex((l) => l.endsWith(first)) >= 0 && c.lines.findIndex((l) => l.endsWith(first)) < c.lines.findIndex((l) => l.endsWith(second));

// --- temporary chat ---
{
  const c = flag['de-DE #anonymous'];
  check('#anonymous: temporary chat on (German label), Work IQ untouched', tempOn(c) && workUntouched(c), show(c));
  check('#anonymous: German log message', has(c, 'temporärer Chat gestartet'), show(c));
  check('#anonymous: works although the page rewrote the URL (hash remembered)', c.hash === '' && tempOn(c), show(c));
}
{
  const c = flag['en-US #anonymous'];
  check('#anonymous: temporary chat on (English label), Work IQ untouched', tempOn(c) && workUntouched(c), show(c));
  check('#anonymous: English log message', has(c, 'temporary chat started'), show(c));
}
check('#Anonymous works as well', tempOn(flag['#Anonymous']), show(flag['#Anonymous']));
check('no hash: nothing is clicked', tempUntouched(flag['no hash']) && workUntouched(flag['no hash']), show(flag['no hash']));
check('#anonymous2 (other word): nothing is clicked', tempUntouched(flag['#anonymous2']) && workUntouched(flag['#anonymous2']), show(flag['#anonymous2']));
{
  const c = flag['#anonymous, already on'];
  check('#anonymous, already on: not toggled off, no click', tempUntouched(c, 'true'), show(c));
  check('#anonymous, already on: "already active" log message', has(c, 'temporary chat is already active'), show(c));
}
check('#anonymous: controls appearing late are still handled', tempOn(flag['#anonymous, late']), show(flag['#anonymous, late']));
check('#anonymous: not started again after the user left it', flag['#anonymous, user leaves'].pressed === 'false' && flag['#anonymous, user leaves'].clicks === 2, show(flag['#anonymous, user leaves']));
check('hashchange to #anonymous switches temporary chat on', tempOn(flag['hashchange to #anonymous']), show(flag['hashchange to #anonymous']));

// --- Work IQ ---
{
  const c = flag['en-US #nowork'];
  check('#nowork: Work IQ off, temporary chat untouched', workOff(c) && tempUntouched(c), show(c));
  check('#nowork: English log message', has(c, 'Work IQ switched off'), show(c));
}
{
  const c = flag['de-DE #nowork'];
  check('#nowork: Work IQ off (German UI)', workOff(c), show(c));
  check('#nowork: German log message', has(c, 'Work IQ ausgeschaltet'), show(c));
}
check('#NoWork works as well', workOff(flag['#NoWork']), show(flag['#NoWork']));
{
  const c = flag['#nowork, already off'];
  check('#nowork, already off: not switched on, no click', c.work === 'false' && c.wclicks === 0, show(c));
  check('#nowork, already off: "already off" log message', has(c, 'Work IQ is already off'), show(c));
}
check('#nowork: controls appearing late are still handled', workOff(flag['#nowork, late']), show(flag['#nowork, late']));
check('#nowork2 (other word): nothing is clicked', workUntouched(flag['#nowork2']) && tempUntouched(flag['#nowork2']), show(flag['#nowork2']));
check('#online: no effect (decision: only #nowork is the keyword)', workUntouched(flag['#online']) && tempUntouched(flag['#online']), show(flag['#online']));
{
  const c = flag['#nowork, user switches Work IQ on again'];
  check('#nowork: not switched off again after the user switched it on', c.work === 'true' && c.wclicks === 2, show(c));
}

// --- combinations ---
for (const name of ['#nowork,anonymous', '#anonymous,nowork']) {
  const c = flag[name];
  check(`${name}: temporary chat on AND Work IQ off`, tempOn(c) && workOff(c), show(c));
  check(`${name}: fixed execution order (temporary chat first, then Work IQ)`, order(c, 'temporary chat started', 'Work IQ switched off'), show(c));
}
check('#nowork%2Canonymous (encoded comma): both', tempOn(flag['#nowork%2Canonymous']) && workOff(flag['#nowork%2Canonymous']), show(flag['#nowork%2Canonymous']));
check('#nowork, anonymous (space after comma): both', tempOn(flag['#nowork, anonymous (space)']) && workOff(flag['#nowork, anonymous (space)']), show(flag['#nowork, anonymous (space)']));
check('#nowork,unknown,anonymous (unknown flag ignored): both', tempOn(flag['#nowork,unknown,anonymous']) && workOff(flag['#nowork,unknown,anonymous']), show(flag['#nowork,unknown,anonymous']));
check('#,nowork, (empty parts ignored): Work IQ off', workOff(flag['#,nowork,']) && tempUntouched(flag['#,nowork,']), show(flag['#,nowork,']));
check('#nowork,anonymous with late controls: both', tempOn(flag['#nowork,anonymous, late']) && workOff(flag['#nowork,anonymous, late']), show(flag['#nowork,anonymous, late']));
check('hashchange to #nowork,anonymous: both', tempOn(flag['hashchange to #nowork,anonymous']) && workOff(flag['hashchange to #nowork,anonymous']), show(flag['hashchange to #nowork,anonymous']));

// ---------- Localization of the model-picker messages ----------
await Promise.all(
  cases.map(async ({ locale, started, failed }) => {
    const ctx = await browser.newContext({ locale });
    await ctx.route('https://copilot.cloud.microsoft/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>mock</title><body><button aria-haspopup="menu" aria-label="Auto, Model picker">Auto</button></body>',
      }),
    );
    const page = await ctx.newPage();
    const lines = [];
    page.on('console', (m) => m.text().startsWith('[m365-best-model]') && lines.push(m.text()));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('m365-best-model-debug', '1');
      } catch (_) {}
    });
    await page.addInitScript({ content: src });
    await page.goto('https://copilot.cloud.microsoft/chat?redirfrom=mcmToCcm');
    await page.waitForTimeout(5000);
    check(`${locale}: start message "${started}"`, lines.some((l) => l.endsWith(' ' + started)), lines.join(' | '));
    check(`${locale}: error message "${failed}"`, lines.some((l) => l.includes(failed)), lines.join(' | '));
    await ctx.close();
  }),
);
await browser.close();

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exit(failedChecks.length ? 1 : 0);
