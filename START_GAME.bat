@echo off
title SANI PREMIUM POKER
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 18+ first.
  pause
  exit /b 1
)
if not exist node_modules\ws package.json (
  echo Installing dependencies...
  call npm install
)
start "" http://localhost:3000
node server.js
pause
