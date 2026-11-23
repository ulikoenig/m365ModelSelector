// Ende-zu-Ende-Test in Microsoft Edge (Playwright). Tampermonkey selbst lässt sich in Edge nicht
// automatisiert laden; das Userscript läuft daher unverändert als Init-Skript (@grant none, kein GM_*-API).
import fs from 'node:fs';
import path from 'node:path';
import { launch, openChat, root, out, pressKeysUntilSwitched } from '../tools/lib.mjs';

const scriptPath = path.join(root, 'm365-best-model.user.js');
const scriptSrc = fs.readFileSync(scriptPath, 'utf8');
const results = [];
let lastCheckName = '(Start)';
let lastWorkIq = null;
/** Diagnose: meldet jeden Wechsel des Work-IQ-Schalters samt der zuletzt abgeschlossenen Prüfung. */
const sampleWorkIq = async (p) => {
  const s = await p
    .evaluate(() => [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked') ?? 'missing')
    .catch(() => 'missing');
  if (s !== 'missing' && s !== lastWorkIq) {
    console.log(`INFO  Work IQ: ${lastWorkIq} -> ${s} (nach: "${lastCheckName}")`);
    lastWorkIq = s;
  }
};
const check = (name, ok, detail = '') => {
  lastCheckName = name;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// --- Kopf des Userscripts prüfen ---
const meta = scriptSrc.match(/==UserScript==([\s\S]*?)==\/UserScript==/)?.[1] ?? '';
const matches = [...meta.matchAll(/@match\s+(\S+)/g)].map((m) => m[1]);
const toRe = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
for (const url of [
  'https://copilot.cloud.microsoft/chat/',
  'https://copilot.cloud.microsoft/chat/?redirfrom=userTypeCookie',
  'https://copilot.cloud.microsoft/chat',
  'https://copilot.cloud.microsoft/chat?redirfrom=mcmToCcm', // Einstiegs-URL aus dem Firefox-Log
  'https://copilot.cloud.microsoft/chat/conversation/abc',
]) {
  check(`@match passt auf ${url}`, matches.some((g) => toRe(g).test(url)));
}
check('@match passt NICHT auf fremde Seite', !matches.some((g) => toRe(g).test('https://example.com/chat/')));
check('@grant none', /@grant\s+none/.test(meta));
check('@noframes gesetzt', /@noframes/.test(meta));
check('@run-at document-start (Hash so früh wie möglich einlesen)', /@run-at\s+document-start/.test(meta));

const ctx = await launch({ headless: process.env.HEADLESS === '1' });

const picker = (p) => p.locator('button[aria-label$="Modellauswahl"]');
const label = async (p) => {
  await sampleWorkIq(p);
  return ((await picker(p).first().textContent()) || '').replace(/\s+/g, ' ').trim();
};

/** Öffnet per echter Mausbedienung das Menü bis zur untersten Modellliste und liefert deren Radio-Einträge. */
async function openModelList(p) {
  await picker(p).click();
  const gpt = p.locator('[role="menuitem"][aria-haspopup="menu"]:visible').last();
  await gpt.hover();
  await p.waitForTimeout(1200);
  if ((await p.locator('[role="menuitemradio"]').count()) <= 3) {
    await gpt.click();
    await p.waitForTimeout(1200);
  }
  return p.locator('[role="menu"]:visible').last().locator('[role="menuitemradio"]');
}

// --- Orakel + Zurücksetzen auf Auto (ohne Skript, echte Mausbedienung) ---
const p0 = await ctx.newPage();
await openChat(p0);
await p0.waitForTimeout(2500);
const startLabel = await label(p0);
console.log('Ausgangszustand des Wählers:', startLabel);
const list0 = await openModelList(p0);
const names0 = (await list0.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
const oracle = names0[names0.length - 1];
console.log('Untermenü (Reihenfolge):', JSON.stringify(names0));
check('Orakel: unterster Eintrag ermittelt', !!oracle, oracle);
await p0.keyboard.press('Escape');
await p0.keyboard.press('Escape');
await picker(p0).click();
await p0.locator('[role="menuitemradio"]').first().click(); // "Auto"
await p0.waitForTimeout(1500);
check('Vorbereitung: Wähler steht auf Auto', /^auto$/i.test(await label(p0)), await label(p0));
await p0.close();

// --- Lauf mit Userscript ---
const consoleLines = [];
const p1 = await ctx.newPage();
p1.on('console', (m) => m.text().startsWith('[m365-best-model]') && consoleLines.push(m.text()));
await p1.addInitScript(() => {
  try { localStorage.setItem('m365-best-model-debug', '1'); } catch (_) {}
  // Messung: wie viele Frames war ein Menü-Popover tatsächlich sichtbar (Opazität > 0)?
  window.__menuVisibleFrames = 0;
  window.__sawAuto = 0;
  const loop = () => {
    for (const el of document.querySelectorAll('.fui-MenuPopover')) {
      if (el.getClientRects().length && parseFloat(getComputedStyle(el).opacity) > 0.05) window.__menuVisibleFrames++;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await p1.addInitScript({ content: scriptSrc });
await openChat(p1);

const switched = await (async () => {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (!/^auto$/i.test(await label(p1).catch(() => 'Auto'))) return true;
    await p1.waitForTimeout(300);
  }
  return false;
})();
const afterLabel = await label(p1);
check('Skript schaltet von Auto um', switched, afterLabel);
await p1.waitForTimeout(1000);
console.log('Wähler zeigt:', afterLabel);
check('Wähler zeigt das unterste Modell', oracle && afterLabel.toLowerCase().includes(oracle.split(' ').slice(0, 2).join(' ').toLowerCase()), `${afterLabel} vs. ${oracle}`);

const focusInfo = await p1.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, role: a?.getAttribute('role'), label: a?.getAttribute('aria-label') };
});
check('Fokus bleibt nach dem Umschalten nicht auf dem Modellwähler hängen', !/Modellauswahl/.test(focusInfo.label || ''), JSON.stringify(focusInfo));

const frames = await p1.evaluate(() => window.__menuVisibleFrames);
check('Menü blieb beim Umschalten unsichtbar (kein Flackern)', frames === 0, `sichtbare Frames: ${frames}`);
await p1.screenshot({ path: path.join(out, 'e2e-after-switch.png') });

// Gegenprobe über das Menü: unterster Eintrag ist als gewählt markiert (echte Mausbedienung = Eigenwahl-Modus, danach egal)
const list1 = await openModelList(p1);
const n = await list1.count();
const lastChecked = await list1.nth(n - 1).getAttribute('aria-checked');
check('Menü: unterster Eintrag ist aria-checked=true', lastChecked === 'true', `Einträge: ${n}`);
const popOpacity = await p1.evaluate(() => {
  const els = [...document.querySelectorAll('.fui-MenuPopover')].filter((e) => e.getClientRects().length);
  return els.length ? Math.min(...els.map((e) => parseFloat(getComputedStyle(e).opacity))) : -1;
});
check('Menü ist für den Nutzer sichtbar (Opazität 1, kein Verbergen übrig)', popOpacity === 1, `Opazität: ${popOpacity}`);
await p1.screenshot({ path: path.join(out, 'e2e-user-menu.png') });
await p1.keyboard.press('Escape');
await p1.keyboard.press('Escape');

// --- Eigenwahl respektieren: Nutzer wählt selbst "Auto" ---
await picker(p1).click();
await p1.locator('[role="menuitemradio"]').first().click();
await p1.waitForTimeout(7000);
check('Eigenwahl "Auto" wird bis zum Seitenwechsel respektiert', /^auto$/i.test(await label(p1)), await label(p1));

// --- Nach Neuladen greift die Automatik wieder ---
await p1.reload({ waitUntil: 'domcontentloaded' });
const again = await (async () => {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (!/^auto$/i.test(await label(p1).catch(() => 'Auto'))) return true;
    await p1.waitForTimeout(300);
  }
  return false;
})();
check('Nach Neuladen schaltet das Skript wieder um', again, await label(p1));

// --- SPA: Neuer Chat ---
await p1.waitForTimeout(1500);
const newChat = p1.getByText('Neuer Chat', { exact: true }).first();
if (await newChat.count()) {
  await newChat.click();
  await p1.waitForTimeout(6000);
  const l = await label(p1);
  check('Nach "Neuer Chat" steht der Wähler nicht auf Auto', !/^auto$/i.test(l), l);
} else {
  console.log('INFO  "Neuer Chat" nicht gefunden, SPA-Test übersprungen');
}

// --- Einstiegs-URL ohne Schrägstrich: /chat?redirfrom=mcmToCcm (so lädt die Seite im Firefox) ---
await p1.waitForTimeout(1000);
await picker(p1).click();
await p1.locator('[role="menuitemradio"]').first().click(); // zurück auf Auto
await p1.waitForTimeout(1000);
check('Vorbereitung 2: Wähler steht auf Auto', /^auto$/i.test(await label(p1)), await label(p1));
await p1.goto('https://copilot.cloud.microsoft/chat?redirfrom=mcmToCcm', { waitUntil: 'domcontentloaded' });
console.log('URL nach goto:', p1.url());
const viaQuery = await (async () => {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (!/^auto$/i.test(await label(p1).catch(() => 'Auto'))) return true;
    await p1.waitForTimeout(300);
  }
  return false;
})();
check('Umschalten auch über /chat?redirfrom=mcmToCcm', viaQuery, await label(p1).catch(() => '?'));

// --- Tastendrücke während des Umschaltens sperren die Automatik nicht (zweiter Review, B1) ---
// Das Skript öffnet das Menü unsichtbar; der Fokus liegt dann auf dem ersten Menüeintrag (gemessen mit
// tools/menu-probe.mjs). Ein echter Tastendruck in diesem Fenster darf nicht als Eigenwahl zählen.
await picker(p1).click();
await p1.locator('[role="menuitemradio"]').first().click(); // zurück auf Auto
await p1.waitForTimeout(1000);
const linesBeforeKeys = consoleLines.length;
await p1.goto('https://copilot.cloud.microsoft/chat/', { waitUntil: 'domcontentloaded' });
const typed = await pressKeysUntilSwitched(p1, 'ArrowDown');
await p1.waitForTimeout(1500);
check('Tastendrücke beim Umschalten: das Modell wird trotzdem umgeschaltet', typed.switched, `${typed.keys} Tasten, Wähler: ${await label(p1).catch(() => '?')}`);
check(
  'Tastendrücke beim Umschalten zählen nicht als Eigenwahl',
  !consoleLines.slice(linesBeforeKeys).some((l) => /Nutzerauswahl erkannt|user selection detected/.test(l)),
  consoleLines.slice(linesBeforeKeys).join(' | '),
);
const newChatAfterKeys = p1.getByText('Neuer Chat', { exact: true }).first();
if (await newChatAfterKeys.count()) {
  await newChatAfterKeys.click();
  await p1.waitForTimeout(6000);
  const l = await label(p1);
  check('Tastendrücke beim Umschalten: nach "Neuer Chat" schaltet das Skript wieder um', !/^auto$/i.test(l), l);
} else {
  console.log('INFO  "Neuer Chat" nicht gefunden, Folgeprüfung zu den Tastendrücken übersprungen');
}

// --- Temporärer Chat über #anonymous (echte Seite) ---
const tempToggle = (p) => p.locator('button[aria-pressed][aria-label*="empor" i]').first();
const pressed = async (p) => (await tempToggle(p).getAttribute('aria-pressed', { timeout: 2000 }).catch(() => 'missing'));
const waitPressed = async (p, want, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await pressed(p)) === want) return true;
    await p.waitForTimeout(300);
  }
  return false;
};
const waitModelSwitched = async (p, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!/^auto$/i.test(await label(p).catch(() => 'Auto'))) return true;
    await p.waitForTimeout(300);
  }
  return false;
};

