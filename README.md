# Claudia – persönliche Assistentin

Installierbare Web-App (PWA) für PC und Handy: Tagesübersicht, Aufgaben & Erinnerungen, Notizen und KI-Chat (Claude).

## Dateien
- `index.html`, `styles.css`, `app.js`: die App
- `manifest.webmanifest`, `sw.js`, `icon.svg`: Installation & Offline-Betrieb

## Starten am PC
```
py -3 -m http.server 8770 --directory "<dieser Ordner>"
```
Dann http://localhost:8770 öffnen → in Chrome/Edge über das Installieren-Symbol in der Adressleiste als App installieren.

## Aufs Handy
Online: https://gerhardfriess.github.io/Claudia/ (Repo gerhardfriess/Claudia). Am Handy öffnen → „Zum Startbildschirm hinzufügen“ bzw. „App installieren“. Updates veröffentlichen: publish.bat doppelklicken.

## Daten
- Alles bleibt lokal im Browser des jeweiligen Geräts (localStorage).
- **Sync PC ↔ Handy** (⚙︎ → Sync): Aufgaben, Notizen und Kontakte werden automatisch abgeglichen – beim Start, beim Zurückkehren in die App, nach jeder Änderung und alle 90 s. Speicherort: ein geheimes (nicht gelistetes) Gist (`claudia-sync.json`) im GitHub-Konto, AES-256-verschlüsselt mit dem Sync-Passwort (PBKDF2). Einrichtung auf jedem Gerät mit demselben GitHub-Token (Recht „gist“) und Sync-Passwort. Abgleich je Datensatz gegen den letzten Stand, Löschen wird übertragen; bei gleichzeitiger Änderung gewinnt das Gerät, das gerade synchronisiert.
- Chat, API-Key, Sync-Zugang und Einstellungen bleiben auf dem Gerät.
- Alternativ manuell: Einstellungen → Manuell übertragen → Exportieren / Importieren (JSON).
- Der API-Key wird nur lokal gespeichert, nie exportiert, und geht direkt an api.anthropic.com.

## KI-Chat
Anthropic API-Key in den Einstellungen eintragen (console.anthropic.com → API Keys). Standardmodell: Claude Opus 5.5, Gründlichkeit „Schnell“.
Claudia kann Aufgaben ansehen, anlegen, ändern, abhaken sowie Notizen speichern und durchsuchen.

## Erinnerungen
Aufgaben mit Datum und Uhrzeit klingeln zur Zeit: Alarmton, Ansage („Erinnerung: …“) und ein Alarmfenster mit „Erledigt“ / „10 Min. später“. Funktioniert, solange Claudia geöffnet ist; war sie geschlossen, kommt der Alarm beim nächsten Öffnen (nur für die letzten 12 Stunden). Einstellbar unter ⚙︎ → Erinnerungen, dort auch „Alarm testen“.
Zuverlässig auch bei geschlossener App: 📅 an der Aufgabe (oder im Chat unter „Aufgabe angelegt“, oder im Bearbeiten-Dialog „Speichern + Kalender“) erzeugt einen Kalendertermin (.ics) mit Alarm zur Uhrzeit; am iPhone „Hinzufügen“ tippen.

## Diktat & WhatsApp
- 🎙 auf der Startseite oder im Chat: sprechen, nochmal tippen (oder Pause) → Text geht an Claudia.
- Claudia korrigiert den diktierten Text und fragt, ob und an wen er gehen soll. Nennst du den Empfänger gleich im Diktat („Schreib Maria, dass …“), kommt sofort der Entwurf.
- Der Entwurf ist editierbar; „In WhatsApp öffnen“ öffnet WhatsApp mit Kontakt und Text, dort tippst du auf Senden.
- Kontakte über das Personen-Symbol oben rechts (neben ⚙︎; die Zahl zeigt, wie viele freigegeben sind): Adressbuch als vCard (.vcf) importieren, auf Android auch direkt aus dem Telefonbuch, oder einzeln eintragen (Nummer mit +Ländervorwahl; 0171 … wird beim Import zu +49 171 …).
- **Freigabe per Häkchen:** Claudia sieht nur angehakte Kontakte. Importierte Kontakte sind zunächst nicht freigegeben; nicht angehakte Kontakte gehen nie an die KI.
- Mit ✎ pro Kontakt: E-Mail, Sprache (Nachrichten werden automatisch übersetzt), Alias/Beziehung („meine Frau“) und „Das bin ich“. Claudia kann das auch selbst speichern, wenn du es ihr sagst.
- Entwurf mit E-Mail-Adresse: zusätzlich „Als E-Mail öffnen“ (öffnet dein Mailprogramm mit Betreff und Text).
- Spracherkennung: Chrome/Edge am PC, Chrome auf Android, Safari auf dem iPhone. Fallback: Mikrofon der Handy-Tastatur.

Bei einer Sicherheits-Ablehnung springt automatisch ein Ersatzmodell ein (`fallbacks: "default"`).
