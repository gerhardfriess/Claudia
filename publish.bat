@echo off
rem Claudia auf GitHub Pages veroeffentlichen (https://gerhardfriess.github.io/Claudia/)
cd /d "%~dp0"
git pull --rebase
git add -A
git commit -m "Claudia aktualisiert %date% %time%"
git push
echo.
echo Fertig. In 1-2 Minuten ist die neue Version online.
pause
