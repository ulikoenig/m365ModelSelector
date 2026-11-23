// Tests without login on a mock page with a Fluent-like model menu (picker -> menu -> submenu), a
// Work IQ switch, a temporary-chat toggle and a chat input. The mock mimics the parts of the real page the
// script depends on (measured on the real page with tools/menu-probe.mjs): the menu opens in a popover
// (.fui-MenuPopover > [role="menu"]), the focus moves onto its first entry and returns to the picker when it
// closes, the picker carries aria-expanded while its menu is open, every menu is labelled (aria-labelledby)
// by its trigger, and Escape is read inside the popover only. Query parameters steer the scenario:
//   sub=hover|click|key  how the "GPT" entry opens its submenu (default: all three work)
//   lastDisabled=1       the last submenu entry is disabled
//   reset=1              the page resets the label to "Auto" 400 ms after every selection
//   nomenu=1             the picker does nothing (the menu never opens)
//   delay=<ms>           the menu opens only after this delay (long busy window)
//   hold=<ms>            the page applies a selection only after this delay (the menu stays open meanwhile)
//   nofocus=1            nothing has the keyboard focus at the start (default: the chat input has it)
//   startlabel=<text>    initial picker label (default: Auto)
//   nolabel=1            the model menus carry no aria-labelledby (aria-expanded is the only hint)
//   decoy=1              an unrelated visible menu with a radio entry is on the page
//   stealfocus=1         the page moves the focus to the "other" input 50 ms after a selection
//   replaceinput=1       the page replaces the chat input element during a selection
//   workoff=1            Work IQ starts switched off
//   latework=<ms>        the Work IQ switch is added to the page only after this delay
//   plainwork=1          the Work IQ aria-label does not change with its state (only aria-checked does)
//   flipback=1|always    the page switches Work IQ back on by itself after it was switched off
//   flipanon=1           the page switches the temporary chat back off by itself after it was switched on
//   flipdelay=<ms>       delay of those flips (default: 1200)
//   churn=<ms>           the page changes its DOM every <ms> ms (a busy page, e.g. a streaming answer)
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

// Whole-run watchdog: a hanging browser must fail the test, not block it.
setTimeout(() => {
  console.error('Watchdog: menu test aborted after 300 s');
  process.exit(2);
}, 300_000).unref();

