@echo off
cd /d "%~dp0"
echo Stopping Bytwise services (API + Caddy)...
taskkill /F /IM caddy.exe >nul 2>nul
REM Stop the API node process by window title (started as "Bytwise SERVER")
taskkill /F /FI "WINDOWTITLE eq Bytwise SERVER*" >nul 2>nul
echo.
echo Note: native PostgreSQL keeps running as a Windows service (recommended).
echo To stop it manually:  net stop postgresql-x64-16   (service name may vary)
echo Done.
pause
