@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo ======================================================================
echo [WARNING] Please DO NOT click inside this window to select text!
echo Selecting text in Windows cmd freezes the process and causes timeouts.
echo If the title bar says "Select:", press ENTER to unfreeze it immediately.
echo ======================================================================
echo.
echo [OPTIONAL] If you need a proxy to access Microsoft APIs, enter the proxy port below.
set /p PROXY_PORT="Enter proxy port (e.g. 7890, or press Enter to skip): "
if not "%PROXY_PORT%"=="" (
  set HTTP_PROXY=http://127.0.0.1:%PROXY_PORT%
  set HTTPS_PROXY=http://127.0.0.1:%PROXY_PORT%
  echo Proxy set to: http://127.0.0.1:%PROXY_PORT%
) else (
  echo No proxy configured, using direct connection.
)
echo.

if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

call :resolve_python
if errorlevel 1 goto :python_not_found

if "%~1"=="" (
  call :run_single 17373
  if errorlevel 1 goto :run_failed
  goto :eof
)

set "PORT_ARGS=%*"
set "PORT_ARGS=%PORT_ARGS:,= %"
set "PORT_ARGS=%PORT_ARGS:;= %"

for %%P in (%PORT_ARGS%) do (
  call :start_instance %%~P
)
goto :eof

:resolve_python
where py >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
  call :verify_python
  if not errorlevel 1 exit /b 0
)

where python >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=python"
  set "PYTHON_ARGS="
  call :verify_python
  if not errorlevel 1 exit /b 0
)

where python3 >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=python3"
  set "PYTHON_ARGS="
  call :verify_python
  if not errorlevel 1 exit /b 0
)

for /d %%D in ("%LocalAppData%\Programs\Python\Python*") do (
  if exist "%%~fD\python.exe" (
    set "PYTHON_EXE=%%~fD\python.exe"
    set "PYTHON_ARGS="
    call :verify_python
    if not errorlevel 1 exit /b 0
  )
)

exit /b 1

:verify_python
"%PYTHON_EXE%" %PYTHON_ARGS% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
exit /b %errorlevel%

:run_single
"%PYTHON_EXE%" %PYTHON_ARGS% scripts\hotmail_helper.py --port %~1
exit /b %errorlevel%

:start_instance
start "Hotmail Helper %~1" cmd /k ""%PYTHON_EXE%" %PYTHON_ARGS% scripts\hotmail_helper.py --port %~1"
exit /b 0

:python_not_found
echo Python 3.10+ was not found or is not runnable.
echo Please install Python 3.10+ from python.org and enable "Add python.exe to PATH".
echo If Windows opens Microsoft Store, disable App execution aliases for python.exe/python3.exe.
pause
exit /b 1

:run_failed
echo.
echo Hotmail helper failed to start.
echo Common causes: port 17373 is already in use, or Python failed while starting the helper.
echo Try running this command from this folder to see the full error:
echo   python scripts\hotmail_helper.py --port 17373
pause
exit /b 1

:usage
echo Usage:
echo   start-hotmail-helper.bat
echo   start-hotmail-helper.bat 17373
echo   start-hotmail-helper.bat 17373 17374 17375
echo   start-hotmail-helper.bat 17373,17374,17375
echo.
echo No arguments: start one helper on the default port 17373 in the current window.
echo One or more ports: launch one helper window per port.
exit /b 0