const MOCK_SCRIPT = `
const Q = window.Q;
window.__selected = [];
window.__wclicks = 0;
window.__tclicks = 0;
window.__flips = 0;
window.__tflips = 0;
window.__flipsDone = 0;
window.__tflipsDone = 0;
window.__pickerClicks = 0;
window.__esc = 0;
window.__pendingChoice = false;
window.__holdStarted = false;
const picker = document.getElementById('picker');
const label = document.getElementById('pl');
const input = document.getElementById('input');
const other = document.getElementById('other');
if (Q.startlabel) label.textContent = Q.startlabel;
let menus = [];
let opening = false;
if (!Q.nofocus) addEventListener('DOMContentLoaded', () => input.focus());
input.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; });
window.__resetAuto = () => { label.textContent = 'Auto'; }; // the SPA resets the model, e.g. on a new chat

function closeAll() {
  for (const m of menus) m.pop.remove();
  menus = [];
  picker.removeAttribute('aria-expanded');
  picker.focus(); // like Fluent: the focus returns to the trigger
}
function makeMenu(items, left, owner) {
  const pop = document.createElement('div');
  pop.className = 'fui-MenuPopover';
  pop.style.cssText = 'position:fixed;top:80px;left:' + left + 'px;background:#fff;border:1px solid #888;padding:4px;z-index:9';
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  if (owner && !Q.nolabel) menu.setAttribute('aria-labelledby', owner); // labelled by its trigger, like the real page
  items.forEach((item) => menu.appendChild(item));
  pop.appendChild(menu);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); }); // Escape counts inside the popover only
  document.body.appendChild(pop);
  menus.push({ pop, menu });
  picker.setAttribute('aria-expanded', 'true');
  items[0].focus(); // like Fluent: the focus moves onto the first entry
  return menu;
}
function radio(text, checked, disabled) {
  const el = document.createElement('div');
  el.setAttribute('role', 'menuitemradio');
  el.setAttribute('aria-checked', String(Boolean(checked)));
  if (disabled) el.setAttribute('aria-disabled', 'true');
  el.tabIndex = 0;
  el.textContent = text;
  el.addEventListener('click', () => { if (!disabled) choose(text); });
  return el;
}
function choose(text) {
  const apply = () => {
    window.__pendingChoice = false;
    window.__selected.push(text);
    label.textContent = text;
    closeAll();
    if (Q.reset) setTimeout(() => { label.textContent = 'Auto'; }, 400);
    if (Q.stealfocus) setTimeout(() => other.focus(), 50);
    if (Q.replaceinput) { const old = document.getElementById('input'); old.replaceWith(old.cloneNode(true)); }
  };
  if (Number(Q.hold)) { window.__pendingChoice = true; window.__holdStarted = true; setTimeout(apply, Number(Q.hold)); } else apply();
}
function openSubmenu(trigger) {
  if (menus.length > 1) return;
  makeMenu([radio('GPT-A'), radio('GPT-B'), radio('GPT-Y'), radio('GPT-Z', false, Boolean(Q.lastDisabled))], 300, trigger.id);
}
picker.addEventListener('click', () => {
  window.__pickerClicks++;
  if (Q.nomenu || opening) return;
  if (menus.length) { closeAll(); return; }
  const build = () => {
    opening = false;
    const gpt = document.createElement('div');
    gpt.id = 'gpt';
    gpt.setAttribute('role', 'menuitem');
    gpt.setAttribute('aria-haspopup', 'menu');
    gpt.tabIndex = 0;
    gpt.textContent = 'GPT OpenAI';
    const mode = Q.sub || 'any';
    if (mode === 'any' || mode === 'hover') gpt.addEventListener('mouseover', () => openSubmenu(gpt));
    if (mode === 'any' || mode === 'click') gpt.addEventListener('click', () => openSubmenu(gpt));
    if (mode === 'any' || mode === 'key') gpt.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') openSubmenu(gpt); });
    makeMenu([radio('Auto', label.textContent === 'Auto'), radio('Fast'), radio('Deep'), gpt], 20, 'picker');
  };
  if (Number(Q.delay)) { opening = true; setTimeout(build, Number(Q.delay)); } else build();
});

const work = document.getElementById('w');
function setWork(on) {
  work.setAttribute('aria-checked', String(on));
  if (!Q.plainwork) work.setAttribute('aria-label', on ? 'Work IQ deaktivieren' : 'Work IQ aktivieren');
}
if (Q.workoff) setWork(false);
work.addEventListener('click', () => {
  window.__wclicks++;
  const wasOn = work.getAttribute('aria-checked') === 'true';
  setWork(!wasOn);
  // The page itself switches Work IQ back on (once, or every time) after flipdelay ms.
  if (Q.flipback && wasOn && (Q.flipback === 'always' || window.__flips < 1)) {
    window.__flips++;
    setTimeout(() => { setWork(true); window.__flipsDone++; }, Number(Q.flipdelay) || 1200);
  }
});
if (Q.latework) {
  const parent = work.parentNode;
  work.remove();
  setTimeout(() => parent.appendChild(work), Number(Q.latework));
}

const temp = document.getElementById('t');
temp.addEventListener('click', () => {
  window.__tclicks++;
  const wasOn = temp.getAttribute('aria-pressed') === 'true';
  temp.setAttribute('aria-pressed', String(!wasOn));
  if (Q.flipanon && !wasOn && window.__tflips < 1) {
    window.__tflips++;
    setTimeout(() => { temp.setAttribute('aria-pressed', 'false'); window.__tflipsDone++; }, Number(Q.flipdelay) || 1200);
  }
});

if (Q.churn) {
  const churn = document.createElement('div');
  churn.id = 'churn';
  document.body.appendChild(churn);
  setInterval(() => { churn.textContent = String(performance.now()); }, Number(Q.churn));
}
`;

const mockPage = (url) => {
  const q = Object.fromEntries(new URL(url).searchParams);
  const decoy = q.decoy
    ? '<span id="decoyLabel">Other menu</span><div id="decoy" role="menu" aria-labelledby="decoyLabel" style="display:inline-block;border:1px solid #888"><div id="decoyItem" role="menuitemradio" aria-checked="false" tabindex="0">Option</div></div>'
    : '';
  return `<!doctype html><meta charset="utf-8"><title>mock</title><body>
<input id="input" aria-label="Message"><input id="other" aria-label="Other">
<button id="t" type="button" aria-pressed="false" aria-label="Temporary chat">Temporary chat</button>
<button id="w" type="button" role="switch" aria-checked="true" aria-label="Work IQ deaktivieren"><span>Work IQ</span></button>
<button id="picker" type="button" aria-haspopup="menu" aria-label="Auto, Model picker"><span id="pl">Auto</span></button>
${decoy}
<script>window.Q = ${JSON.stringify(q)};</script><script>${MOCK_SCRIPT}</script></body>`;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });

