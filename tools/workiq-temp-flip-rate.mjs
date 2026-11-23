// Probe WITHOUT userscript: after switching the temporary chat on (one real click) and touching nothing else,
// how often does the page change Work IQ by itself? Fresh browser per run, state changes with timestamps.
// Usage: node tools/workiq-temp-flip-rate.mjs [n]
import { launch, openChat } from './lib.mjs';

const n = Number(process.argv[2] || 5);
let flips = 0;
for (let i = 1; i <= n; i++) {
  const ctx = await launch();
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.addInitScript(() => {
    window.__tl = [];
    let t0 = performance.now();
    window.__resetClock = () => { t0 = performance.now(); };
    let last = '';
    const snap = () => {
      const wiq = [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked') ?? '-';
      const tmp = document.querySelector('button[aria-pressed][aria-label*="empor" i]')?.getAttribute('aria-pressed') ?? '-';
      const now = `WorkIQ=${wiq}  tempChat=${tmp}`;
      if (now !== last) { window.__tl.push(`${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${now}`); last = now; }
    };
    const start = () => new MutationObserver(snap).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    if (document.documentElement) start(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
  });
  await openChat(p);
  await p.waitForTimeout(5000);
  await p.evaluate(() => window.__resetClock()); // t = 0 at the click
  await p.locator('button[aria-pressed][aria-label*="empor" i]').first().click();
  await p.waitForTimeout(10000);
  const tl = await p.evaluate(() => window.__tl);
  const finalWiq = await p.evaluate(() => [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked'));
  const flipped = finalWiq === 'false';
  if (flipped) flips++;
  console.log(`#${i}  final Work IQ=${finalWiq}${flipped ? '   <== changed by the page' : ''}`);
  tl.filter((l) => !/^\s*\d+ ms  WorkIQ=-/.test(l)).slice(-4).forEach((l) => console.log('      ' + l));
  await ctx.close();
}
console.log(`=> ${flips}/${n} runs ended with Work IQ off after only switching the temporary chat on`);
