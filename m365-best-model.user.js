// ==UserScript==
// @name         M365 Copilot: auto-select best model
// @name:de      M365 Copilot: bestes Modell automatisch wählen
// @namespace    m365-model-selector
// @version      1.3.0
// @description  M365 Copilot Chat: switches the model picker from "Auto" to the model at the very bottom of the picker menu (newest/best available model). URL hash flags: #anonymous starts a temporary chat, #nowork switches Work IQ off (combine with a comma, e.g. #nowork,anonymous).
// @description:de  M365-Copilot-Chat: schaltet die Modellauswahl von "Auto" auf das Modell ganz unten im Auswahlmenü um (neuestes/bestes verfügbares Modell). URL-Hash-Flags: #anonymous startet einen temporären Chat, #nowork schaltet Work IQ aus (mit Komma kombinierbar, z. B. #nowork,anonymous).
// @match        https://copilot.cloud.microsoft/chat*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

/*
 * Rule: in every menu level the LAST enabled entry is chosen. If it is a submenu
 * (aria-haspopup="menu"), it is opened and the rule is applied again there, until a selectable
 * model (role="menuitemradio") is reached. Today: main menu -> "GPT / OpenAI" -> bottom entry.
 *
 * The page is a SPA and resets the selection to "Auto" on a new chat. The script therefore keeps
 * watching the page and switches again whenever the picker shows "Auto".
 *
 * The user's own choice wins: if the user operates the model menu themselves (real click or key
 * press), the script does not touch the model again until the page is reloaded. A URL change
 * without reload (for example the first message of a new chat) does not lift that.
 *
 * Safety nets: after 5 successful switches within 30 s (the page keeps resetting the model) the
 * script pauses model switching for 2 minutes; after 5 failed attempts in a row it stops until the
 * URL changes. After a switch the keyboard focus returns to where it was (usually the chat input),
 * and Escape is only sent while a menu is open.
 *
 * URL flags: the hash holds comma separated flags (case-insensitive, whole words), e.g.
 * "#anonymous", "#nowork", "#nowork,anonymous" or "#anonymous,nowork":
 *   anonymous  switches on the "temporary chat" toggle in the top right.
 *   nowork     switches off the "Work IQ" switch in the top left.
 * Each flag acts once per page load or hash change and never undoes what the user chose afterwards
 * (a switch that already has the wanted state is not clicked; a temporary chat the user left is not
 * started again; Work IQ switched back on by the user is not switched off again). If the PAGE flips
 * a switch back by itself within 6 s after it was set (seen for Work IQ), the flag is applied again,
 * at most twice, and never after the user touched that switch. The hash is read
 * the moment the script starts (@run-at document-start) and remembered in memory, so it does not
 * matter if the page rewrites the URL later.
 * Limitation: if the session has expired, the server redirects to the sign-in page before any page
 * is rendered and the hash is lost (no script can see it). Open the URL with the flags again after
 * signing in.
 *
 * Localization: console messages exist in English and German (see MESSAGES). The language follows
 * the browser language; every language other than German falls back to English. The userscript
 * header carries localized @name:de / @description:de for Tampermonkey.
 *
 * Debug output: localStorage.setItem('m365-best-model-debug', '1'), then reload the page.
 */