const emptyState = { label: '?', selected: [], work: '?', wclicks: -1, tclicks: -1, tpressed: '?', esc: -1, active: '?', popovers: -1 };
const CASE_TIMEOUT_MS = 100_000;

/**
 * One scenario in its own browser context. `cfg` overrides numbers of the script's CFG block for this case
 * only (shorter pause or window, so the logic can be tested without waiting for the real durations); the
 * override fails loudly if it matches nothing. `act(page, h)` drives the scenario; `h.waitForLog(re, ms, n)`
 * waits for the script's debug log and `h.mark(name)` remembers how many log lines existed at that moment.
 */
async function run({ name, query = '', hash = '', waitForSwitch = true, cfg = {}, act }) {
  let source = src;
  for (const [key, value] of Object.entries(cfg)) {
    const re = new RegExp('(\\b' + key + ':\\s*)\\d+');
    if (!re.test(source)) throw new Error(`config override "${key}" matches nothing in the script (case "${name}")`);
    source = source.replace(re, (_, head) => head + value);
  }
  const lines = [];
  const marks = {};
  const h = {
    mark: (markName) => {
      marks[markName] = lines.length;
    },
    waitForLog: async (re, ms, count = 1) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (lines.filter((l) => re.test(l)).length >= count) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    },
  };
  const ctx = await browser.newContext({ locale: 'en-US' });
  try {
    await ctx.route('https://copilot.cloud.microsoft/**', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: mockPage(route.request().url()) }),
    );
    const page = await ctx.newPage();
    page.on('console', (m) => m.text().startsWith('[m365-best-model]') && lines.push(m.text().replace('[m365-best-model] ', '')));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('m365-best-model-debug', '1');
      } catch (_) {}
    });
    await page.addInitScript({ content: source });
    const scenario = (async () => {
      await page.goto(`https://copilot.cloud.microsoft/chat?${query}${hash}`);
      if (waitForSwitch) {
        await page.waitForFunction(() => document.getElementById('pl').textContent !== 'Auto', null, { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(900); // let the menu close and the focus settle
      }
      if (act) await act(page, h);
      return page.evaluate(() => ({
        label: document.getElementById('pl').textContent,
        selected: window.__selected,
        work: document.getElementById('w')?.getAttribute('aria-checked'),
        wclicks: window.__wclicks,
        tclicks: window.__tclicks,
        tpressed: document.getElementById('t').getAttribute('aria-pressed'),
        esc: window.__esc,
        active: document.activeElement?.id || document.activeElement?.tagName,
        popovers: document.querySelectorAll('.fui-MenuPopover').length,
      }));
    })();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('case timeout')), CASE_TIMEOUT_MS));
    const state = await Promise.race([scenario, timeout]);
    return { name, ...state, lines, marks };
  } catch (error) {
    console.log(`ERROR in case "${name}": ${String(error.message).split('\n')[0]}`);
    return { name, ...emptyState, lines, marks, error: true };
  } finally {
    await ctx.close();
  }
}

/** Runs the tasks with at most `limit` in parallel; the long ones should come first. */
async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
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