await p1.goto('https://copilot.cloud.microsoft/chat/#anonymous', { waitUntil: 'domcontentloaded' });
check('#anonymous schaltet den temporären Chat ein', await waitPressed(p1, 'true'), `aria-pressed=${await pressed(p1)}`);
console.log('Hash nach dem Laden:', JSON.stringify(await p1.evaluate(() => location.hash)));
check('Modell-Umschaltung funktioniert auch im temporären Chat', await waitModelSwitched(p1), await label(p1).catch(() => '?'));
await p1.screenshot({ path: path.join(out, 'e2e-temporary-chat.png') });

await p1.goto('https://copilot.cloud.microsoft/chat/', { waitUntil: 'domcontentloaded' });
await p1.waitForTimeout(9000);
check('Ohne #anonymous bleibt der temporäre Chat aus', (await pressed(p1)) === 'false', `aria-pressed=${await pressed(p1)}`);

await p1.goto('https://copilot.cloud.microsoft/chat/#anonymous', { waitUntil: 'domcontentloaded' });
await waitPressed(p1, 'true');
await p1.waitForTimeout(1500);
await tempToggle(p1).click(); // Nutzer verlässt den temporären Chat selbst
await p1.waitForTimeout(6000);
check('Nach dem Verlassen wird der temporäre Chat nicht erneut gestartet', (await pressed(p1)) === 'false', `aria-pressed=${await pressed(p1)}`);

