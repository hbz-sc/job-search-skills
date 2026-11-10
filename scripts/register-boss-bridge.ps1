param([switch]$Apply,[string]$HostName='com.jobsearch.boss_bridge')
$ErrorActionPreference='Stop'
if ($HostName -notmatch '^com\.jobsearch\.boss_bridge(?:\.test_[a-f0-9]{32})?$') { throw 'Invalid host name' }
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceManifest=Join-Path $projectRoot 'extensions\boss-page\manifest.json'
$manifest=Get-Content -LiteralPath $sourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$sha=[System.Security.Cryptography.SHA256]::Create()
try { $hash=$sha.ComputeHash([Convert]::FromBase64String($manifest.key)) } finally { $sha.Dispose() }
$hex=([BitConverter]::ToString($hash) -replace '-','').Substring(0,32).ToLower()
$extensionId=-join ($hex.ToCharArray() | ForEach-Object { [char](97+[Convert]::ToInt32($_.ToString(),16)) })
$manifestPath=Join-Path $projectRoot ('private\boss-extension\hosts\'+$HostName+'.json')
$launcher=Join-Path $projectRoot 'scripts\boss-bridge.cmd'
$python=Join-Path $projectRoot '.venv-mcp-bosszp\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $launcher)) { throw 'Local Python or launcher missing' }
$registryPath='HKCU:\Software\Google\Chrome\NativeMessagingHosts\'+$HostName
if (Test-Path -LiteralPath $registryPath) {
    $old=(Get-Item -LiteralPath $registryPath).GetValue('')
    if ($old -ne $manifestPath) { throw 'Host registration belongs to another location; not overwritten' }
}
$nativeManifest=@{name=$HostName;description='Read-only BOSS page diagnostics';path=$launcher;type='stdio';allowed_origins=@('chrome-extension://'+$extensionId+'/')}
if (!$Apply) {
    [pscustomobject]@{Mode='dry-run';Registry=$registryPath;Manifest=$manifestPath;ExtensionId=$extensionId} | ConvertTo-Json
    exit 0
}
$privateRoot=Join-Path $projectRoot 'private\boss-extension'
New-Item -ItemType Directory -Force -Path $privateRoot | Out-Null
& (Join-Path $PSScriptRoot 'secure-boss-directory.ps1') -Path $privateRoot
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
[System.IO.File]::WriteAllText($manifestPath,($nativeManifest | ConvertTo-Json -Depth 4),(New-Object System.Text.UTF8Encoding($false)))
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Output ('Registered '+$HostName+' for extension '+$extensionId)
