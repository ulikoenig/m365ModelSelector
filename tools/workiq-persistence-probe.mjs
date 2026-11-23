// Probe WITHOUT userscript: is the Work IQ state kept SERVER-SIDE and applied late in a fresh browser?
// Phase 1: browser 1 loads the page and switches Work IQ OFF with a real click, waits, closes.
// Phase 2: browser 2 (fresh) loads the page and only watches Work IQ for 70 s (no interaction).
// Phase 3: browser 2 switches Work IQ back ON (real click) and closes; browser 3 watches 70 s.
import { launch, openChat } from './lib.mjs';

const SWITCH = 'button[role="switch"]:has-text("Work IQ")';
const recorder = () => {
  window.__tl = [];
  const t0 = performance.now();
  let last = '';
  const snap = () => {
    const w = [...document.querySelectorAll('button[role="switch"]')].find((b) => /^work\s*iq$/i.test((b.textContent || '').trim()))?.getAttribute('aria-checked') ?? '-';
    if (w !== last) { window.__tl.push(`${String(Math.round((performance.now() - t0) / 100) / 10).padStart(6)} s  WorkIQ=${w}`); last = w; }
  };
  const start = () => new MutationObserver(snap).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  if (document.documentElement) start(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
};

async function session(title, body) {
  const ctx = await launch();
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.addInitScript(recorder);
  await openChat(p);
  await p.waitForTimeout(3000);
  await body(p);
  console.log(`--- ${title} ---`);
  (await p.evaluate(() => window.__tl)).forEach((l) => console.log('  ' + l));
  await ctx.close();
}

await session('browser 1: switch Work IQ OFF (real click), wait 10 s', async (p) => {
  await p.locator(SWITCH).first().click();
  await p.waitForTimeout(10000);
});
await session('browser 2 (fresh): watch only, 70 s', async (p) => {
  await p.waitForTimeout(70000);
});
await session('browser 2b (fresh): ensure ON by real click if needed, then wait 10 s', async (p) => {
  const sw = p.locator(SWITCH).first();
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await p.waitForTimeout(10000);
});
await session('browser 3 (fresh): watch only, 70 s', async (p) => {
  await p.waitForTimeout(70000);
});
