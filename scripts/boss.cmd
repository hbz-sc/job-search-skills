@echo off
setlocal
if "%~1"=="jobpilot" goto python_jobpilot
if not defined BOSS_NODE set "BOSS_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%BOSS_NODE%" (
  echo Node 24 missing. Set BOSS_NODE to node.exe.
  exit /b 1
)
"%BOSS_NODE%" "%~dp0runner.mjs" %*
exit /b %errorlevel%

:python_jobpilot
call "%~dp0jobpilot.cmd" %*
exit /b %errorlevel%