// --- Work IQ über #nowork und Kombinationen (echte Seite) ---
// Der Zustand gilt für die Browsersitzung des Testprofils; nach dem Neustart von Edge ist Work IQ wieder an.
const workSwitch = (p) => p.locator('button[role="switch"]:has-text("Work IQ")').first();
const workState = async (p) => (await workSwitch(p).getAttribute('aria-checked', { timeout: 2000 }).catch(() => 'missing'));
const waitWork = async (p, want, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await workState(p)) === want) return true;
    await p.waitForTimeout(300);
  }
  return false;
};
const gotoChat = async (hash) => {
  await p1.goto(`https://copilot.cloud.microsoft/chat/${hash}`, { waitUntil: 'domcontentloaded' });
  const end = Date.now() + 30_000;
  while (Date.now() < end && (await workState(p1)) === 'missing') await p1.waitForTimeout(300);
};

// Die Seite hält den Work-IQ-Zustand für die ganze Browsersitzung (Neuladen, andere Tabs). Jedes Szenario
// startet deshalb mit einem per echtem Nutzerklick sicher eingeschalteten Work IQ; sonst wären Prüfungen
// wertlos, bei denen Work IQ schon aus ist und das Skript nichts klicken muss.
const ensureWorkIqOn = async () => {
  await gotoChat('');
  await p1.waitForTimeout(3000);
  if ((await workState(p1)) !== 'true') {
    await workSwitch(p1).click();
    await p1.waitForTimeout(1500);
  }
  return (await workState(p1)) === 'true';
};

