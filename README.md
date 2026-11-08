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
- PC ↔ Handy: Einstellungen → Exportieren / Importieren (JSON, z. B. über OneDrive). Beim Import wird zusammengeführt.
- Der API-Key wird nur lokal gespeichert, nie exportiert, und geht direkt an api.anthropic.com.

## KI-Chat
Anthropic API-Key in den Einstellungen eintragen (console.anthropic.com → API Keys). Standardmodell: Claude Opus 5.5, Gründlichkeit „Schnell“.
Claudia kann Aufgaben ansehen, anlegen, ändern, abhaken sowie Notizen speichern und durchsuchen.

## Diktat & WhatsApp
- 🎙 auf der Startseite oder im Chat: sprechen, nochmal tippen (oder Pause) → Text geht an Claudia.
- Claudia korrigiert den diktierten Text und fragt, ob und an wen er gehen soll. Nennst du den Empfänger gleich im Diktat („Schreib Maria, dass …“), kommt sofort der Entwurf.
- Der Entwurf ist editierbar; „In WhatsApp öffnen“ öffnet WhatsApp mit Kontakt und Text, dort tippst du auf Senden.
- Kontakte mit internationaler Nummer (+49 …) unter ⚙︎ → Kontakte; auf Android auch aus dem Telefonbuch übernehmbar.
- Spracherkennung: Chrome/Edge am PC, Chrome auf Android, Safari auf dem iPhone. Fallback: Mikrofon der Handy-Tastatur.

Bei einer Sicherheits-Ablehnung springt automatisch ein Ersatzmodell ein (`fallbacks: "default"`).
