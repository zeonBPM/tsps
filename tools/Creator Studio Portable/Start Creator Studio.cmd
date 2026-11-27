@echo off
title Creator Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Install it from https://nodejs.org  ^(version 18 or newer^), then double-click this file again.
  echo   If you run your game server from a special terminal, open that terminal in this folder and run:
  echo       node server.js --open
  echo.
  pause
  exit /b 1
)
node server.js --open
echo.
echo   The studio has stopped. Close this window, or press a key to close it.
pause >nul
