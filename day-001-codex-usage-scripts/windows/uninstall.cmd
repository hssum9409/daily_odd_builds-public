@echo off
cd /d "%TEMP%"
rem CMD must read the whole block before the uninstaller deletes this file.
(
  powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Install.ps1" -Uninstall %*
  if errorlevel 1 (
    pause
    exit /b 1
  )
  rem Returning to a deleted batch file would produce a spurious path error.
  exit 0
)
