// Gemeinsame Hilfen für Sondierung und Test: Edge mit eigenem Profil starten und per
// Windows-SSO (keine Passworteingabe) auf der Copilot-Chat-Seite anmelden.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

export const root = path.resolve(import.meta.dirname, '..');
export const out = path.join(root, 'out');
const SSO_TILE = process.env.M365_SSO_TILE || '';
export const CHAT_URL ='https://copilot.cloud.microsoft/chat/';
fs.mkdirSync(out, { recursive: true });

export async function launch({ headless = false } = {}) {
  return chromium.launchPersistentContext(path.join(root, '.profile'), {
    channel: 'msedge',
    headless,
    viewport: { width: 1400, height: 900 },
  });
}

/** Navigiert zur Chat-Seite und wartet, bis die Eingabe sichtbar ist (inkl. SSO-Klick). */
export async function openChat(page, { timeoutMs = 150_000, url = CHAT_URL } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/login\.microsoftonline\.com/.test(url)) {
      // Kachel des gewünschten Kontos anklicken (Text per M365_SSO_TILE, z. B. die Domäne des Kontos).
      // Ohne Variable meldet man sich im geöffneten Edge-Fenster selbst an; das Profil merkt sich die Sitzung.
      if (SSO_TILE) {
        const tile = page.locator('div[role="button"]').filter({ hasText: SSO_TILE }).first();
        if (await tile.count()) await tile.click().catch(() => {});
      }
      const yes = page.locator('#idSIButton9');
      if (await yes.count()) await yes.click().catch(() => {});
    }
    if (/copilot\.cloud\.microsoft\/chat/.test(url) && (await page.locator('[role="textbox"], textarea').count()) > 0) {
      return;
    }
    await page.waitForTimeout(1500);
  }
  throw new Error('Chat-Seite nicht erreicht: ' + page.url().slice(0, 100));
}

/**
 * Schickt echte (vertrauenswürdige) Tastendrücke im Abstand von rund 30 ms, bis der Modellwähler nicht mehr auf
 * "Auto" steht oder maxMs vergangen sind. So trifft garantiert ein Tastendruck das Fenster, in dem das Skript
 * das Modellmenü bedient. Liefert, wie viele Tasten gesendet wurden und ob umgeschaltet wurde.
 */
export async function pressKeysUntilSwitched(page, key, maxMs = 20_000) {
  const picker = page.locator('button[aria-label$="Modellauswahl"]').first();
  const end = Date.now() + maxMs;
  let keys = 0;
  while (Date.now() < end) {
    await page.keyboard.press(key);
    keys++;
    if (keys % 4 === 0) {
      const text = ((await picker.textContent({ timeout: 300 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (text && !/^auto$/i.test(text)) return { keys, switched: true };
    }
    await page.waitForTimeout(30);
  }
  return { keys, switched: false };
}
