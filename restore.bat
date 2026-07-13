@echo off
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

echo ==================================================
echo    Восстановление базы Bytwise из бэкапа
echo ==================================================
echo.
echo Перед началом ОСТАНОВИ сервер (закрой окно start.bat / API),
echo иначе базу не получится заменить.
echo.

rem --- 1. Файл бэкапа (можно перетащить мышкой в это окно) ---
set "BACKUP="
set /p "BACKUP=Перетащи сюда файл бэкапа (.sql.gz) и нажми Enter: "
set "BACKUP=%BACKUP:"=%"
if not exist "%BACKUP%" (
  echo.
  echo [Ошибка] Файл не найден: %BACKUP%
  pause & exit /b 1
)

rem --- 2. Найти psql.exe (любая установленная версия PostgreSQL) ---
set "PSQL="
for %%V in (18 17 16 15 14 13) do (
  if exist "C:\Program Files\PostgreSQL\%%V\bin\psql.exe" set "PSQL=C:\Program Files\PostgreSQL\%%V\bin\psql.exe"
)
if not defined PSQL (
  echo.
  echo [Ошибка] Не нашёл psql.exe в C:\Program Files\PostgreSQL\*\bin
  echo Сначала установи PostgreSQL.
  pause & exit /b 1
)

rem --- 3. Распаковать .gz в .sql (через Node, он стоит вместе с проектом) ---
set "SQL=%TEMP%\calorieyka_restore.sql"
echo Распаковываю архив...
node -e "const z=require('zlib'),f=require('fs');f.writeFileSync(process.argv[2],z.gunzipSync(f.readFileSync(process.argv[1])))" "%BACKUP%" "%SQL%"
if errorlevel 1 (
  echo.
  echo [Ошибка] Не удалось распаковать файл. Это точно .sql.gz из чата?
  pause & exit /b 1
)

rem --- 4. Пароль суперпользователя postgres ---
echo.
set "PGPW="
set /p "PGPW=Введи пароль пользователя postgres: "

echo.
echo ВНИМАНИЕ: текущая база будет ПОЛНОСТЬЮ заменена данными из бэкапа.
set "OK="
set /p "OK=Продолжить? Напиши y и Enter: "
if /i not "%OK%"=="y" (echo Отменено. & pause & exit /b 0)

rem --- 5. Пересоздать базу и залить дамп ---
set "PGPASSWORD=%PGPW%"
"%PSQL%" -U postgres -h localhost -c "CREATE ROLE calorie WITH LOGIN PASSWORD 'calorie';" 2>nul
"%PSQL%" -U postgres -h localhost -c "DROP DATABASE IF EXISTS calorieyka;"
"%PSQL%" -U postgres -h localhost -c "CREATE DATABASE calorieyka OWNER calorie;"
if errorlevel 1 (
  echo.
  echo [Ошибка] Не удалось пересоздать базу. Возможно сервер ещё запущен
  echo или неверный пароль postgres.
  pause & exit /b 1
)

set "PGPASSWORD=calorie"
"%PSQL%" -U calorie -h localhost -d calorieyka -f "%SQL%"
if errorlevel 1 (
  echo.
  echo [Ошибка] Импорт прошёл с ошибками. Смотри сообщения выше.
  pause & exit /b 1
)

del "%SQL%" >nul 2>&1
echo.
echo ==================================================
echo   Готово! База восстановлена из бэкапа.
echo   Теперь запусти сервер снова (start.bat).
echo ==================================================
pause
