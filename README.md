**English** | [Deutsch](README.de.md)

# M365 Copilot: automatically pick the best model

Tampermonkey userscript for `https://copilot.cloud.microsoft/chat/`. It switches the model picker from **Auto** to
the model at the **very bottom of the picker menu** (today: *GPT-6.1 Sol* in the "GPT / OpenAI" submenu).

## Installation

1. Install Tampermonkey in Edge (or Firefox).
2. Tampermonkey dashboard → "Create a new script" → paste the content of `m365-best-model.user.js` → save.
3. Reload `https://copilot.cloud.microsoft/chat/`.

## Behavior

- **Rule:** In every menu level the last enabled entry counts. If it is a submenu, it is opened and the rule is
  applied again there until a selectable model is reached. If new models are added at the bottom later, the script
  follows without changes.
- **Permanent:** The page resets the selection to Auto on "New chat" and after loading. The script watches the page
  and switches again every time.
- **Your own choice wins:** If you operate the model menu yourself, the script does not override you until the page
  is reloaded. That means a real click on the picker or on an entry of its menu, or Enter, Space or an arrow key
  there; a click counts in the middle of an automatic switch too. Tab, typing, other menus and key presses while
  the script itself drives the (invisible) menu do not count. A URL change without a reload, e.g. when sending the
  first message in a new chat, does not lift this. To get the best model again in a new chat, reload the page.
- **Safety nets:** If the page keeps resetting the model (5 successful switches within 30 s), model switching pauses
  for 2 minutes. After 5 failed attempts in a row the script gives up until the URL changes. Failed attempts are
  retried automatically, even if the page does not change.
- **Busy pages:** Page changes are handled 250 ms after the last one, at the latest 1.5 s after the first one, so a
  page that keeps changing (a streaming answer) cannot postpone the script indefinitely.
- **Known limits:** Five genuine new chats within 30 s look like a page that keeps resetting the model and start the
  2-minute pause; the pause shows up only in the debug log. Every URL change resets the failure counter, so a page
  that keeps changing its URL is not stopped by the limit of 5 failed attempts.
- **Focus:** After switching, keyboard focus returns to where it was before (usually the input field). Escape is
  only sent if a menu is open.
- **No flicker:** The menu is invisible while the script switches automatically.
- **Debug:** `localStorage.setItem('m365-best-model-debug', '1')` in the console, then reload the page.

## URL flags in the hash: `#anonymous` and `#nowork`

The URL hash can contain flags, separated by commas, case-insensitive. Usable as bookmarks.

| URL | Effect |
|---|---|
| `https://copilot.cloud.microsoft/chat/#anonymous` | "Temporary chat" (top right) is switched on. |
| `https://copilot.cloud.microsoft/chat/#nowork` | "Work IQ" (top left) is switched off. |
| `…/chat/#nowork,anonymous` or `…/chat/#anonymous,nowork` | Both (the order in the hash does not matter). |

- **Whole words:** `#anonymous2` or `#online` do nothing, unknown flags are ignored. An encoded comma (`%2C`) and
  spaces after the comma are accepted.
- **One-shot and idempotent:** Each flag takes effect once per page load or when the hash changes. If the switch is
  already in the desired state, it is not clicked. What the user does is not undone: if you leave the temporary chat
  or switch Work IQ back on, it stays that way, and a switch you operate before the script has applied its flag is
  left alone as well (the flag is dropped).
- **Re-apply:** In the real-page test the page was seen changing Work IQ on its own (several times shortly after
  loading from on to off, once from off to on after the script had switched it off); the cause is unknown. The
  script covers one case: if the page flips a switch set by the script back within 6 seconds, the script sets it
  again at most twice. If the user touched the switch, nothing happens. After that the page wins. Changes the page
  makes before any flag was applied are not touched.
- **Execution order:** first temporary chat, then Work IQ, then the model choice. A switch that is not rendered yet
  does not hold up the model choice; it runs anyway and is repeated afterwards if needed. The model is switched in
  every combination.
- **Detection:** Temporary chat = a toggle with `aria-pressed` and a label containing "tempor". Work IQ =
  `role="switch"` with the visible text "Work IQ" (product name, not translated; the `aria-label` changes with the
  state and is not suitable for detection).
- **State lasts for the browser session:** The page keeps the Work IQ state across reloads and all tabs until the
  browser is restarted (then Work IQ is on again). After `#nowork`, a URL without the flag therefore also shows Work
  IQ as off until someone switches it on again. This is page behavior, not the script's. The script never switches
  Work IQ on or off by itself while the flag is absent.
- **Limitation:** If the session has expired, the server redirects to the sign-in before any page loads, and the
  hash is lost without any script being able to see it. After signing in, open the URL with the flags again.
