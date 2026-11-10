@echo off
setlocal
set "PYTHONUTF8=1"
set "JOBPILOT_PYTHON=%~dp0..\.venv-jobpilot\Scripts\python.exe"
if not exist "%JOBPILOT_PYTHON%" (
  echo Run PowerShell: .\scripts\setup-jobpilot.ps1
  exit /b 1
)
pushd "%~dp0.."
"%JOBPILOT_PYTHON%" -m jobpilot %*
set "JOBPILOT_EXIT=%errorlevel%"
popd
exit /b %JOBPILOT_EXIT%
