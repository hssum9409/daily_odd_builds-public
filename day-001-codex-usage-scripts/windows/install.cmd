@echo off
cd /d "%TEMP%"
if "%~1"=="" (
  powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
) else (
  powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Install.ps1" -Launch %*
)
set "installExit=%errorlevel%"
if not "%installExit%"=="0" pause
exit /b %installExit%
