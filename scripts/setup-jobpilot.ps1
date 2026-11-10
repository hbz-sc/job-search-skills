param([string]$Python)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) {
    $bridgePython = Join-Path $projectRoot '.venv-mcp-bosszp\Scripts\python.exe'
    $Python = if (Test-Path -LiteralPath $bridgePython) { $bridgePython } else { 'python' }
}
& $Python -c 'import sys; assert sys.version_info[:2] == (3,12), "Python 3.12 required"'
if ($LASTEXITCODE -ne 0) { throw '请用 -Python 指定 Python 3.12 的 python.exe' }
$environmentPath = Join-Path $projectRoot '.venv-jobpilot'
if (-not (Test-Path -LiteralPath (Join-Path $environmentPath 'Scripts\python.exe'))) {
    & $Python -m venv $environmentPath
    if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' }
}
$runtime = Join-Path $environmentPath 'Scripts\python.exe'
& $runtime -m pip install -r (Join-Path $projectRoot 'requirements-python.lock')
if ($LASTEXITCODE -ne 0) { throw 'dependency installation failed' }
& $runtime -m pip install --no-deps -e $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'project installation failed' }
Write-Output 'Ready: .\scripts\jobpilot.cmd demo'