(function () {
  'use strict';

  if (window.top !== window.self) return; // main window only, not in iframes of the page

  // ---------- Localization ----------

  const MESSAGES = {
    en: {
      active: 'active',
      userSelection: 'user selection detected, model automation paused until the page is reloaded',
      level: (depth, text) => `level ${depth}, last entry: ${text}`,
      selected: (text) => `selected: ${text}`,
      alreadySelected: 'already selected',
      attemptFailed: (n, reason) => `attempt ${n} failed: ${reason}`,
      errMenuNotOpened: 'model menu did not open',
      errNoEntries: 'menu has no selectable entries',
      errSubmenuNotOpened: (text) => `submenu "${text}" did not open`,
      errNotAModel: (text) => `last entry is not a model: "${text}"`,
      errTooDeep: 'menu is nested too deeply',
      errNotApplied: 'selection was not applied',
      switchLoop: (seconds) => `the page keeps resetting the model: pausing model switching for ${seconds} s`,
      reasserting: (flag) => `the page changed the switch for "#${flag}" back by itself, applying it again`,
      temporaryRequested: 'URL requests a temporary chat (#anonymous)',
      temporaryStarted: 'temporary chat started',
      temporaryAlready: 'temporary chat is already active',
      temporaryGaveUp: 'giving up on the temporary chat (toggle not found or without effect)',
      errTemporaryNotApplied: 'temporary chat did not switch on',
      workIqRequested: 'URL requests Work IQ off (#nowork)',
      workIqDisabled: 'Work IQ switched off',
      workIqAlready: 'Work IQ is already off',
      workIqGaveUp: 'giving up on Work IQ (switch not found or without effect)',
      errWorkIqNotApplied: 'Work IQ did not switch off',
    },
    de: {
      active: 'aktiv',
      userSelection: 'Nutzerauswahl erkannt, Modell-Automatik pausiert bis zum Neuladen der Seite',
      level: (depth, text) => `Ebene ${depth}, letzter Eintrag: ${text}`,
      selected: (text) => `gewählt: ${text}`,
      alreadySelected: 'war bereits gewählt',
      attemptFailed: (n, reason) => `Fehlversuch ${n}: ${reason}`,
      errMenuNotOpened: 'Modellmenü öffnete sich nicht',
      errNoEntries: 'Menü ohne wählbare Einträge',
      errSubmenuNotOpened: (text) => `Untermenü "${text}" öffnete sich nicht`,
      errNotAModel: (text) => `Letzter Eintrag ist kein Modell: "${text}"`,
      errTooDeep: 'Menü zu tief verschachtelt',
      errNotApplied: 'Auswahl wurde nicht übernommen',
      switchLoop: (seconds) => `Die Seite setzt das Modell immer wieder zurück: Modellwechsel pausiert für ${seconds} s`,
      reasserting: (flag) => `Die Seite hat den Schalter für "#${flag}" von selbst zurückgedreht, wende ihn erneut an`,
      temporaryRequested: 'URL fordert einen temporären Chat an (#anonymous)',
      temporaryStarted: 'temporärer Chat gestartet',
      temporaryAlready: 'temporärer Chat ist bereits aktiv',
      temporaryGaveUp: 'temporärer Chat wird aufgegeben (Schalter nicht gefunden oder wirkungslos)',
      errTemporaryNotApplied: 'temporärer Chat wurde nicht aktiviert',
      workIqRequested: 'URL fordert Work IQ aus an (#nowork)',
      workIqDisabled: 'Work IQ ausgeschaltet',
      workIqAlready: 'Work IQ ist bereits aus',
      workIqGaveUp: 'Work IQ wird aufgegeben (Schalter nicht gefunden oder wirkungslos)',
      errWorkIqNotApplied: 'Work IQ wurde nicht ausgeschaltet',
    },
  };

  const lang = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en')
    .toLowerCase()
    .startsWith('de')
    ? 'de'
    : 'en';
  const t = MESSAGES[lang];

  // ---------- Configuration ----------

  const CFG = {
    cooldownMs: 2500, // minimum gap between two switch attempts
    maxAttempts: 5, // consecutive failures, then stay quiet until the URL changes
    stepTimeoutMs: 3000, // wait time per menu step
    hideMenu: true, // keep the menu invisible while switching (no flicker)
    urlActionWindowMs: 30000, // how long after page load / hash change a URL action waits for its switch
    loopMax: 5, // this many successful switches within loopWindowMs mean the page resets the model ...
    loopWindowMs: 30000,
    loopPauseMs: 120000, // ... so model switching pauses for this long
    verifyWindowMs: 6000, // after a URL action succeeded, the page may still flip the switch back by itself
    maxReasserts: 2, // how often a flipped-back switch is set again (the page wins after that)
  };

  let DEBUG = false;
  try {
    DEBUG = localStorage.getItem('m365-best-model-debug') === '1';
  } catch (_) {
    /* storage blocked: continue without debug output */
  }
  const log = (...args) => DEBUG && console.log('[m365-best-model]', ...args);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const BUSY_CLASS = 'm365-best-model-busy';

  // ---------- DOM access ----------

  /**
   * Model picker: a button with a menu whose aria-label contains "Modell" (German UI) or "model"
   * (English UI), e.g. "Auto, Modellauswahl". Extend the pattern for further UI languages.
   */
  function findPicker() {
    for (const button of document.querySelectorAll('button[aria-haspopup="menu"]')) {
      if (/modell|model/i.test(button.getAttribute('aria-label') || '')) return button;
    }
    return null;
  }

  const pickerLabel = (picker) => (picker.textContent || '').replace(/\s+/g, ' ').trim();
  // "Auto" is the label of the default mode in German and English UI alike.
  const isAuto = (picker) => /^auto$/i.test(pickerLabel(picker));

  /**
   * Temporary-chat toggle in the top right: a toggle button (aria-pressed) whose aria-label contains
   * "tempor" ("Temporärer Chat" in German UI, "Temporary chat" in English UI). Its state is
   * aria-pressed="true|false"; the label stays the same in both states.
   */
  function findTemporaryToggle() {
    for (const button of document.querySelectorAll('button[aria-pressed]')) {
      if (/tempor/i.test(button.getAttribute('aria-label') || '')) return button;
    }
    return null;
  }

  /**
   * "Work IQ" switch in the top left: a button with role="switch" and aria-checked="true|false" whose
   * visible text is "Work IQ" (a product name, not translated). The aria-label changes with the state
   * ("Work IQ deaktivieren" / "Work IQ aktivieren"), so the visible text is used to find it.
   */
  function findWorkIqSwitch() {
    for (const el of document.querySelectorAll('button[role="switch"][aria-checked]')) {
      if (/^work\s*iq$/i.test((el.textContent || '').trim())) return el;
    }
    return null;
  }

  const visibleMenus = () =>
    [...document.querySelectorAll('[role="menu"]')].filter((m) => m.isConnected && m.getClientRects().length > 0);

  /** Direct entries of a menu (without entries of nested menus), enabled ones only. */
  function menuEntries(menu) {
    return [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')].filter(
      (item) => item.closest('[role="menu"]') === menu && item.getAttribute('aria-disabled') !== 'true',
    );
  }

  async function waitFor(fn, timeoutMs, intervalMs = 40) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = fn();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(intervalMs);
    }
  }

  // ---------- Events for the React UI ----------

  function fire(el, type, EventCtor, extra) {
    el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, composed: true, view: window, ...extra }));
  }

  function hover(el) {
    const rect = el.getBoundingClientRect();
    const position = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
      fire(el, type, type.startsWith('pointer') ? PointerEvent : MouseEvent, position);
    }
  }

  function pressKey(el, key) {
    el.focus?.();
    for (const type of ['keydown', 'keyup']) fire(el, type, KeyboardEvent, { key, code: key });
  }

  /** Opens an entry's submenu; tries hover, click and arrow-right until a new menu appears. */
  async function openSubmenu(item, before) {
    const attempts = [() => hover(item), () => item.click(), () => pressKey(item, 'ArrowRight')];
    for (const act of attempts) {
      act();
      const submenu = await waitFor(
        () => visibleMenus().find((m) => !before.has(m)),
        CFG.stepTimeoutMs / attempts.length,
      );
      if (submenu) return submenu;
    }
    return null;
  }

  /** Closes open menus with Escape. Does nothing (in particular sends no Escape to the chat input) if none is open. */
  function closeMenus() {
    if (visibleMenus().length === 0) return;
    pressKey(document.activeElement || document.body, 'Escape');
  }

  /**
   * Opening and closing the model menu moves the keyboard focus (into the menu, then back to the picker).
   * Puts it back where it was, but only if it still sits where the menu left it (picker, inside a menu or
   * nowhere); if the user moved it elsewhere in the meantime it is left alone.
   */
  function restoreFocus(previous) {
    const current = document.activeElement;
    const picker = findPicker();
    const leftByMenu =
      !current || current === document.body || current === picker || Boolean(current.closest?.('[role="menu"]'));
    if (!leftByMenu) return;
    if (previous && previous !== document.body && previous.isConnected && typeof previous.focus === 'function') {
      previous.focus({ preventScroll: true });
    } else if (current && current === picker) {
      current.blur(); // nothing had the focus before: do not leave it on the picker
    }
  }

  // ---------- Hide the menu while switching ----------

  let sheet = null;
  function setBusy(on) {
    if (!CFG.hideMenu) return;
    if (on && !sheet) {
      try {
        // A constructed stylesheet is not subject to the page's inline-style CSP.
        sheet = new CSSStyleSheet();
        sheet.replaceSync(
          `html.${BUSY_CLASS} .fui-MenuPopover, html.${BUSY_CLASS} [role="menu"] { opacity: 0 !important; transition: none !important; animation: none !important; }`,
        );
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      } catch (_) {
        sheet = null; // the menu simply stays visible
      }
    }
    document.documentElement.classList.toggle(BUSY_CLASS, on);
  }

  // ---------- Core logic ----------

  /** Selects the bottom model. Returns the label of the chosen entry. */
  async function selectBottomModel(picker) {
    const before = new Set(visibleMenus());
    picker.click();
    let menu = await waitFor(() => visibleMenus().find((m) => !before.has(m)), CFG.stepTimeoutMs);
    if (!menu) throw new Error(t.errMenuNotOpened);

    for (let depth = 0; depth < 4; depth++) {
      const entries = menuEntries(menu);
      const last = entries[entries.length - 1];
      if (!last) throw new Error(t.errNoEntries);
      const text = (last.innerText || '').replace(/\s+/g, ' ').trim();
      log(t.level(depth, text));

      if (last.getAttribute('aria-haspopup') === 'menu') {
        const known = new Set(visibleMenus());
        menu = await openSubmenu(last, known);
        if (!menu) throw new Error(t.errSubmenuNotOpened(text));
        continue;
      }
      if (last.getAttribute('role') !== 'menuitemradio') {
        throw new Error(t.errNotAModel(text));
      }
      if (last.getAttribute('aria-checked') === 'true') {
        closeMenus();
        return `${text} (${t.alreadySelected})`;
      }
      last.click();
      return text;
    }
    throw new Error(t.errTooDeep);
  }

  let busy = false;
  let failures = 0; // failed model switches in a row; reset when the URL changes
  let lastAttemptAt = 0;
  let lastHref = location.href;
  let userOverride = false; // the user chose in the model menu themselves; lasts until the page is reloaded
  let rerunRequested = false; // a trigger arrived while a click sequence was running
  let switchTimes = []; // timestamps of recent successful switches (loop guard)
  let pausedUntil = 0;
  let pauseTimer = 0;

  // ---------- One-shot actions from the URL hash (#anonymous, #nowork) ----------

  /**
   * Flags in the URL hash, comma separated and case-insensitive: "#nowork,anonymous" or
   * "#anonymous,nowork". Every flag is a whole word ("#anonymous2" is not "#anonymous"); unknown
   * flags are ignored.
   */
  function parseHashFlags() {
    let hash = location.hash.slice(1);
    try {
      hash = decodeURIComponent(hash); // a comma may arrive as "%2C"
    } catch (_) {
      /* malformed escape sequence: use the raw text */
    }
    return new Set(
      hash
        .toLowerCase()
        .split(',')
        .map((flag) => flag.trim())
        .filter(Boolean),
    );
  }

  /**
   * Each action drives one switch of the page into a wanted state, once per page load or hash change.
   * Idempotent: a switch that already has the wanted state is not clicked. The array order is the
   * execution order: the temporary chat comes first because switching it may re-render the header.
   */
  const URL_ACTIONS = [
    {
      flag: 'anonymous',
      find: findTemporaryToggle,
      isOn: (el) => el.getAttribute('aria-pressed') === 'true',
      wantOn: true,
      msg: {
        requested: t.temporaryRequested,
        done: t.temporaryStarted,
        already: t.temporaryAlready,
        failed: t.errTemporaryNotApplied,
        gaveUp: t.temporaryGaveUp,
      },
    },
    {
      flag: 'nowork',
      find: findWorkIqSwitch,
      isOn: (el) => el.getAttribute('aria-checked') === 'true',
      wantOn: false,
      msg: {
        requested: t.workIqRequested,
        done: t.workIqDisabled,
        already: t.workIqAlready,
        failed: t.errWorkIqNotApplied,
        gaveUp: t.workIqGaveUp,
      },
    },
  ].map((action) => ({ ...action, pending: false, deadline: 0, attempts: 0, verifyUntil: 0, touched: false, reasserts: 0 }));

  /** Marks the actions named in `flags` as pending and returns them. */
  function requestActions(flags) {
    const requested = URL_ACTIONS.filter((action) => flags.has(action.flag));
    for (const action of requested) {
      action.pending = true;
      action.deadline = Date.now() + CFG.urlActionWindowMs;
      action.attempts = 0;
      action.verifyUntil = 0;
      action.touched = false;
      action.reasserts = 0;
    }
    return requested;
  }

  // Read right now (the script starts at document-start) and remembered in memory.
  const initialActions = requestActions(parseHashFlags());

  /**
   * Shortly after an action succeeded the page may flip the switch back by itself (observed on the real
   * page for Work IQ). Within a short window and a few times at most, the flag is applied again, unless
   * the user touched the switch meanwhile: what the user does always wins.
   */
  function reassertIfFlippedBack(action) {
    if (action.pending || action.touched || Date.now() >= action.verifyUntil) return;
    const el = action.find();
    if (!el || action.isOn(el) === action.wantOn || action.reasserts >= CFG.maxReasserts) return;
    action.reasserts++;
    action.pending = true;
    action.deadline = Date.now() + CFG.urlActionWindowMs;
    action.attempts = 0;
    log(t.reasserting(action.flag));
  }

  /** Drives the switch of one pending action into its wanted state. Never repeats once done. */
  async function runAction(action) {
    reassertIfFlippedBack(action);
    if (action.pending && Date.now() >= action.deadline) {
      action.pending = false;
      log(action.msg.gaveUp);
    }
    if (!action.pending) return;

    const el = action.find();
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return; // page not ready yet
    if (action.isOn(el) === action.wantOn) {
      action.pending = false;
      action.verifyUntil = Date.now() + CFG.verifyWindowMs;
      log(action.msg.already);
      return;
    }
    if (action.attempts >= CFG.maxAttempts) {
      action.pending = false;
      log(action.msg.gaveUp);
      return;
    }

    busy = true;
    action.attempts++;
    try {
      el.click();
      const reached = await waitFor(() => {
        const current = action.find();
        return current && action.isOn(current) === action.wantOn;
      }, CFG.stepTimeoutMs);
      if (reached) {
        action.pending = false;
        action.verifyUntil = Date.now() + CFG.verifyWindowMs;
        log(action.msg.done);
      } else {
        log(t.attemptFailed(action.attempts, action.msg.failed));
        scheduleAfter(CFG.cooldownMs); // retry without waiting for the page to change
      }
    } finally {
      busy = false;
    }
  }

  async function runUrlActions() {
    for (const action of URL_ACTIONS) await runAction(action);
  }

  // ---------- Model switching ----------

  async function tick() {
    if (busy) {
      rerunRequested = true; // look again as soon as the running click sequence is over
      return;
    }
    rerunRequested = false;
    if (location.href !== lastHref) {
      lastHref = location.href;
      failures = 0; // a new page deserves fresh attempts
    }
    // URL actions first: switching them may re-render the header and reset the model picker.
    await runUrlActions();
    await switchModel();
    if (rerunRequested) schedule();
  }

  /** Counts successful switches; if the page keeps resetting the model, pauses switching for a while. */
  function guardAgainstLoop() {
    const now = Date.now();
    switchTimes = switchTimes.filter((time) => now - time < CFG.loopWindowMs);
    switchTimes.push(now);
    if (switchTimes.length < CFG.loopMax) return;
    switchTimes = [];
    pausedUntil = now + CFG.loopPauseMs;
    log(t.switchLoop(Math.round(CFG.loopPauseMs / 1000)));
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(schedule, CFG.loopPauseMs + 50);
  }

  async function switchModel() {
    if (busy) return;
    const picker = findPicker();
    if (!picker || !isAuto(picker)) {
      failures = 0;
      return;
    }
    if (userOverride || failures >= CFG.maxAttempts || Date.now() < pausedUntil) return;
    const wait = lastAttemptAt + CFG.cooldownMs - Date.now();
    if (wait > 0) {
      scheduleAfter(wait + 50);
      return;
    }

    busy = true;
    lastAttemptAt = Date.now();
    const previousFocus = document.activeElement;
    setBusy(true);
    try {
      const chosen = await selectBottomModel(picker);
      const applied = await waitFor(() => {
        const p = findPicker();
        return p && !isAuto(p);
      }, CFG.stepTimeoutMs);
      if (!applied) throw new Error(t.errNotApplied);
      failures = 0;
      log(t.selected(chosen));
      guardAgainstLoop();
    } catch (e) {
      failures++;
      log(t.attemptFailed(failures, e.message));
      closeMenus();
      scheduleAfter(CFG.cooldownMs + 50); // retry without waiting for the page to change
    } finally {
      await sleep(150); // let the menu finish closing before it becomes visible again
      restoreFocus(previousFocus);
      setBusy(false);
      busy = false;
    }
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(tick, 250);
  }

  let laterTimer = 0;
  /** One pending delayed re-check at most, however many triggers arrive meanwhile. */
  function scheduleAfter(ms) {
    clearTimeout(laterTimer);
    laterTimer = setTimeout(schedule, ms);
  }

  // The user operates the model menu themselves -> leave the model alone until the page is reloaded.
  // Only real (trusted) events count: the script's own synthetic events are never trusted. This also
  // holds while the script is busy, so a user click during a switch is not lost.
  function onUserInput(event) {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    for (const action of URL_ACTIONS) {
      const el = action.find();
      if (el && el.contains(target)) action.touched = true; // the user operates this switch: hands off
    }
    const picker = findPicker();
    if ((picker && picker.contains(target)) || target.closest('[role="menuitemradio"]')) {
      userOverride = true;
      log(t.userSelection);
    }
  }

  function start() {
    document.addEventListener('pointerdown', onUserInput, true);
    document.addEventListener('keydown', onUserInput, true);
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-pressed', 'aria-checked'], // switch state changes
    });
    window.addEventListener('visibilitychange', schedule);
    window.addEventListener('hashchange', () => {
      const requested = requestActions(parseHashFlags());
      for (const action of requested) log(action.msg.requested);
      if (requested.length) schedule();
    });
    schedule();
    log(t.active);
    for (const action of initialActions) log(action.msg.requested);
  }

  // With @run-at document-start <html> may not exist yet: wait for it.
  if (document.documentElement) {
    start();
  } else {
    new MutationObserver((_, observer) => {
      if (document.documentElement) {
        observer.disconnect();
        start();
      }
    }).observe(document, { childList: true });
  }
})();
