@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'http://localhost:5500/01-login.html' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  start "StockSync Servidor" /min node "%~dp0servidor-local.js"
  timeout /t 2 /nobreak >nul
)

start "" "http://localhost:5500/01-login.html"
endlocal
