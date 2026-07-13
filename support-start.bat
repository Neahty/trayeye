@echo off
cd /d "%~dp0"
set "ROOT=%CD%"

echo ==============================================
echo   Bytwise SUPPORT bot - Launcher
echo ==============================================

REM --- sanity: support folder present next to this script? ---
if not exist "%ROOT%\support\package.json" (
  echo [ERROR] support\package.json not found next to support-start.bat.
  pause
  exit /b 1
)

REM --- install dependencies (only if missing) ---
if not exist "%ROOT%\support\node_modules" (
  echo Installing dependencies...
  cd /d "%ROOT%\support"
  call npm install
  cd /d "%ROOT%"
)

REM --- start the bot in its own window ---
REM PostgreSQL must be running (start.bat keeps it as a Windows service);
REM if it is not, the bot exits with a clear message in its window.
start "Bytwise SUPPORT" cmd /k "cd /d "%ROOT%\support" && npm start"

echo.
echo Support bot started (window "Bytwise SUPPORT").
echo To stop it: support-stop.bat
pause
exit /b 0
