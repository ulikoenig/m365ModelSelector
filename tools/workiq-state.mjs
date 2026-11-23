// Utility: print the Work IQ switch state after a fresh page load; optionally set it.
// Usage: node tools/workiq-state.mjs            -> print only
//        node tools/workiq-state.mjs --set on   -> make sure Work IQ is ON afterwards
//        node tools/workiq-state.mjs --set off  -> make sure Work IQ is OFF afterwards
import { launch, openChat } from './lib.mjs';

const i = process.argv.indexOf('--set');
const want = i > 0 ? process.argv[i + 1] : null;

const ctx = await launch();
const page = ctx.pages()[0] ?? (await ctx.newPage());
await openChat(page);
await page.waitForTimeout(4000);
const sw = page.locator('button[role="switch"]:has-text("Work IQ")').first();
const state = async () => (await sw.getAttribute('aria-checked', { timeout: 3000 }).catch(() => 'missing'));
console.log('Work IQ aria-checked after fresh load:', await state());
if (want === 'on' || want === 'off') {
  const target = want === 'on' ? 'true' : 'false';
  if ((await state()) !== target) {
    await sw.click();
    await page.waitForTimeout(6000); // give the page time to save the setting before the browser closes
  }
  console.log(`Work IQ after --set ${want}:`, await state());
}
await ctx.close();