- **`@run-at document-start`:** The hash is read as soon as the script starts and kept in memory.

## Code and localization

The script's code (identifiers, comments) is English. Texts exist in English and German:

- **Tampermonkey header:** `@name`/`@description` in English, `@name:de`/`@description:de` in German. Tampermonkey
  shows the browser's language.
- **Console messages (debug):** `MESSAGES` table in the script, language chosen by `navigator.language`. German gets
  German texts, every other language gets English.
- **New language:** Add an entry to `MESSAGES` and extend the language selection (`lang`). If the script does not
  recognize the UI, check the detection patterns: `findPicker()` (label with "Modell"/"model"), `isAuto()` (label
  "Auto" of the default mode), `findTemporaryToggle()` (label with "tempor"). `findWorkIqSwitch()` uses the product
  name "Work IQ" and needs no translation. The E2E tests use German locators (`Modellauswahl`, `Neuer Chat`) and
  only run with a German UI.

When updating, replace the content of the **existing** script in the dashboard. If you create a new script, delete
the old one, otherwise both run (the `@name` has changed).

## Tests (Edge + Playwright)

```
npm install
npm test            # i18n test, menu test (both without sign-in), then the E2E test
npm run test:i18n   # localization and URL flags only, mock pages
npm run test:menu   # menu mock only: rule, own choice, loop guard, retry, focus, flipping switches, busy page
npm run test:e2e    # real page in Edge only (changes settings of the test profile's account)
node tools/mutation-check.mjs   # checks that the menu tests really detect the fixed bugs (about 10 minutes)
```

The i18n test serves mock pages under the Copilot URL and checks header, start message and error message per browser
language (de-DE, de-AT, en-US, fr-FR) as well as the URL flags (spellings, wrong words, `#online` without effect,
encoded comma, spaces, unknown flags, already in the target state, switch appears late, user switches back, hash
change, fixed execution order).

The menu test uses a mock page with a Fluent-like model menu. The mock copies what was measured on the real page
with `tools/menu-probe.mjs`: the focus moves onto the first menu entry and back to the picker, the picker carries
`aria-expanded` while its menu is open, and every menu is labelled by its trigger (`aria-labelledby`). It checks the
"lowest enabled entry" rule (submenu via hover, click or right arrow, last entry disabled), focus (also if the user
moved it or the page re-rendered the input), own choice (a real click or key on the picker or in its menu counts;
Tab, an unrelated menu and a key while the script drives the menu do not), the loop guard (including the end of the
pause and the sliding window), retry and cap of failed attempts, a hash change during switching, switches the page
flips back (also only by `aria-checked`/`aria-pressed`, and after the verify window), a switch the user operates
before the flag was applied, and a page that changes every 100 ms. Pause, window and verify window are shortened per
case by replacing numbers of the `CFG` block in the loaded script text, so the logic is tested without waiting for
the real durations.

`tools/mutation-check.mjs` re-introduces each fixed bug and removes each safeguard in a copy of the script (28
mutants) and requires the matching check to fail. It protects itself against false results: a baseline run on the
unmodified script must be green first, every edit must match exactly once, every mutant must parse, only the
expected checks may fail, and a mutant that no test can tell from the original (`x-rerun-only`, explained in the
tool) is declared equivalent and must pass everything.

The E2E test starts Edge with its own profile (`.profile/`, not your normal Edge profile) and signs in via Windows
SSO (the account tile is picked with the environment variable `M365_SSO_TILE`, e.g. `M365_SSO_TILE=example.com`;
without it you sign in yourself in the opened window) and resets the selection to Auto once. It determines the
lowest menu entry independently of the script, loads the script as an init script and checks: switching, correct
model, no visible menu while switching, own choice, reload, "New chat", and that real key presses while the script
switches do not lock the automation.

Limitation: Tampermonkey itself does not run in the test (extensions cannot be loaded into Edge automatically). The
script uses no `GM_*` API (`@grant none`) and therefore runs unchanged in the test. `tools/debug-run.mjs` shows the
console and picker state in case Microsoft changes the UI. `tools/workiq-state.mjs` reads the Work IQ state after a
fresh load (`--set on|off` sets it), and `tools/workiq-flip-rate.mjs` loads the page several times in fresh browsers
and counts how often Work IQ ends up off by itself (measurement: 0 of 12, with and without the script; in E2E runs
with the long-lived test profile it still happened occasionally, cause unknown). `tools/menu-probe.mjs` opens the
model menu on the real page without choosing anything and prints where the focus goes and how menus are labelled.
`tools/b1-repro.mjs` sends real arrow keys while the script switches the model and checks that the automation is not
locked afterwards (`M365_SCRIPT=<file>` runs it against another script version).

## License

[MIT](LICENSE)
