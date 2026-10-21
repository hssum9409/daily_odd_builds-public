@echo off
setlocal
if "%~1"=="" goto background
if /i "%~1"=="start" goto background
if /i "%~1"=="connect" goto connect
set /p TOKEN_SCALE_CURRENT=<"%~dp0current.txt"
set /p TOKEN_SCALE_DATA=<"%~dp0data-home.txt"
"%~dp0runtime\dartaotruntime.exe" "%~dp0versions\%TOKEN_SCALE_CURRENT%\token-scale.aot" %* --install-root "%~dp0." --home "%TOKEN_SCALE_DATA%"
exit /b %errorlevel%
:background
"%WINDIR%\System32\wscript.exe" //B //NoLogo "%~dp0launch.vbs"
exit /b %errorlevel%
:connect
"%WINDIR%\System32\wscript.exe" //B //NoLogo "%~dp0launch.vbs" connect
exit /b %errorlevel%
