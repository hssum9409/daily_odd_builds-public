@echo off
"%WINDIR%\System32\wscript.exe" //B //NoLogo "%~dp0launch.vbs"
exit /b %errorlevel%
