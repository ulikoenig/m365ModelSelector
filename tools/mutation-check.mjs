// Mutation check for test/menu.mjs: re-introduces each reviewed bug (or removes each safeguard) in a copy of
// the script and requires that the matching check FAILS. A test that passes with and without the fix proves
// nothing.
//
// Safeguards against false "caught" reports:
//   - a baseline run on the unmodified script must be green first;
//   - every edit must match exactly once, and the mutant must pass `node --check` (a script that does not run
//     fails nearly every check and would "catch" everything);
//   - the checks that fail must be the expected ones: `mustFail` (each pattern needs a failing check) plus the
//     explicitly allowed `mayFail`; any other failing check is reported as collateral;
//   - an equivalent mutant (behaves the same, so no test can tell) is declared as such and must pass everything.
//
// The checks of test/menu.mjs are timing based: do not run other tests or heavy programs at the same time, and
// keep --jobs at 3 or 4 at most (a loaded machine makes timing-sensitive checks fail for the wrong reason).
// Takes about 10 minutes for all mutants; with the default Bash/CI timeouts run it in two halves by listing ids.
//
// Usage: node tools/mutation-check.mjs                       (baseline, then all mutants, 3 in parallel)
//        node tools/mutation-check.mjs finding-1 b7-touched  (only these mutants)
//        node tools/mutation-check.mjs --jobs 1              (serial)
//        node tools/mutation-check.mjs --dry                 (only check that the edits apply and the mutants parse)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root, out } from './lib.mjs';

const run = promisify(execFile);
const originalFile = path.join(root, 'm365-best-model.user.js');
const original = fs.readFileSync(originalFile, 'utf8');

