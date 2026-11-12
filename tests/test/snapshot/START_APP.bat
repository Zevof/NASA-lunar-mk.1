@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Lunar Link Planner - local server

echo ============================================
echo   Lunar Link Planner - startet lokalen Server
echo ============================================
echo.
echo Browser oeffnet sich gleich automatisch unter:
echo   http://127.0.0.1:8765/index.html
echo.
echo Dieses Fenster NICHT schliessen, solange die App laeuft.
echo Zum Beenden: Fenster schliessen oder Strg+C.
echo.

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
echo [FEHLER] Python wurde nicht gefunden.
echo Installiere Python 3 von https://www.python.org/downloads/
echo und aktiviere dabei "Add python.exe to PATH".
echo.
pause
exit /b 1
)

if not exist "%~dp0serve.py" (
echo [FEHLER] serve.py fehlt im Ordner %~dp0
pause
exit /b 1
)

start "" /b cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:8765/index.html"

%PY% "%~dp0serve.py" 8765

echo.
echo Server beendet.
pause
