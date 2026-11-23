[English](README.md) | **Deutsch**

# M365 Copilot: bestes Modell automatisch wählen

Tampermonkey-Skript für `https://copilot.cloud.microsoft/chat/`. Es schaltet die Modellauswahl von **Auto**
auf das Modell um, das **ganz unten im Auswahlmenü** steht (Stand heute: *GPT-6.1 Sol* im Untermenü
„GPT / OpenAI“).

## Installation

1. Tampermonkey in Edge (oder Firefox) installieren.
2. Tampermonkey-Dashboard → „Neues Skript“ → Inhalt von `m365-best-model.user.js` einfügen → speichern.
3. `https://copilot.cloud.microsoft/chat/` neu laden.

## Verhalten

- **Regel:** In jeder Menüebene zählt der letzte aktive Eintrag. Ist es ein Untermenü, wird es geöffnet und die
  Regel dort wiederholt, bis ein wählbares Modell erreicht ist. Kommen später neue Modelle unten hinzu,
  folgt das Skript ohne Änderung.
- **Dauerhaft:** Die Seite setzt die Auswahl bei „Neuer Chat“ und nach dem Laden auf Auto zurück. Das Skript
  beobachtet die Seite und schaltet jedes Mal wieder um.
- **Eigene Wahl hat Vorrang:** Wer das Modellmenü selbst bedient, wird bis zum Neuladen der Seite nicht überstimmt.
  Gemeint ist ein echter Klick auf den Wähler oder auf einen Eintrag seines Menüs oder Enter, Leertaste und
  Pfeiltasten dort; ein Klick zählt auch mitten im automatischen Umschalten. Tab, Tippen, andere Menüs und
  Tastendrücke, während das Skript selbst das (unsichtbare) Menü bedient, zählen nicht. Eine URL-Änderung ohne
  Neuladen, etwa beim ersten Senden in einem neuen Chat, hebt das nicht auf. Wer in einem neuen Chat wieder das
  beste Modell will, lädt die Seite neu.
- **Sicherheitsnetze:** Setzt die Seite das Modell immer wieder zurück (5 erfolgreiche Wechsel in 30 s), pausiert
  der Modellwechsel 2 Minuten. Nach 5 Fehlversuchen in Folge gibt das Skript auf, bis sich die URL ändert.
  Fehlversuche werden von selbst wiederholt, auch wenn die Seite sich nicht verändert.
- **Unruhige Seiten:** Änderungen der Seite werden 250 ms nach der letzten bearbeitet, spätestens 1,5 s nach der
  ersten. Eine Seite, die sich dauernd ändert (eine Antwort wird geschrieben), kann das Skript so nicht beliebig
  lange aufhalten.
- **Bekannte Grenzen:** Fünf echte neue Chats innerhalb von 30 s sehen aus wie eine Seite, die das Modell immer
  wieder zurücksetzt, und lösen die 2-Minuten-Pause aus; die Pause erscheint nur im Debug-Log. Jede URL-Änderung
  setzt den Fehlerzähler zurück, eine Seite, die ständig ihre URL ändert, wird also vom Limit von 5 Fehlversuchen
  nicht gestoppt.
- **Fokus:** Nach dem Umschalten liegt der Tastaturfokus wieder dort, wo er vorher war (meist im Eingabefeld).
  Escape wird nur gesendet, wenn ein Menü offen ist.
- **Kein Flackern:** Das Menü ist während des automatischen Umschaltens unsichtbar.
- **Debug:** `localStorage.setItem('m365-best-model-debug', '1')` in der Konsole, Seite neu laden.

## URL-Flags im Hash: `#anonymous` und `#nowork`

Der Hash der URL kann Flags enthalten, mit Komma getrennt, Groß-/Kleinschreibung egal. Als Lesezeichen nutzbar.

| URL | Wirkung |
|---|---|
| `https://copilot.cloud.microsoft/chat/#anonymous` | Oben rechts wird „Temporärer Chat“ eingeschaltet. |
| `https://copilot.cloud.microsoft/chat/#nowork` | Oben links wird „Work IQ“ ausgeschaltet. |
| `…/chat/#nowork,anonymous` oder `…/chat/#anonymous,nowork` | Beides (die Reihenfolge im Hash ist egal). |

- **Ganze Wörter:** `#anonymous2` oder `#online` bewirken nichts, unbekannte Flags werden ignoriert. Ein kodiertes
  Komma (`%2C`) und Leerzeichen nach dem Komma werden akzeptiert.
- **Einmalig und idempotent:** Jedes Flag wirkt einmal pro Seitenaufruf oder wenn sich der Hash ändert. Steht der
  Schalter schon im gewünschten Zustand, wird er nicht angeklickt. Was der Nutzer selbst tut, wird nicht rückgängig
  gemacht: Wer den temporären Chat verlässt oder Work IQ wieder einschaltet, bleibt dabei, und ein Schalter, den der
  Nutzer bedient, bevor das Skript sein Flag angewendet hat, bleibt ebenfalls unangetastet (das Flag verfällt).
