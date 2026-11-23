// Diagnose: Seite mit Userscript laden, Konsole/Fehler und Wählerzustand ausgeben.
import fs from 'node:fs';
import path from 'node:path';
import { launch, openChat, root } from './lib.mjs';

const src = fs.readFileSync(path.join(root, 'm365-best-model.user.js'), 'utf8');
const ctx = await launch();
const p = await ctx.newPage();
p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
await p.addInitScript(() => {
  try { localStorage.setItem('m365-best-model-debug', '1'); } catch (e) { console.log('[m365-best-model] setItem-Fehler ' + e.name); }
});
await p.addInitScript({ content: src });
await openChat(p);
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(1500);
  const s = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) => /modell|model/i.test(x.getAttribute('aria-label') || ''));
    return { label: b?.textContent.trim(), aria: b?.getAttribute('aria-label'), htmlClass: document.documentElement.className, href: location.href.slice(0, 70) };
  });
  console.log(i, JSON.stringify(s));
}
await ctx.close();
