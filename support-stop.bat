@echo off
cd /d "%~dp0"
echo Stopping Bytwise SUPPORT bot...
REM Stop the bot node process by window title (started as "Bytwise SUPPORT")
taskkill /F /FI "WINDOWTITLE eq Bytwise SUPPORT*" >nul 2>nul
echo Done. Main app (start.bat / stop.bat) is not affected.
pause
