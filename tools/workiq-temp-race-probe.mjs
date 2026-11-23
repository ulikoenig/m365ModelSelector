// Probe WITHOUT userscript: does switching the temporary chat on reset Work IQ (or the model) a moment
// later? Real clicks, fresh browser per trial, timeline of every state change.
// Trials: A = Work IQ off, then temporary chat on
//         B = temporary chat on, Work IQ off 100 ms later
//         C = temporary chat on, Work IQ off 4 s later
import { launch, openChat } from './lib.mjs';

async function trial(name, steps) {
  const ctx = await launch();
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.addInitScript(() => {
    window.__tl = [];
    const t0 = performance.now();
    let last = '';
    const snap = () => {
      const wiq = [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked') ?? '-';
      const tmp = document.querySelector('button[aria-pressed][aria-label*="empor" i]')?.getAttribute('aria-pressed') ?? '-';
      const pk = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => /modell|model/i.test(b.getAttribute('aria-label') || ''));
      const model = pk ? (pk.textContent || '').replace(/\s+/g, ' ').trim() : '-';
      const now = `WorkIQ=${wiq}  tempChat=${tmp}  model=${model}`;
      if (now !== last) { window.__tl.push(`${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${now}`); last = now; }
    };
    const start = () => new MutationObserver(snap).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    if (document.documentElement) start(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
  });
  await openChat(p);
  await p.waitForTimeout(4000);
  const wiq = p.locator('button[role="switch"]:has-text("Work IQ")').first();
  const tmp = p.locator('button[aria-pressed][aria-label*="empor" i]').first();
  const mark = (what) => p.evaluate((w) => window.__tl.push('        ---- ' + w), what);
  await steps({ p, wiq, tmp, mark });
  await p.waitForTimeout(8000);
  console.log(`--- trial ${name} ---`);
  (await p.evaluate(() => window.__tl)).forEach((l) => console.log(l));
  await ctx.close();
}

await trial('A: Work IQ off, then temporary chat on', async ({ p, wiq, tmp, mark }) => {
  await mark('click Work IQ');
  await wiq.click();
  await p.waitForTimeout(2000);
  await mark('click temporary chat');
  await tmp.click();
});
await trial('B: temporary chat on, Work IQ off 100 ms later', async ({ p, wiq, tmp, mark }) => {
  await mark('click temporary chat');
  await tmp.click();
  await p.waitForTimeout(100);
  await mark('click Work IQ');
  await wiq.click();
});
await trial('C: temporary chat on, Work IQ off 4 s later', async ({ p, wiq, tmp, mark }) => {
  await mark('click temporary chat');
  await tmp.click();
  await p.waitForTimeout(4000);
  await mark('click Work IQ');
  await wiq.click();
});
