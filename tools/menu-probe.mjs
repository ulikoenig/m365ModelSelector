// Sonde für die echte Seite (ohne Skript): wohin wandert der Tastaturfokus, wenn das Modellmenü aufgeht,
// und wie sind Menü und Untermenü per aria-labelledby mit ihrem Auslöser verknüpft? Daran hängt, welche
// Eingaben als Eigenwahl zählen dürfen (siehe onUserInput im Userscript).
// Wählt nichts aus: Menü öffnen, ansehen, mit Escape schließen. Aufruf: node tools/menu-probe.mjs
import { launch, openChat } from './lib.mjs';

const watchdog = setTimeout(() => {
  console.error('Watchdog: Sonde nach 200 s abgebrochen');
  process.exit(2);
}, 200_000);

const ctx = await launch({ headless: true });
const page = await ctx.newPage();
try {
  await openChat(page, { timeoutMs: 120_000 });
  await page.waitForTimeout(2500);

  /** Kurzbeschreibung eines Elements ohne Inhalte: Tag, Rolle, Attribute, Position unter den Menüeinträgen. */
  const describe = () =>
    page.evaluate(() => {
      const d = (el) =>
        el
          ? {
              tag: el.tagName,
              role: el.getAttribute('role'),
              hasId: Boolean(el.id),
              tabindex: el.getAttribute('tabindex'),
              labelledby: el.getAttribute('aria-labelledby') ? 'ja' : null,
              inMenu: Boolean(el.closest('[role="menu"]')),
            }
          : null;
      const picker = document.querySelector('button[aria-label$="Modellauswahl"]');
      const menus = [...document.querySelectorAll('[role="menu"]')].filter((m) => m.getClientRects().length > 0);
      const active = document.activeElement;
      return {
        picker: { expanded: picker?.getAttribute('aria-expanded') ?? 'fehlt', haspopup: picker?.getAttribute('aria-haspopup') },
        active: d(active),
        activeIndexInMenu: menus.length ? [...menus[menus.length - 1].querySelectorAll('[role^="menuitem"]')].indexOf(active) : null,
        menus: menus.map((m) => {
          const owner = (m.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .find(Boolean);
          return {
            ownerIsPicker: owner === picker,
            ownerRole: owner?.getAttribute('role') ?? owner?.tagName ?? null,
            ownerInsideMenu: Boolean(owner?.closest('[role="menu"]')),
            items: [...m.querySelectorAll('[role^="menuitem"]')].filter((i) => i.closest('[role="menu"]') === m).map((i) => i.getAttribute('role')),
          };
        }),
      };
    });

  const picker = page.locator('button[aria-label$="Modellauswahl"]').first();
  const closeAll = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  };

  console.log('vor dem Öffnen:', JSON.stringify(await describe()));

  // 1) Programmatischer Klick, so öffnet das Skript das Menü.
  await page.evaluate(() => document.querySelector('button[aria-label$="Modellauswahl"]').click());
  await page.locator('[role="menu"]:visible').first().waitFor({ timeout: 5000 });
  for (const wait of [0, 100, 400]) {
    await page.waitForTimeout(wait);
    console.log(`programmatischer Klick, +${wait} ms:`, JSON.stringify(await describe()));
  }
  await closeAll();

  // 2) Echter Mausklick, so öffnet der Nutzer das Menü; danach das Untermenü per Hover.
  await picker.click();
  await page.locator('[role="menu"]:visible').first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  console.log('echter Klick, +400 ms:', JSON.stringify(await describe()));
  const sub = page.locator('[role="menuitem"][aria-haspopup="menu"]:visible').last();
  await sub.hover();
  await page.waitForTimeout(1200);
  console.log('Untermenü per Hover:', JSON.stringify(await describe()));
  await closeAll();
  console.log('nach Escape:', JSON.stringify(await describe()));
} finally {
  clearTimeout(watchdog);
  await ctx.close();
}
