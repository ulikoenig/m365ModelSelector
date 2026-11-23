// Mutation check for test/menu.mjs: re-introduces each reviewed bug into a copy of the script and
// requires that the matching check FAILS. A test that passes with and without the fix proves nothing.
// Usage: node tools/mutation-check.mjs            (all mutants, about 1 minute each)
//        node tools/mutation-check.mjs finding-1  (one mutant)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, out } from './lib.mjs';

const original = fs.readFileSync(path.join(root, 'm365-best-model.user.js'), 'utf8');

const MUTANTS = [
  {
    id: 'finding-1',
    what: 'user choice is bound to the full URL again',
    edits: [
      ['let userOverride = false;', 'let userOverride = false;\n  let overrideHref = null;'],
      ['if (userOverride || failures >= CFG.maxAttempts', 'if (overrideHref === location.href || failures >= CFG.maxAttempts'],
      ['      userOverride = true;\n      log(t.userSelection);', '      overrideHref = location.href;\n      log(t.userSelection);'],
    ],
    mustFail: 'survives a URL change',
  },
  {
    id: 'finding-2',
    what: 'user input is ignored while the script is busy',
    edits: [['if (!event.isTrusted) return;', 'if (!event.isTrusted || busy) return;']],
    mustFail: 'real user click during the busy window',
  },
  {
    id: 'finding-3',
    what: 'no loop guard',
    edits: [['    if (switchTimes.length < CFG.loopMax) return;', '    return;']],
    mustFail: 'loop guard: exactly 5 switches',
  },
  {
    id: 'finding-4a-retry',
    what: 'no retry after a failed attempt (only a DOM change would trigger another attempt)',
    edits: [
      ['        scheduleAfter(CFG.cooldownMs); // retry without waiting for the page to change\n', ''],
      ['      scheduleAfter(CFG.cooldownMs + 50); // retry without waiting for the page to change\n', ''],
    ],
    mustFail: 'failed attempts are retried',
  },
  {
    id: 'finding-4a-hash',
    what: 'no re-run after the busy window and no retry: a hash flag arriving meanwhile is lost',
    edits: [
      ['    if (rerunRequested) schedule();\n', ''],
      ['        scheduleAfter(CFG.cooldownMs); // retry without waiting for the page to change\n', ''],
      ['      scheduleAfter(CFG.cooldownMs + 50); // retry without waiting for the page to change\n', ''],
    ],
    mustFail: 'hash change during a failing switch',
  },
  {
    id: 'finding-12',
    what: 'a switch flipped back by the page is not applied again',
    edits: [['    reassertIfFlippedBack(action);\n', '']],
    mustFail: 'page flips Work IQ back once: the flag is applied again',
  },
  {
    id: 'finding-12-user',
    what: 'the user touching a switch does not stop the re-apply',
    edits: [['      if (el && el.contains(target)) action.touched = true; // the user operates this switch: hands off\n', '']],
    mustFail: 'user switch within the verify window is respected',
  },
  {
    id: 'finding-4b',
    what: 'failure counter is not reset when the URL changes',
    edits: [['      failures = 0; // a new page deserves fresh attempts\n', '']],
    mustFail: 'URL change resets the failure counter',
  },
  {
    id: 'finding-5a',
    what: 'focus is not restored',
    edits: [['      restoreFocus(previousFocus);\n', '']],
    mustFail: 'focus returns to the chat input',
  },
  {
    id: 'finding-5b',
    what: 'Escape is sent even if no menu is open',
    edits: [['    if (visibleMenus().length === 0) return;\n', '']],
    mustFail: 'no Escape is sent to the chat input',
  },
];

const only = process.argv[2];
fs.mkdirSync(path.join(out, 'mutants'), { recursive: true });
let bad = 0;

for (const m of MUTANTS.filter((x) => !only || x.id === only)) {
  let mutated = original;
  for (const [from, to] of m.edits) {
    if (!mutated.includes(from)) {
      console.log(`${m.id}: EDIT NOT APPLICABLE (text not found): ${JSON.stringify(from.slice(0, 60))}`);
      bad++;
      mutated = null;
      break;
    }
    mutated = mutated.replace(from, to);
  }
  if (mutated === null) continue;
  const file = path.join(out, 'mutants', `${m.id}.user.js`);
  fs.writeFileSync(file, mutated);

  const run = spawnSync(process.execPath, [path.join(root, 'test', 'menu.mjs')], {
    env: { ...process.env, M365_SCRIPT: file },
    encoding: 'utf8',
    timeout: 300_000,
  });
  const failed = (run.stdout || '').split('\n').filter((l) => l.startsWith('FAIL'));
  const caught = failed.some((l) => l.includes(m.mustFail));
  const extraOk = !m.alsoMustFail || failed.some((l) => l.includes(m.alsoMustFail));
  const ok = caught && extraOk;
  if (!ok) bad++;
  console.log(`${ok ? 'CAUGHT ' : 'MISSED '} ${m.id}: ${m.what}`);
  console.log(`         expected FAIL "${m.mustFail}"${m.alsoMustFail ? ` and "${m.alsoMustFail}"` : ''}; failing checks: ${failed.length ? failed.map((l) => l.slice(6, 80)).join(' | ') : 'none'}`);
}
console.log(bad ? `\n${bad} mutant(s) not caught` : '\nall mutants caught');
process.exit(bad ? 1 : 0);
