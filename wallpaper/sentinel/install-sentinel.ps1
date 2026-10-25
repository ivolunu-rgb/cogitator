#Requires -RunAsAdministrator
# Installs the Cogitator Sentinel. Run once from PowerShell opened as administrator:
#   powershell -ExecutionPolicy Bypass -File C:\cogitator\wallpaper\sentinel\install-sentinel.ps1
#
# What it does:
#   1. copies sentinel.ps1 into C:\ProgramData\CogitatorSentinel, a folder only administrators can change
#      (the script runs as SYSTEM, so ordinary programs must not be able to edit it)
#   2. turns on the firewall's log of dropped incoming packets and auditing of failed logons
#   3. registers the "Cogitator Sentinel" task: runs as SYSTEM at startup, restarts if it stops
# Undo with uninstall-sentinel.ps1.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = 'C:\ProgramData\CogitatorSentinel'
# the wallpaper server drops verdicts here (next to server.js)
$inbox = Join-Path (Split-Path -Parent $here) 'sentinel-inbox'

New-Item -ItemType Directory -Force $data, $inbox | Out-Null

# a running sentinel keeps its script open: stop it before replacing the file
Stop-ScheduledTask -TaskName 'Cogitator Sentinel' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*$data\sentinel.ps1*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# whatever happens below, the sentinel must not be left stopped
try {

# Administrators own it; Administrators and SYSTEM may write; Users may only read.
# takeown first: files the sentinel created as SYSTEM may not let an administrator in otherwise.
takeown /F $data /R /A | Out-Null
icacls $data /setowner '*S-1-5-32-544' /T /C | Out-Null
# the rights are set on the folder alone; everything inside inherits them
# (applying the folder's (OI)(CI) grants to files with /T leaves the files with no rights at all)
icacls $data /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
icacls "$data\*" /reset /T /C | Out-Null
try {
    Copy-Item (Join-Path $here 'sentinel.ps1') $data -Force
} catch {
    Write-Host "Could not replace $data\sentinel.ps1: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Its permissions now:' -ForegroundColor Red
    icacls "$data\sentinel.ps1"
    Write-Host 'If the permissions look right, an antivirus (e.g. 360 Total Security) is likely blocking it.' -ForegroundColor Red
    throw
}

# the user whose autostart entries are watched; keep the original install date (the learning period counts from it)
$configPath = Join-Path $data 'config.json'
$installedAt = (Get-Date).ToString('o')
if (Test-Path $configPath) { $installedAt = (Get-Content $configPath -Raw | ConvertFrom-Json).installedAt }
$config = @{
    userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    userProfile = $env:USERPROFILE
    inbox = $inbox
    installedAt = $installedAt
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

# what the sentinel needs to see: knocks the firewall drops, failed logons ("Logon" audit subcategory)
Set-NetFirewallProfile -All -LogBlocked True -LogMaxSizeKilobytes 16384
auditpol /set /subcategory:'{0CCE9215-69AE-11D9-BED3-505054503030}' /failure:enable | Out-Null

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$data\sentinel.ps1`""
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'Cogitator Sentinel' -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
    -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

Write-Host 'Cogitator Sentinel installed and running. The first 3 days it learns what is normal for this machine.'

} finally {
    Start-ScheduledTask -TaskName 'Cogitator Sentinel' -ErrorAction SilentlyContinue
}
