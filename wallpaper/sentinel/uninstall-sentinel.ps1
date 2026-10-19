#Requires -RunAsAdministrator
# Removes the Cogitator Sentinel task and every firewall block it created with NOT OK.
# Run from PowerShell opened as administrator:
#   powershell -ExecutionPolicy Bypass -File C:\cogitator\wallpaper\sentinel\uninstall-sentinel.ps1
# Left in place on purpose: C:\ProgramData\CogitatorSentinel (its memory, quarantined autostart items,
# the hosts backup, disabled-autostart.txt) and the firewall/audit logging settings.
Stop-ScheduledTask -TaskName 'Cogitator Sentinel' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Cogitator Sentinel' -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -Group 'Cogitator Sentinel' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Cogitator Sentinel removed, its firewall blocks lifted.'