- **Nachregeln:** Im E2E-Test auf der echten Seite wurde beobachtet, dass die Seite Work IQ von selbst ändert
  (mehrfach kurz nach dem Laden von an auf aus, einmal von aus auf an, nachdem das Skript es ausgeschaltet hatte);
  die Ursache ist unbekannt. Das Skript deckt einen Fall ab: Dreht die Seite einen vom Skript gesetzten Schalter
  innerhalb von 6 Sekunden zurück, setzt das Skript ihn höchstens zweimal erneut. Hat der Nutzer den Schalter
  angefasst, passiert nichts. Danach gewinnt die Seite. Änderungen, die die Seite vor jedem angewendeten Flag
  macht, werden nicht angetastet.
- **Reihenfolge der Ausführung:** erst temporärer Chat, dann Work IQ, dann die Modellwahl. Ein Schalter, der noch
  nicht gerendert ist, hält die Modellwahl nicht auf; sie läuft dann trotzdem und wird bei Bedarf danach
  wiederholt. Das Modell wird in jeder Kombination weiter umgeschaltet.
- **Erkennung:** Temporärer Chat = Schalter mit `aria-pressed` und einer Beschriftung mit „tempor“. Work IQ =
  `role="switch"` mit dem sichtbaren Text „Work IQ“ (Produktname, nicht übersetzt; das `aria-label` wechselt mit
  dem Zustand und taugt nicht zur Erkennung).
- **Zustand gilt für die Browsersitzung:** Die Seite hält den Work-IQ-Zustand über Neuladen und alle Tabs
  hinweg, bis der Browser neu gestartet wird (dann ist Work IQ wieder an). Nach `#nowork` zeigt also auch eine
  URL ohne Flag Work IQ als aus, bis es jemand wieder einschaltet. Das ist Verhalten der Seite, nicht des
  Skripts. Das Skript schaltet Work IQ nie von selbst ein oder aus, solange das Flag fehlt.
- **Grenze:** Ist die Sitzung abgelaufen, leitet der Server vor jeder Seite auf die Anmeldung um, und der Hash
  geht verloren, ohne dass ein Skript ihn sehen kann. Nach der Anmeldung die URL mit den Flags noch einmal
  öffnen.
- **`@run-at document-start`:** Der Hash wird gelesen, sobald das Skript startet, und im Speicher gehalten.

## Code und Lokalisierung

Der Code des Skripts (Bezeichner, Kommentare) ist englisch. Texte gibt es auf Englisch und Deutsch:

- **Tampermonkey-Kopf:** `@name`/`@description` englisch, `@name:de`/`@description:de` deutsch. Tampermonkey zeigt
  die Sprache des Browsers an.
- **Konsolenmeldungen (Debug):** Tabelle `MESSAGES` im Skript, Sprache nach `navigator.language`. Deutsch bekommt
  deutsche Texte, jede andere Sprache Englisch.
- **Neue Sprache:** Eintrag in `MESSAGES` ergänzen und die Sprachwahl (`lang`) erweitern. Erkennt das Skript die
  Oberfläche nicht, die Erkennungsmuster prüfen: `findPicker()` (Beschriftung mit „Modell“/„model“), `isAuto()`
  (Beschriftung „Auto“ des Standardmodus), `findTemporaryToggle()` (Beschriftung mit „tempor“). `findWorkIqSwitch()`
  nutzt den Produktnamen „Work IQ“ und braucht keine Übersetzung. Die E2E-Tests nutzen deutsche Locatoren
  (`Modellauswahl`, `Neuer Chat`) und laufen nur mit deutscher Oberfläche.

Beim Aktualisieren den Inhalt des **bestehenden** Skripts im Dashboard ersetzen. Wer ein neues Skript anlegt,
muss das alte löschen, sonst laufen beide (der `@name` hat sich geändert).

## Test (Edge + Playwright)

```
npm install
npm test            # i18n-Test, Menü-Test (beide ohne Anmeldung) und danach E2E-Test
npm run test:i18n   # nur Lokalisierung und URL-Flags, Mock-Seiten
npm run test:menu   # nur Menü-Mock: Regel, Eigenwahl, Schleifenschutz, Wiederholung, Fokus, zurückgedrehte Schalter, unruhige Seite
npm run test:e2e    # nur echte Seite in Edge (ändert Einstellungen im Testprofil-Konto)
node tools/mutation-check.mjs   # prüft, dass die Menü-Tests die behobenen Fehler wirklich erkennen (etwa 10 Minuten)
```

