// Probe: how often does Work IQ turn off by itself while the page loads?
// Each iteration starts a FRESH browser (the Work IQ state lives for the browser session), loads the chat
// page, watches Work IQ / model / script messages for ~10 s and reports whether Work IQ ended up off.
// Usage: node tools/workiq-flip-rate.mjs --script --n 6      (with userscript)
//        node tools/workiq-flip-rate.mjs --control --n 6     (without userscript)
import fs from 'node:fs';
import path from 'node:path';
import { launch, openChat, root } from './lib.mjs';

const withScript = process.argv.includes('--script');
const nIdx = process.argv.indexOf('--n');
const n = nIdx > 0 ? Number(process.argv[nIdx + 1]) : 5;
const src = fs.readFileSync(path.join(root, 'm365-best-model.user.js'), 'utf8');

let flips = 0;
for (let i = 1; i <= n; i++) {
  const ctx = await launch();
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.addInitScript(() => {
    window.__tl = [];
    const t0 = performance.now();
    const push = (what) => window.__tl.push(`${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${what}`);
    const origLog = console.log.bind(console);
    console.log = (...a) => {
      if (String(a[0]).startsWith('[m365-best-model]')) push('SCRIPT: ' + a.slice(1).join(' '));
      origLog(...a);
    };
    try { localStorage.setItem('m365-best-model-debug', '1'); } catch (_) {}
    let last = '';
    const snap = () => {
      const wiq = [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked') ?? '-';
      const pk = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => /modell|model/i.test(b.getAttribute('aria-label') || ''));
      const model = pk ? (pk.textContent || '').replace(/\s+/g, ' ').trim() : '-';
      const now = `WorkIQ=${wiq}  model=${model}`;
      if (now !== last) { push(now); last = now; }
    };
    const start = () => new MutationObserver(snap).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    if (document.documentElement) start(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
  });
  if (withScript) await p.addInitScript({ content: src });
  await openChat(p);
  await p.waitForTimeout(10000);
  const tl = await p.evaluate(() => window.__tl);
  const finalWiq = await p.evaluate(() => [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked'));
  const flipped = finalWiq === 'false';
  if (flipped) flips++;
  console.log(`#${i} ${withScript ? 'script ' : 'control'}  final Work IQ=${finalWiq}${flipped ? '   <== FLIPPED' : ''}`);
  if (flipped) tl.forEach((l) => console.log('      ' + l));
  await ctx.close();
}
console.log(`=> ${flips}/${n} runs ended with Work IQ off (${withScript ? 'WITH' : 'WITHOUT'} userscript)`);
