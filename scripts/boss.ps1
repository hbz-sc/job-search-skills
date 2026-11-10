param(
  [Parameter(Position=0)][string]$Command = 'status',
  [string]$NodePath = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$CommandArgs
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (!(Test-Path -LiteralPath $NodePath)) { throw 'Node 24 not found. Supply -NodePath.' }
$nodeVersion = & $NodePath -p 'process.versions.node'
if ($nodeVersion -notmatch '^24\.') { throw "Node 24 required; got $nodeVersion" }
$previousPath = $env:PATH
Push-Location $projectRoot
try {
  $env:PATH = (Split-Path $NodePath -Parent) + ';' + $previousPath
  switch ($Command) {
    'install' {
      $npmCommand = Get-Command npm.cmd -ErrorAction Stop
      $npmEntry = Join-Path (Split-Path $npmCommand.Source -Parent) 'node_modules\npm\bin\npm-cli.js'
      if (!(Test-Path -LiteralPath $npmEntry)) { throw 'npm-cli.js not found beside npm.cmd' }
      & $NodePath $npmEntry install @CommandArgs
    }
    'test' { & $NodePath 'node_modules/vitest/vitest.mjs' run @CommandArgs }
    'typecheck' { & $NodePath 'node_modules/typescript/bin/tsc' --noEmit }
    'build' { & $NodePath 'node_modules/typescript/bin/tsc' }
    'browser-install' { & $NodePath 'node_modules/playwright/cli.js' install chromium }
    default {
      if (!(Test-Path -LiteralPath 'dist/src/cli.js')) { throw 'Run scripts/boss.ps1 build first.' }
      & $NodePath 'dist/src/cli.js' $Command @CommandArgs
    }
  }
  $resultCode = $LASTEXITCODE
} finally { $env:PATH = $previousPath; Pop-Location }
exit $resultCode