Der i18n-Test serviert Mock-Seiten unter der Copilot-URL und prüft Kopf, Startmeldung und Fehlermeldung je
Browsersprache (de-DE, de-AT, en-US, fr-FR) sowie die URL-Flags (Schreibweisen, falsche Wörter, `#online` ohne
Wirkung, kodiertes Komma, Leerzeichen, unbekannte Flags, schon im Zielzustand, Schalter erscheint spät, Nutzer
schaltet zurück, Hash-Wechsel, feste Ausführungsreihenfolge).

Der Menü-Test nutzt eine Mock-Seite mit einem Fluent-ähnlichen Modellmenü. Das Mock übernimmt, was mit
`tools/menu-probe.mjs` auf der echten Seite gemessen wurde: Der Fokus wandert auf den ersten Menüeintrag und beim
Schließen zurück auf den Wähler, der Wähler trägt `aria-expanded`, solange sein Menü offen ist, und jedes Menü ist
per `aria-labelledby` mit seinem Auslöser beschriftet. Geprüft werden die Regel „unterster aktiver Eintrag“
(Untermenü per Hover, Klick oder Pfeil rechts, letzter Eintrag deaktiviert), Fokus (auch wenn der Nutzer ihn
woanders hingesetzt hat oder die Seite das Eingabefeld neu aufbaut), Eigenwahl (ein echter Klick oder eine Taste auf
dem Wähler oder in seinem Menü zählt; Tab, ein fremdes Menü und eine Taste, während das Skript das Menü bedient,
zählen nicht), der Schleifenschutz (auch das Ende der Pause und das gleitende Fenster), Wiederholung und Deckel bei
Fehlversuchen, ein Hash-Wechsel während des Umschaltens, von der Seite zurückgedrehte Schalter (auch nur über
`aria-checked`/`aria-pressed` und nach dem Prüffenster), ein Schalter, den der Nutzer vor dem Anwenden des Flags
bedient, und eine Seite, die sich alle 100 ms ändert. Pause, Fenster und Prüffenster werden je Fall verkürzt, indem
Zahlen des `CFG`-Blocks im geladenen Skripttext ersetzt werden; so lässt sich die Logik testen, ohne die echten
Zeiten abzuwarten.

`tools/mutation-check.mjs` baut jeden behobenen Fehler und jede Sicherung in eine Kopie des Skripts ein (28
Mutanten) und verlangt, dass die zugehörige Prüfung dann fehlschlägt. Das Werkzeug sichert sich gegen falsche
Ergebnisse ab: Zuerst muss ein Basislauf auf dem unveränderten Skript grün sein, jede Änderung muss genau einmal
passen, jede Mutante muss sich parsen lassen, nur die erwarteten Prüfungen dürfen fehlschlagen, und eine Mutante, die
kein Test vom Original unterscheiden kann (`x-rerun-only`, im Werkzeug begründet), ist als äquivalent erklärt und muss
alles bestehen.

Der E2E-Test startet Edge mit einem eigenen Profil (`.profile/`, nicht Ihr normales Edge-Profil), meldet sich über
Windows-SSO an (Kachel des Kontos über die Umgebungsvariable `M365_SSO_TILE`, z. B. `M365_SSO_TILE=example.com`;
ohne sie meldet man sich im geöffneten Fenster selbst an) und setzt die Auswahl dabei einmal auf Auto zurück. Er
ermittelt den untersten Menüeintrag unabhängig vom Skript, lädt das Skript als Init-Skript und prüft: Umschalten,
richtiges Modell, kein sichtbares Menü beim Umschalten, Eigenwahl, Neuladen, „Neuer Chat“ und dass echte Tastendrücke
während des Umschaltens die Automatik nicht sperren.

Grenze: Tampermonkey selbst läuft im Test nicht (Erweiterungen lassen sich in Edge nicht automatisiert laden).
Das Skript nutzt kein `GM_*`-API (`@grant none`) und läuft daher im Test unverändert.
`tools/debug-run.mjs` zeigt Konsole und Wählerzustand, falls Microsoft die Oberfläche ändert.
`tools/workiq-state.mjs` liest den Work-IQ-Zustand nach frischem Laden (`--set on|off` setzt ihn), und
`tools/workiq-flip-rate.mjs` lädt die Seite mehrfach in frischen Browsern und zählt, wie oft Work IQ von allein
ausgeschaltet endet (Messung: 0 von 12, mit und ohne Skript; in E2E-Läufen mit dem langlebigen Testprofil kam es
trotzdem gelegentlich vor, Ursache unbekannt). `tools/menu-probe.mjs` öffnet auf der echten Seite das Modellmenü,
ohne etwas zu wählen, und zeigt, wohin der Fokus wandert und wie die Menüs beschriftet sind. `tools/b1-repro.mjs`
schickt echte Pfeiltasten, während das Skript das Modell umschaltet, und prüft, dass die Automatik danach nicht
gesperrt ist (`M365_SCRIPT=<Datei>` lässt es gegen einen anderen Skriptstand laufen).

## Lizenz

[MIT](LICENSE)
