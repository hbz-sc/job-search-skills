@echo off
setlocal
cd /d "%~dp0..\integrations\mcp-bosszp"
"%~dp0..\.venv-mcp-bosszp\Scripts\python.exe" -u -m boss_bridge.main %* 2>>"%~dp0..\private\boss-extension\host-stderr.log"
exit /b %errorlevel%
