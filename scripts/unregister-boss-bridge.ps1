param([switch]$Apply,[string]$HostName='com.jobsearch.boss_bridge')
$ErrorActionPreference='Stop'
if ($HostName -notmatch '^com\.jobsearch\.boss_bridge(?:\.test_[a-f0-9]{32})?$') { throw 'Invalid host name' }
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifestPath=Join-Path $projectRoot ('private\boss-extension\hosts\'+$HostName+'.json')
$registryPath='HKCU:\Software\Google\Chrome\NativeMessagingHosts\'+$HostName
if (Test-Path -LiteralPath $registryPath) {
    if ((Get-Item -LiteralPath $registryPath).GetValue('') -ne $manifestPath) { throw 'Foreign registration; not removed' }
}
if (!$Apply) { [pscustomobject]@{Mode='dry-run';Registry=$registryPath;Manifest=$manifestPath} | ConvertTo-Json; exit 0 }
if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
if (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath $manifestPath }
Write-Output 'Unregistered only the project native host. Browser and records preserved.'