/** The SPA resets the model to Auto (new chat) and the script gets up to `ms` to switch it again. */
const resetThenWaitForSecondSwitch = async (page, ms = 8000) => {
  await page.evaluate(() => window.__resetAuto());
  await page.waitForFunction(() => window.__selected.length >= 2, null, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(300);
};

/** The SPA resets the model to Auto and the script is expected to leave it alone. */
const resetThenExpectNoSwitch = async (page) => {
  await page.evaluate(() => window.__resetAuto());
  await page.waitForTimeout(6000);
};

/** Waits until the script has clicked the picker, i.e. its busy window has started (independent of machine load). */
const waitForScriptBusy = (page) => page.waitForFunction(() => window.__pickerClicks >= 1, null, { timeout: 15_000 });

/** Waits until the page has flipped a switch back `count` times (a mock counter), then gives the script time to react. */
const afterFlips = (counter, count) => async (page) => {
  await page.waitForFunction(([name, n]) => window[name] >= n, [counter, count], { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(3500);
};

const specs = [
  // Long scenarios first so that the pool finishes early.
  // --- failed attempts: retried without DOM changes, capped at 5, counter reset by a URL change ---
  {
    name: 'menu never opens',
    query: 'nomenu=1',
    waitForSwitch: false,
    act: async (page, h) => {
      await h.waitForLog(/^attempt 5 failed/, 45_000);
      await page.waitForTimeout(9000); // a sixth attempt would start after 2.55 s and fail after 3 s more
      h.mark('beforeUrlChange');
      await page.evaluate(() => {
        history.pushState(null, '', '/chat/conversation/xyz');
        document.body.appendChild(document.createElement('div'));
      });
      await h.waitForLog(/^attempt 1 failed/, 14_000, 2);
    },
  },
  // --- loop guard ---
  {
    name: 'page keeps resetting the model',
    query: 'reset=1',
    waitForSwitch: false,
    act: async (page, h) => {
      await h.waitForLog(/pausing model switching for 120 s/, 40_000);
      await page.waitForTimeout(4000);
    },
  },
  {
    name: 'pause ends by itself',
    query: 'reset=1',
    cfg: { loopPauseMs: 3000 },
    waitForSwitch: false,
    act: async (page, h) => {
      await h.waitForLog(/pausing model switching for 3 s/, 40_000);
      await page.waitForFunction(() => window.__selected.length >= 6, null, { timeout: 12_000 }).catch(() => {});
    },
  },
  {
    name: 'switches older than the loop window do not count',
    query: 'reset=1',
    cfg: { loopWindowMs: 2000 },
    waitForSwitch: false,
    act: (page) => page.waitForFunction(() => window.__selected.length >= 6, null, { timeout: 40_000 }).catch(() => {}),
  },
  // --- the rule: bottom entry, submenu opening, disabled entries ---
  { name: 'bottom model via submenu' },
  { name: 'submenu opens on hover only', query: 'sub=hover' },
  { name: 'submenu opens on click only', query: 'sub=click' },
  { name: 'submenu opens on ArrowRight only', query: 'sub=key' },
  { name: 'last entry disabled', query: 'lastDisabled=1' },
  // --- focus ---
  { name: 'focus: chat input had it' },
  { name: 'focus: nothing had it', query: 'nofocus=1' },
  { name: 'focus: user moved it meanwhile', query: 'stealfocus=1' },
  { name: 'focus: page replaced the chat input', query: 'replaceinput=1' },
  // --- user choice ---
  { name: 'user chooses Auto, URL changes', act: user.choosesAutoThenUrlChanges },
  {
    name: 'user clicks the picker while the script is busy',
    query: 'delay=4000',
    cfg: { stepTimeoutMs: 8000 }, // the script waits long enough for the slow menu, the user's click lands inside that window
    waitForSwitch: false,
    act: async (page) => {
      await waitForScriptBusy(page);
      await page.click('#picker'); // trusted click inside the script's busy window
      await page.waitForFunction(() => window.__selected.length >= 1, null, { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'key during the busy window',
    query: 'hold=5000',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForFunction(() => window.__holdStarted === true, null, { timeout: 15_000 });
      await page.keyboard.press('ArrowDown'); // a real key while the script holds the menu: the focus sits on a menu entry
      await page.waitForFunction(() => window.__selected.length === 1, null, { timeout: 15_000 });
      await page.waitForTimeout(600);
      await resetThenWaitForSecondSwitch(page);
    },
  },
  {
    name: 'Tab on the picker',
    act: async (page) => {
      await page.focus('#picker');
      await page.keyboard.press('Tab');
      await resetThenWaitForSecondSwitch(page);
    },
  },
  {
    name: 'radio entry of an unrelated menu',
    query: 'decoy=1',
    act: async (page) => {
      await page.click('#decoyItem');
      await resetThenWaitForSecondSwitch(page);
    },
  },
  {
    name: 'Enter on the picker',
    act: async (page) => {
      await page.focus('#picker');
      await page.keyboard.press('Enter'); // opens the menu like a user would
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await resetThenExpectNoSwitch(page);
    },
  },
  {
    name: 'click on a submenu entry of the picker menu',
    query: 'startlabel=Fast',
    waitForSwitch: false,
    act: async (page) => {
      // The menu and the submenu are opened by the page (synthetic clicks); the user's first real input is the entry.
      await page.evaluate(() => document.getElementById('picker').click());
      await page.evaluate(() => document.getElementById('gpt').click());
      await page.click('[role="menuitemradio"]:has-text("GPT-B")');
      await resetThenExpectNoSwitch(page);
    },
  },
  {
    name: 'click on an entry of an unlabelled picker menu',
    query: 'startlabel=Fast&nolabel=1',
    waitForSwitch: false,
    act: async (page) => {
      await page.evaluate(() => document.getElementById('picker').click());
      await page.click('[role="menuitemradio"]:has-text("Deep")');
      await resetThenExpectNoSwitch(page);
    },
  },
  // --- the hash flag arrives while the script is busy ---
  {
    name: 'hash change during a failing switch',
    query: 'nomenu=1',
    // The script waits 8 s (instead of 3 s) for a menu that never opens, so the hash change lands inside the
    // busy window even on a loaded machine; a hash change that arrives after it would prove nothing.
    cfg: { stepTimeoutMs: 8000 },
    waitForSwitch: false,
    act: async (page) => {
      await waitForScriptBusy(page);
      await page.evaluate(() => {
        location.hash = '#nowork';
      });
      await page.waitForFunction(() => window.__wclicks >= 1, null, { timeout: 25_000 }).catch(() => {});
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'hash change during a successful switch',
    query: 'delay=2000',
    waitForSwitch: false,
    act: async (page) => {
      await waitForScriptBusy(page);
      await page.evaluate(() => {
        location.hash = '#nowork';
      });
      await page.waitForFunction(() => window.__wclicks >= 1 && window.__selected.length >= 1, null, { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(500);
    },
  },
  // --- switches: the page flips them back by itself, the user operates them ---
  { name: 'page flips Work IQ back once', query: 'flipback=1', hash: '#nowork', waitForSwitch: false, act: afterFlips('__flipsDone', 1) },
  { name: 'page flips Work IQ back every time', query: 'flipback=always', hash: '#nowork', waitForSwitch: false, act: afterFlips('__flipsDone', 3) },
  {
    name: 'page flips Work IQ back (aria-checked only)',
    query: 'flipback=1&flipdelay=2500&plainwork=1',
    hash: '#nowork',
    waitForSwitch: false,
    act: afterFlips('__flipsDone', 1),
  },
  {
    name: 'page flips Work IQ back after the verify window',
    query: 'flipback=1&flipdelay=3500',
    cfg: { verifyWindowMs: 2000 },
    hash: '#nowork',
    waitForSwitch: false,
    act: afterFlips('__flipsDone', 1),
  },
  {
    name: 'page flips the temporary chat back once',
    query: 'flipanon=1&flipdelay=2500',
    hash: '#anonymous',
    waitForSwitch: false,
    act: afterFlips('__tflipsDone', 1),
  },
  {
    name: 'user switches Work IQ on within the verify window',
    hash: '#nowork',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForFunction(() => window.__wclicks >= 1, null, { timeout: 8000 }); // the script switched it off
      await page.click('#w'); // real (trusted) user click
      await page.waitForTimeout(5000);
    },
  },
  {
    name: 'user switches Work IQ while the flag is still pending',
    query: 'workoff=1&latework=800&delay=6000',
    cfg: { stepTimeoutMs: 10_000 }, // the script waits for the slow menu, so it is busy while the switch appears and the user clicks it
    hash: '#nowork',
    waitForSwitch: false,
    act: async (page) => {
      // Work IQ appears (already off) while the script is busy with the slow model menu. The user flips it on
      // before the script got to look at it; the script must not undo that.
      await waitForScriptBusy(page);
      await page.waitForSelector('#w', { state: 'attached', timeout: 5000 });
      await page.click('#w');
      await page.waitForFunction(() => window.__selected.length === 1, null, { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(2500);
    },
  },
  // --- a page that changes all the time ---
  {
    name: 'busy page',
    query: 'churn=100',
    hash: '#nowork',
    waitForSwitch: false,
    act: async (page) => {
      await page.waitForFunction(() => window.__wclicks >= 1 && window.__selected.length >= 1, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
    },
  },
];

const cases = await pool(
  specs.map((spec) => async () => {
    let result = await run(spec);
    if (result.error) {
      console.log(`retrying case "${spec.name}" once`);
      result = await run(spec);
    }
    return result;
  }),
  12,
);
await browser.close();

const by = Object.fromEntries(cases.map((c) => [c.name, c]));
const show = (c) =>
  `label=${c.label} selected=${JSON.stringify(c.selected)} work=${c.work}/${c.wclicks} temp=${c.tpressed}/${c.tclicks} esc=${c.esc} active=${c.active} popovers=${c.popovers} log=[${c.lines.join(' | ')}]`;
const logHas = (c, re) => c.lines.some((l) => re.test(l));
const attempts = (c) => c.lines.filter((l) => /^attempt \d failed/.test(l));
const USER_SELECTION = /user selection detected/;

check('the script started in every case (a broken script must not pass the checks below by doing nothing)', cases.every((c) => c.lines.includes('active') && !c.error), cases.filter((c) => !c.lines.includes('active') || c.error).map((c) => c.name).join(', '));

for (const name of ['bottom model via submenu', 'submenu opens on hover only', 'submenu opens on click only', 'submenu opens on ArrowRight only']) {
  const c = by[name];
  check(`${name}: bottom model is chosen`, c.label === 'GPT-Z' && c.selected.length === 1 && c.selected[0] === 'GPT-Z' && c.popovers === 0, show(c));
}
{
  const c = by['last entry disabled'];
  check('last entry disabled: the last enabled entry is chosen', c.label === 'GPT-Y' && c.selected.join() === 'GPT-Y', show(c));
}

// --- focus ---
{
  const c = by['focus: chat input had it'];
  check('focus returns to the chat input after switching', c.active === 'input' && c.label === 'GPT-Z', show(c));
}
{
  const c = by['focus: nothing had it'];
  check('focus is not left on the picker if nothing had it before', c.active === 'BODY' && c.label === 'GPT-Z', show(c));
}
{
  const c = by['focus: user moved it meanwhile'];
  check('focus the user moved elsewhere is left alone (review 2, B9)', c.active === 'other' && c.label === 'GPT-Z', show(c));
}
{
  const c = by['focus: page replaced the chat input'];
  check('focus goes to the re-rendered chat input (found again by its id) (review 2, B9)', c.active === 'input' && c.label === 'GPT-Z', show(c));
}

// --- user choice ---
{
  const c = by['user chooses Auto, URL changes'];
  check('user choice "Auto" survives a URL change without reload (finding 1)', c.label === 'Auto' && c.selected.join() === 'GPT-Z,Auto', show(c));
}
{
  const c = by['user clicks the picker while the script is busy'];
  check('real user click during the busy window counts as user choice (finding 2)', logHas(c, USER_SELECTION), show(c));
  check('after the user operated the menu the script leaves the focus alone (review 2, B9)', c.active === 'picker', show(c));
}
{
  const c = by['key during the busy window'];
  check('a key pressed while the script drives the menu does not lock the automation (review 2, B1)', c.selected.length === 2 && !logHas(c, USER_SELECTION), show(c));
}
{
  const c = by['Tab on the picker'];
  check('Tab on the picker is not a choice: the automation keeps working (review 2, B2)', c.selected.length === 2 && !logHas(c, USER_SELECTION), show(c));
}
{
  const c = by['radio entry of an unrelated menu'];
  check('a radio entry of an unrelated menu is not a choice (review 2, B2)', c.selected.length === 2 && !logHas(c, USER_SELECTION), show(c));
}
{
  const c = by['Enter on the picker'];
  check('Enter on the picker is a choice: the model is left alone (review 2, B2)', c.selected.length === 1 && c.label === 'Auto' && logHas(c, USER_SELECTION), show(c));
}
{
  const c = by['click on a submenu entry of the picker menu'];
  check('a click on a submenu entry is a choice, found via the aria-labelledby chain (review 2, B2)', c.selected.join() === 'GPT-B' && c.label === 'Auto' && logHas(c, USER_SELECTION), show(c));
}
{
  const c = by['click on an entry of an unlabelled picker menu'];
  check('a click in an unlabelled menu is a choice while the picker is expanded (review 2, B2)', c.selected.join() === 'Deep' && c.label === 'Auto' && logHas(c, USER_SELECTION), show(c));
}

// --- loop guard ---
{
  const c = by['page keeps resetting the model'];
  check('loop guard: exactly 5 switches, then pause (finding 3)', c.selected.length === 5, show(c));
  check('loop guard: pause is logged', logHas(c, /pausing model switching for 120 s/), show(c));
}
{
  const c = by['pause ends by itself'];
  check('loop guard: switching resumes by itself when the pause is over (review 2, B3)', logHas(c, /pausing model switching for 3 s/) && c.selected.length >= 6, show(c));
}
{
  const c = by['switches older than the loop window do not count'];
  check('loop guard: switches older than the window do not count (review 2, B3)', c.selected.length >= 6 && !logHas(c, /pausing model switching/), show(c));
}

// --- failed attempts ---
{
  const c = by['menu never opens'];
  const n = attempts(c);
  const before = c.lines.slice(0, c.marks.beforeUrlChange ?? 0).filter((l) => /^attempt \d failed/.test(l));
  check('failed attempts are retried without DOM changes, up to 5 (finding 4a)', n.slice(0, 5).map((l) => l[8]).join('') === '12345', show(c));
  check('after 5 failures no sixth attempt follows before the URL changes (review 2, B3)', before.length === 5 && !logHas(c, /^attempt 6/), show(c));
  check('URL change resets the failure counter: attempts start again (finding 4b)', n.filter((l) => l.startsWith('attempt 1 failed')).length === 2, show(c));
  check('no Escape is sent to the chat input when no menu is open (finding 5)', n.length >= 5 && c.esc === 0, show(c));
}
// The menu never opens: the 3 s wait is a silent busy window. A hash flag arriving in it must not be lost.
// Two safeguards catch it: the retry after the failed attempt and the re-run after the busy window. Either
// alone would do here; only without both is the flag lost (mutant finding-4a-hash).
{
  const c = by['hash change during a failing switch'];
  check('hash change during a failing switch is not lost (finding 4a)', c.work === 'false' && c.wclicks === 1, show(c));
}
// After a successful switch the DOM change of the closing menu triggers another run anyway, so this case
// guards against a regression rather than proving the re-run (see the equivalent mutant rerun-only).
{
  const c = by['hash change during a successful switch'];
  check('hash change during a successful switch is not lost', c.work === 'false' && c.wclicks === 1 && c.label === 'GPT-Z', show(c));
}

// --- switches ---
{
  const c = by['page flips Work IQ back once'];
  check('page flips Work IQ back once: the flag is applied again (finding 12)', c.work === 'false' && c.wclicks === 2, show(c));
  check('page flips Work IQ back once: re-apply is logged', logHas(c, /changed the switch for "#nowork" back/), show(c));
}
{
  const c = by['page flips Work IQ back every time'];
  check('page flips Work IQ back every time: bounded to 1 + 2 clicks, then the page wins', c.wclicks === 3 && c.work === 'true', show(c));
}
{
  const c = by['page flips Work IQ back (aria-checked only)'];
  check('a flip that changes only aria-checked is noticed (review 2, B3)', c.work === 'false' && c.wclicks === 2, show(c));
}
{
  const c = by['page flips Work IQ back after the verify window'];
  check('a flip after the verify window is left to the page (review 2, B3)', c.work === 'true' && c.wclicks === 1, show(c));
}
{
  const c = by['page flips the temporary chat back once'];
  check('page flips the temporary chat back once: #anonymous is applied again, the aria-pressed change is noticed (review 2, B3/B8)', c.tpressed === 'true' && c.tclicks === 2, show(c));
}
{
  const c = by['user switches Work IQ on within the verify window'];
  check('user switch within the verify window is respected: no re-apply', c.work === 'true' && c.wclicks === 2 && !logHas(c, /back by itself/), show(c));
}
{
  const c = by['user switches Work IQ while the flag is still pending'];
  check('user switch while the flag is still pending is not undone (review 2, B7)', c.work === 'true' && c.wclicks === 1 && logHas(c, /operated the switch/), show(c));
}

// --- a page that changes all the time ---
{
  const c = by['busy page'];
  check('a page that changes every 100 ms does not starve the script (review 2, B6)', c.wclicks === 1 && c.work === 'false' && c.selected.length >= 1, show(c));
}

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
process.exit(failedChecks.length ? 1 : 0);
