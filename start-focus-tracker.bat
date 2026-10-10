@echo off
cd /d "%~dp0"
netstat -ano | findstr ":19264" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  start http://localhost:19264/
  exit /b 0
)
echo Starting Focus Tracker at http://localhost:19264/
echo Leave this window open while you use the app. Close it to stop.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:19264/"
pnpm dev
if errorlevel 1 pause