const MUTANTS = [
  // ---------------- first review ----------------
  {
    id: 'finding-1',
    what: 'user choice is bound to the full URL again',
    edits: [
      ['let userOverride = false;', 'let userOverride = false;\n  let overrideHref = null;'],
      ['if (userOverride || failures >= CFG.maxAttempts', 'if (overrideHref === location.href || failures >= CFG.maxAttempts'],
      ['      userOverride = true;\n      log(t.userSelection);', '      overrideHref = location.href;\n      log(t.userSelection);'],
    ],
    mustFail: ['survives a URL change'],
    mayFail: ['leaves the focus alone'],
  },
  {
    id: 'finding-2',
    what: 'user input is ignored while the script is busy',
    edits: [['if (!event.isTrusted) return;', 'if (!event.isTrusted || busy) return;']],
    mustFail: ['real user click during the busy window'],
    // The mutant also drops user touches of the switches while the script is busy.
    mayFail: ['leaves the focus alone', 'user switch within the verify window is respected', 'user switch while the flag is still pending'],
  },
  {
    id: 'finding-3',
    what: 'no loop guard',
    edits: [['    if (switchTimes.length < CFG.loopMax) return;', '    return;']],
    mustFail: ['loop guard: exactly 5 switches'],
    mayFail: ['loop guard: pause is logged', 'resumes by itself'],
  },
  {
    id: 'finding-4a-retry',
    what: 'no retry after a failed attempt (only a DOM change would trigger another attempt)',
    edits: [
      ['        scheduleAfter(CFG.cooldownMs); // retry without waiting for the page to change\n', ''],
      ['      scheduleAfter(CFG.cooldownMs + 50); // retry without waiting for the page to change\n', ''],
    ],
    mustFail: ['failed attempts are retried'],
    mayFail: ['no sixth attempt', 'no Escape is sent', 'URL change resets the failure counter'],
  },
  {
    id: 'finding-4a-hash',
    what: 'no re-run after the busy window and no retry: a hash flag arriving meanwhile is lost',
    edits: [
      ['    if (rerunRequested) schedule();\n', ''],
      ['        scheduleAfter(CFG.cooldownMs); // retry without waiting for the page to change\n', ''],
      ['      scheduleAfter(CFG.cooldownMs + 50); // retry without waiting for the page to change\n', ''],
    ],
    mustFail: ['hash change during a failing switch'],
    mayFail: ['failed attempts are retried', 'no sixth attempt', 'no Escape is sent', 'URL change resets the failure counter'],
  },
  {
    id: 'finding-12',
    what: 'a switch flipped back by the page is not applied again',
    edits: [['    reassertIfFlippedBack(action);\n', '']],
    mustFail: ['page flips Work IQ back once: the flag is applied again'],
    mayFail: ['re-apply is logged', 'bounded to 1 + 2 clicks', 'aria-checked is noticed', 'aria-pressed change is noticed', 'aria-checked only'],
  },
  {
    id: 'finding-12-user',
    what: 'the user touching a switch does not stop the re-apply',
    edits: [['        if (el && el.contains(target)) action.touched = true; // the user operates this switch: hands off\n', '']],
    mustFail: ['user switch within the verify window is respected'],
    mayFail: ['user switch while the flag is still pending'],
  },
  {
    id: 'finding-4b',
    what: 'failure counter is not reset when the URL changes',
    edits: [['      failures = 0; // a new page deserves fresh attempts\n', '']],
    mustFail: ['URL change resets the failure counter'],
  },
  {
    id: 'finding-5a',
    what: 'focus is not restored',
    edits: [['      if (!userOverride) restoreFocus(previousFocus); // the user operated the menu meanwhile: the focus is theirs\n', '']],
    mustFail: ['focus returns to the chat input'],
    // Without the restore the focus simply stays where the menu left it (on the picker).
    mayFail: ['re-rendered chat input', 'focus is not left on the picker if nothing had it before'],
  },
  {
    id: 'finding-5b',
    what: 'Escape is sent even if no menu is open',
    edits: [['    if (visibleMenus().length === 0) return;\n', '']],
    mustFail: ['no Escape is sent to the chat input'],
  },
  // ---------------- second review ----------------
  {
    id: 'b1-busy-keys',
    what: 'a key pressed while the script drives the menu counts as the user\'s choice again',
    edits: [['    if (isKey && (busy || !MENU_KEYS.has(event.key))) return;', '    if (isKey && !MENU_KEYS.has(event.key)) return;']],
    mustFail: ['a key pressed while the script drives the menu'],
  },
  {
    id: 'b2-keys',
    what: 'every key (Tab, typing) on the picker counts as the user\'s choice again',
    edits: [['    if (isKey && (busy || !MENU_KEYS.has(event.key))) return;', '    if (isKey && busy) return;']],
    mustFail: ['Tab on the picker is not a choice'],
  },
  {
    id: 'b2-owner',
    what: 'a radio entry of any menu on the page counts as the user\'s choice again',
    edits: [['(picker.contains(target) || inPickerMenu(target, picker))', '(picker.contains(target) || target.closest(\'[role="menuitemradio"]\'))']],
    mustFail: ['a radio entry of an unrelated menu is not a choice'],
  },
  {
    id: 'b2-chain',
    what: 'the aria-labelledby chain never leads to the picker',
    edits: [['      if (picker.contains(owner)) return true;\n', '      if (false) return true;\n']],
    mustFail: ['a click on a submenu entry is a choice'],
  },
  {
    id: 'b2-depth',
    what: 'the aria-labelledby chain is not followed from a submenu to the main menu',
    edits: [['      node = owner;\n', '      return false;\n']],
    mustFail: ['a click on a submenu entry is a choice'],
  },
  {
    id: 'b2-fallback',
    what: 'a menu without a label never counts, even while the picker is expanded',
    edits: [["      if (!owner) return picker.getAttribute('aria-expanded') === 'true';\n", '      if (!owner) return false;\n']],
    mustFail: ['a click in an unlabelled menu is a choice'],
  },
  {
    id: 'b7-touched',
    what: 'a pending action ignores that the user touched the switch',
    edits: [
      [
        "    if (action.pending && action.touched) {\n      // The user operates this switch themselves: what the user does always wins, the flag is dropped.\n      action.pending = false;\n      log(t.handsOff(action.flag));\n      return;\n    }\n",
        '',
      ],
    ],
    mustFail: ['user switch while the flag is still pending is not undone'],
  },
  {
    id: 'b6-maxwait',
    what: 'the debounce has no maximum wait: a constantly changing page starves the script',
    edits: [['    const wait = Math.max(0, Math.min(CFG.debounceMs, firstTriggerAt + CFG.maxWaitMs - now));', '    const wait = CFG.debounceMs;']],
    mustFail: ['a page that changes every 100 ms does not starve the script'],
  },
  {
    id: 'b9-override',
    what: 'the focus is pulled back even after the user operated the model menu',
    edits: [['      if (!userOverride) restoreFocus(previousFocus); // the user operated the menu meanwhile: the focus is theirs\n', '      restoreFocus(previousFocus);\n']],
    mustFail: ['after the user operated the menu the script leaves the focus alone'],
  },
  {
    id: 'b9-replaced',
    what: 'a re-rendered chat input is not found again by its id',
    edits: [['    const back = previous.isConnected ? previous : previous.id && document.getElementById(previous.id);', '    const back = previous.isConnected ? previous : null;']],
    mustFail: ['re-rendered chat input'],
  },
  {
    id: 'x-failcap',
    what: 'no cap on failed attempts',
    edits: [['if (userOverride || failures >= CFG.maxAttempts || Date.now() < pausedUntil) return;', 'if (userOverride || Date.now() < pausedUntil) return;']],
    mustFail: ['no sixth attempt follows before the URL changes'],
    mayFail: ['URL change resets the failure counter', 'failed attempts are retried'],
  },
  {
    id: 'x-pausetimer',
    what: 'no timer that ends the loop-guard pause: switching resumes only if the page happens to change',
    edits: [['    pauseTimer = setTimeout(schedule, CFG.loopPauseMs + 50);\n', '']],
    mustFail: ['switching resumes by itself when the pause is over'],
  },
  {
    id: 'x-loopwindow',
    what: 'old switches never leave the loop-guard window',
    edits: [['    switchTimes = switchTimes.filter((time) => now - time < CFG.loopWindowMs);\n', '']],
    mustFail: ['switches older than the window do not count'],
  },
  {
    id: 'x-verifywindow',
    what: 'the 6 s verify window never ends: a late flip by the page is fought',
    edits: [['    if (action.pending || action.touched || Date.now() >= action.verifyUntil) return;', '    if (action.pending || action.touched) return;']],
    mustFail: ['a flip after the verify window is left to the page'],
    // Without the window an action that was never requested counts as "in the window" too and fights the page
    // (here: #anonymous is switched on although the URL did not ask for it), which spoils the log check as well.
    mayFail: ['user switch within the verify window is respected'],
  },
  {
    id: 'x-attr-pressed',
    what: 'aria-pressed changes are not observed',
    edits: [["attributeFilter: ['aria-label', 'aria-pressed', 'aria-checked']", "attributeFilter: ['aria-label', 'aria-checked']"]],
    mustFail: ['the aria-pressed change is noticed'],
  },
  {
    id: 'x-attr-checked',
    what: 'aria-checked changes are not observed',
    edits: [["attributeFilter: ['aria-label', 'aria-pressed', 'aria-checked']", "attributeFilter: ['aria-label', 'aria-pressed']"]],
    mustFail: ['a flip that changes only aria-checked is noticed'],
  },
  {
    id: 'x-leftbymenu',
    what: 'the focus is restored even if the user moved it elsewhere',
    edits: [['    if (!leftByMenu) return;\n', '']],
    mustFail: ['focus the user moved elsewhere is left alone'],
  },
  {
    id: 'x-rerun-only',
    what: 'no re-run after the busy window (the retry stays)',
    equivalent:
      'every state change the script waits for is itself a DOM change that schedules another run after the busy window, and a failed attempt schedules a retry, so a trigger that arrives while busy is always picked up anyway',
    edits: [['    if (rerunRequested) schedule();\n', '']],
  },
];