await ensureWorkIqOn();
await gotoChat('');
await p1.waitForTimeout(8000);
check('Ohne #nowork bleibt Work IQ an', (await workState(p1)) === 'true', `aria-checked=${await workState(p1)}`);

await ensureWorkIqOn();
await gotoChat('#nowork');
check('#nowork schaltet Work IQ aus (vorher an)', await waitWork(p1, 'false'), `aria-checked=${await workState(p1)}`);
check('#nowork: temporärer Chat bleibt unberührt', (await pressed(p1)) === 'false', `aria-pressed=${await pressed(p1)}`);
check('#nowork: Modell-Umschaltung funktioniert weiterhin', await waitModelSwitched(p1), await label(p1).catch(() => '?'));
await p1.screenshot({ path: path.join(out, 'e2e-nowork.png') });

for (const hash of ['#nowork,anonymous', '#anonymous,nowork']) {
  await ensureWorkIqOn();
  await gotoChat(hash);
  const workOff = await waitWork(p1, 'false');
  const tempOn = await waitPressed(p1, 'true');
  check(`${hash}: Work IQ aus UND temporärer Chat an`, workOff && tempOn, `Work IQ=${await workState(p1)}, aria-pressed=${await pressed(p1)}`);
  // Die Seite dreht Work IQ gelegentlich von selbst zurück (ohne Skript-Klick beobachtet); das Skript stellt
  // innerhalb von 6 s höchstens zweimal nach. Verlangt wird ein stabiler Endzustand, kein einzelner Moment.
  await p1.waitForTimeout(3000);
  await waitWork(p1, 'false', 8000);
  await p1.waitForTimeout(2000);
  check(`${hash}: Endzustand ist stabil (Work IQ aus, temporärer Chat an)`, (await workState(p1)) === 'false' && (await pressed(p1)) === 'true', `Work IQ=${await workState(p1)}, aria-pressed=${await pressed(p1)}`);
  check(`${hash}: Modell-Umschaltung funktioniert weiterhin`, await waitModelSwitched(p1), await label(p1).catch(() => '?'));
}
await p1.screenshot({ path: path.join(out, 'e2e-nowork-anonymous.png') });

