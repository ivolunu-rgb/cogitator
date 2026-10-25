@echo off
rem Double-click to install the Cogitator live wallpaper (runs install.ps1 next to this file).
cd /d "%~dp0"
echo.
echo   COGITATOR LIVE WALLPAPER
echo.
echo   1 - Warhammer 40,000
echo   2 - Evangelion
echo.
choice /c 12 /n /m "  Choose a theme [1/2]: "
if errorlevel 2 (set THEME=eva) else (set THEME=40k)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Theme %THEME%
echo.
pause
