@echo off
title XML Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js install illa. https://nodejs.org-la irundhu Node 18 or 20 install pannu.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Dependencies install aaguthu... ^(first time mattum, konjam neram aagum^)
  call npm install
  if errorlevel 1 (
    echo npm install fail aachu.
    pause
    exit /b 1
  )
)

echo.
echo XML Studio start aaguthu... browser-la http://localhost:4200 open aagum
call npx ng serve --open
pause