await ensureWorkIqOn();
await gotoChat('#online');
await p1.waitForTimeout(8000);
check('#online hat keine Wirkung (Entscheidung: nur #nowork)', (await workState(p1)) === 'true' && (await pressed(p1)) === 'false', `Work IQ=${await workState(p1)}, aria-pressed=${await pressed(p1)}`);

await ensureWorkIqOn();
await gotoChat('#nowork');
await waitWork(p1, 'false');
await p1.waitForTimeout(1500);
await workSwitch(p1).click(); // Nutzer schaltet Work IQ selbst wieder ein
await p1.waitForTimeout(6000);
check('Nach dem Wiedereinschalten durch den Nutzer wird Work IQ nicht erneut ausgeschaltet', (await workState(p1)) === 'true', `aria-checked=${await workState(p1)}`);

// --- Abgelaufene Sitzung: der Server leitet vor jeder Seite auf die Anmeldung um, der Hash geht verloren ---
// Bekannte Grenze (siehe Skriptkopf): kein Skript kann den Hash dann sehen. Geprüft wird, dass das Skript
// danach trotzdem arbeitet (Modell wird umgeschaltet) und nichts Falsches tut.
let sawLogin = false;
p1.on('framenavigated', (f) => {
  if (f === p1.mainFrame() && /login\.microsoftonline\.com/.test(f.url())) sawLogin = true;
});
await ctx.clearCookies();
await openChat(p1, { url: 'https://copilot.cloud.microsoft/chat/#anonymous' });
if (sawLogin) {
  check('Nach Anmelde-Redirect schaltet das Skript das Modell trotzdem um', await waitModelSwitched(p1), await label(p1).catch(() => '?'));
  console.log(`INFO  Grenze bestätigt: nach dem Anmelde-Redirect ist der Hash weg, temporärer Chat aktiv: ${(await pressed(p1)) === 'true'} (erwartet: false)`);
} else {
  console.log('INFO  kein Anmelde-Redirect aufgetreten (stille Anmeldung), Szenario nicht aussagekräftig');
}

console.log('\nSkript-Log:\n  ' + consoleLines.join('\n  '));
await ctx.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden`);
process.exit(failed.length ? 1 : 0);
