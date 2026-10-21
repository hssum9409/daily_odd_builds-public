@echo off
cd /d "%~dp0"
dartaotruntime.exe token-scale.aot install --consent --payload-root "%~dp0."
if errorlevel 1 pause