// ---------------- command line ----------------
const args = process.argv.slice(2);
let jobs = 3;
let dry = false; // only apply the edits and parse the mutants, run no tests
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry') dry = true;
  else if (args[i] === '--jobs') jobs = Math.max(1, Number(args[++i]) || 1);
  else ids.push(args[i]);
}
const selected = MUTANTS.filter((m) => !ids.length || ids.includes(m.id));
const unknown = ids.filter((id) => !MUTANTS.some((m) => m.id === id));
if (unknown.length) {
  console.error('unknown mutant(s): ' + unknown.join(', '));
  process.exit(2);
}

fs.mkdirSync(path.join(out, 'mutants'), { recursive: true });

/** Runs test/menu.mjs against `file`; returns the failing check lines and whether the run finished. */
async function runMenuTest(file) {
  let stdout = '';
  try {
    ({ stdout } = await run(process.execPath, [path.join(root, 'test', 'menu.mjs')], {
      env: { ...process.env, M365_SCRIPT: file },
      timeout: 280_000,
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    stdout = error.stdout || '';
  }
  const lines = stdout.split('\n');
  return {
    finished: lines.some((l) => /checks passed/.test(l)),
    failed: lines.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(6).split('  ->')[0].trim()),
    passedCount: Number((stdout.match(/(\d+)\/\d+ checks passed/) || [])[1] ?? 0),
    total: Number((stdout.match(/\d+\/(\d+) checks passed/) || [])[1] ?? 0),
  };
}

// ---------------- baseline ----------------
console.log(`baseline: the unmodified script must pass everything (${selected.length} mutant(s) follow)`);
const base = dry ? { finished: true, failed: [], passedCount: 0, total: 0 } : await runMenuTest(originalFile);
if (!base.finished || base.failed.length) {
  console.log(`BASELINE NOT GREEN: ${base.finished ? base.failed.length + ' failing check(s): ' + base.failed.join(' | ') : 'the run did not finish'}`);
  console.log('Mutation results would mean nothing. Fix the tests or the script first.');
  process.exit(2);
}
console.log(`baseline green: ${base.passedCount}/${base.total} checks\n`);

// ---------------- mutants ----------------
async function check(m) {
  let mutated = original;
  for (const [from, to] of m.edits) {
    const count = mutated.split(from).length - 1;
    if (count !== 1) return { m, status: 'BAD EDIT', detail: `${count} match(es) instead of 1 for ${JSON.stringify(from.slice(0, 70))}` };
    mutated = mutated.replace(from, () => to);
  }
  const file = path.join(out, 'mutants', `${m.id}.user.js`);
  fs.writeFileSync(file, mutated);
  try {
    await run(process.execPath, ['--check', file], { timeout: 30_000 });
  } catch (error) {
    return { m, status: 'BROKEN', detail: 'the mutant does not parse: ' + String(error.stderr || error.message).split('\n').slice(0, 3).join(' ') };
  }

  if (dry) return { m, status: 'CAUGHT', detail: 'dry run: the edits apply once and the mutant parses' };
  const r = await runMenuTest(file);
  if (!r.finished) return { m, status: 'RUN FAILED', detail: 'the menu test did not finish' };
  if (m.equivalent) {
    return r.failed.length
      ? { m, status: 'NOT EQUIVALENT', detail: 'failing: ' + r.failed.join(' | ') }
      : { m, status: 'EQUIVALENT', detail: m.equivalent };
  }
  const missing = m.mustFail.filter((p) => !r.failed.some((f) => f.includes(p)));
  const allowed = [...m.mustFail, ...(m.mayFail || [])];
  const collateral = r.failed.filter((f) => !allowed.some((p) => f.includes(p)));
  if (missing.length) return { m, status: 'MISSED', detail: `no failing check for: ${missing.join(' | ')}; failing: ${r.failed.join(' | ') || 'none'}` };
  if (collateral.length) return { m, status: 'COLLATERAL', detail: `caught, but also failing: ${collateral.join(' | ')}` };
  return { m, status: 'CAUGHT', detail: `${r.failed.length} failing check(s)` };
}

const OK = new Set(['CAUGHT', 'EQUIVALENT']);
const results = new Array(selected.length);
let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < selected.length) {
      const i = next++;
      const r = await check(selected[i]);
      results[i] = r;
      console.log(`${r.status.padEnd(14)} ${r.m.id}: ${r.m.what}\n${' '.repeat(15)}${r.detail}`);
    }
  }),
);

const bad = results.filter((r) => !OK.has(r.status));
console.log(`\n${results.length - bad.length}/${results.length} mutants as expected${bad.length ? `, not as expected: ${bad.map((r) => r.m.id).join(', ')}` : ''}`);
process.exit(bad.length ? 1 : 0);
