@echo off
rem Double-click to remove the Cogitator live wallpaper (runs uninstall.ps1 next to this file).
cd /d "%~dp0"
choice /c yn /m "Remove the Cogitator wallpaper"
if errorlevel 2 exit /b
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
