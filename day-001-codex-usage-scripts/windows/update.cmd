@echo off
cd /d "%TEMP%"
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
set "updateExit=%errorlevel%"
if not "%updateExit%"=="0" pause
exit /b %updateExit%
