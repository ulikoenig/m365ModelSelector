// Reproduktion auf der echten Seite: Ein Tastendruck, während das Skript das (unsichtbare) Modellmenü bedient,
// darf die Automatik nicht bis zum Neuladen sperren. Ablauf: ohne Skript auf Auto stellen, dann mit Skript laden
// und Pfeiltasten schicken, bis umgeschaltet ist; danach "Neuer Chat": das Skript muss erneut umschalten.
// Aufruf: node tools/b1-repro.mjs            (aktuelles Skript)
//         M365_SCRIPT=out/old.user.js node tools/b1-repro.mjs   (anderer Skriptstand)
// Es wird nichts gesendet; die Pfeiltasten verschieben höchstens den Fokus.
import fs from 'node:fs';
import path from 'node:path';
import { launch, openChat, root, pressKeysUntilSwitched } from './lib.mjs';

const watchdog = setTimeout(() => {
  console.error('Watchdog: Reproduktion nach 240 s abgebrochen');
  process.exit(2);
}, 240_000);

const scriptFile = path.resolve(process.env.M365_SCRIPT || path.join(root, 'm365-best-model.user.js'));
const src = fs.readFileSync(scriptFile, 'utf8');
const key = process.env.KEY || 'ArrowDown';
console.log('Skript:', path.relative(root, scriptFile), '| Taste:', key);

const ctx = await launch({ headless: true });
try {
  const picker = (p) => p.locator('button[aria-label$="Modellauswahl"]').first();
  const label = async (p) => ((await picker(p).textContent({ timeout: 2000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();

  // 1) Ohne Skript auf Auto stellen (echte Mausbedienung).
  const p0 = await ctx.newPage();
  await openChat(p0, { timeoutMs: 120_000 });
  await p0.waitForTimeout(2500);
  if (!/^auto$/i.test(await label(p0))) {
    await picker(p0).click();
    await p0.locator('[role="menuitemradio"]:visible').first().click();
    await p0.waitForTimeout(1500);
  }
  console.log('Ausgang:', await label(p0));
  await p0.close();

  // 2) Mit Skript laden und Tasten schicken, bis umgeschaltet ist.
  const p1 = await ctx.newPage();
  const lines = [];
  p1.on('console', (m) => m.text().startsWith('[m365-best-model]') && lines.push(m.text().replace('[m365-best-model] ', '')));
  await p1.addInitScript(() => {
    try {
      localStorage.setItem('m365-best-model-debug', '1');
    } catch (_) {}
  });
  await p1.addInitScript({ content: src });
  await p1.goto('https://copilot.cloud.microsoft/chat/', { waitUntil: 'domcontentloaded' });
  const result = await pressKeysUntilSwitched(p1, key);
  await p1.waitForTimeout(2000);
  console.log(`Tasten gesendet: ${result.keys}, umgeschaltet: ${result.switched}, Wähler: ${await label(p1)}`);
  console.log('Eigenwahl erkannt:', lines.some((l) => /user selection detected|Nutzerauswahl erkannt/.test(l)));

  // 3) Neuer Chat: setzt die Seite auf Auto zurück, das Skript muss wieder umschalten (sofern nicht gesperrt).
  await p1.waitForTimeout(1500);
  const newChat = p1.getByText('Neuer Chat', { exact: true }).first();
  if (await newChat.count()) {
    await newChat.click();
    await p1.waitForTimeout(7000);
    const after = await label(p1);
    console.log(`Nach "Neuer Chat": ${after} -> ${/^auto$/i.test(after) ? 'GESPERRT (Automatik aus)' : 'umgeschaltet'}`);
  } else {
    console.log('"Neuer Chat" nicht gefunden');
  }
  console.log('Log:\n  ' + lines.join('\n  '));
} finally {
  clearTimeout(watchdog);
  await ctx.close();
}
