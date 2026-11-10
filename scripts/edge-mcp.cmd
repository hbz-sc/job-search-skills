@echo off
setlocal
if not defined BOSS_NODE set "BOSS_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%BOSS_NODE%" (
  echo Node runtime missing. Set BOSS_NODE to node.exe.
  exit /b 1
)
if "%~1"=="" (
  echo Usage: edge-mcp.cmd PROFILE_DIRECTORY
  exit /b 1
)
"%BOSS_NODE%" "%~dp0..\node_modules\@playwright\mcp\cli.js" --extension --browser msedge --profile-dir-name "%~1" --image-responses omit --no-webmcp --output-dir "%~dp0..\output\playwright-mcp"
exit /b %errorlevel%
