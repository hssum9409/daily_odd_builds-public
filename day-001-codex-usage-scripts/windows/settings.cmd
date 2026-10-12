@echo off
call "%~dp0start.cmd" -Settings %*
exit /b %errorlevel%
