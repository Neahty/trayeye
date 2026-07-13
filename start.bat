@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%CD%"

echo ==============================================
echo   Bytwise - All-in-one Launcher (native PostgreSQL)
echo ==============================================

REM --- sanity: project files present next to this script? ---
if not exist "%ROOT%\server\package.json" (
  echo [ERROR] Project files not found next to start.bat.
  echo         Copy the WHOLE project here ^(server, client, admin folders^).
  pause
  exit /b 1
)

REM (optional) postgres superuser password. Leave empty: asked once and saved to .pgsuper
set "PG_SUPERPASS="

REM --- locate psql / pg_isready ---
set "PSQL=psql"
where psql >nul 2>nul
if errorlevel 1 call :find psql PSQL
set "PGISREADY=pg_isready"
where pg_isready >nul 2>nul
if errorlevel 1 call :find pg_isready PGISREADY

REM --- 1. Ensure PostgreSQL is running ---
echo [1/6] Checking PostgreSQL...
call :pgready
if not errorlevel 1 goto pgok
echo       starting service...
net start postgresql-x64-17 >nul 2>nul
net start postgresql-x64-16 >nul 2>nul
net start postgresql-x64-15 >nul 2>nul
net start postgresql-x64-14 >nul 2>nul
net start postgresql >nul 2>nul
call :pgready
if not errorlevel 1 goto pgok
echo [ERROR] PostgreSQL not reachable on localhost:5432.
echo         Install PostgreSQL 16 and run start.bat again.
pause
exit /b 1
:pgok
echo       up.

REM --- 2. Ensure role "calorie" and DB "calorieyka" ---
echo [2/6] Checking database...
if "%PSQL%"=="" goto dbskip
set "PGPASSWORD=calorie"
"%PSQL%" "postgresql://calorie:calorie@localhost:5432/calorieyka" -tAc "SELECT 1" >nul 2>nul
if errorlevel 1 goto dbcreate
set "PGPASSWORD="
echo       ok.
goto dbdone
:dbcreate
set "PGPASSWORD="
set "SUPER=%PG_SUPERPASS%"
if "!SUPER!"=="" if exist "%ROOT%\.pgsuper" set /p SUPER=<"%ROOT%\.pgsuper"
if "!SUPER!"=="" (
  set /p "SUPER=      Enter PostgreSQL 'postgres' password ^(once^): "
  > "%ROOT%\.pgsuper" echo !SUPER!
)
set "PGPASSWORD=!SUPER!"
"%PSQL%" -U postgres -h localhost -c "CREATE ROLE calorie LOGIN PASSWORD 'calorie';" 2>nul
"%PSQL%" -U postgres -h localhost -c "CREATE DATABASE calorieyka OWNER calorie;" 2>nul
set "PGPASSWORD="
set "SUPER="
echo       created.
goto dbdone
:dbskip
echo       psql not found - skipping (migration may fail).
:dbdone

REM --- 3. Install dependencies (only if missing) ---
echo [3/6] Installing dependencies...
call :npmi "%ROOT%\server"
call :npmi "%ROOT%\client"
call :npmi "%ROOT%\admin"

REM --- 4. Apply DB schema + sync admins ---
echo [4/6] Applying DB schema...
cd /d "%ROOT%\server"
call npm run migrate
if errorlevel 1 goto migerr
cd /d "%ROOT%"

REM --- 5. Build frontends ---
echo [5/6] Building client and admin...
cd /d "%ROOT%\client"
call npm run build
if errorlevel 1 goto buildfail
cd /d "%ROOT%\admin"
call npm run build
if errorlevel 1 goto buildfail
cd /d "%ROOT%"
echo       built.

REM --- 6. Start API + Caddy ---
echo [6/6] Starting API server and Caddy...
start "Bytwise SERVER" cmd /k "cd /d "%ROOT%\server" && npm start"
taskkill /F /IM caddy.exe >nul 2>nul
start "Bytwise CADDY" /min cmd /k "cd /d "%ROOT%\caddy" && caddy.exe run"

echo.
echo ==============================================
echo   Done!
echo   API   : http://localhost:4000/api/health
echo   Site  : https://shekspireteam.ru
echo   Admin : https://shekspireteam.ru/admin/
echo ==============================================
pause
exit /b 0

:npmi
REM %1 = folder (quoted). Install deps only if node_modules missing.
if not exist "%~1\node_modules" (
  cd /d "%~1"
  call npm install
  cd /d "%ROOT%"
)
exit /b 0

:migerr
cd /d "%ROOT%"
echo [ERROR] Migration failed.
pause
exit /b 1

:buildfail
cd /d "%ROOT%"
echo [ERROR] Frontend build failed.
pause
exit /b 1

:find
REM %1 = exe base name, %2 = var to set
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\%1.exe" set "%2=%%d\bin\%1.exe"
exit /b 0

:pgready
if "%PGISREADY%"=="" exit /b 0
"%PGISREADY%" -h localhost -p 5432 >nul 2>nul
exit /b %errorlevel%
