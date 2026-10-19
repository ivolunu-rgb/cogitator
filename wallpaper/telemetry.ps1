# Feeds server.js with what Node can't see cheaply: running games, idle time, removable drives, internet status.
# Prints one JSON line every few seconds; exits when the server that started it is gone.
param([int]$ParentPid)

Add-Type -Namespace Cogitator -Name Idle -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")]
static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
public static uint Seconds() {
    var info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    GetLastInputInfo(ref info);
    return unchecked((uint)Environment.TickCount - info.dwTime) / 1000;
}
'@

# Folders whose subfolders are games: Steam libraries, Epic, GOG, Xbox.
$roots = New-Object System.Collections.Generic.List[string]
$steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
if ($steam) {
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) {
        foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
            $roots.Add(($m.Groups[1].Value -replace '\\\\', '\') + '\steamapps\common\')
        }
    }
}
foreach ($r in "$env:ProgramFiles\Epic Games\", "${env:ProgramFiles(x86)}\GOG Galaxy\Games\", 'C:\XboxGames\') { $roots.Add($r) }
$notGames = @('Steamworks Shared', 'SteamVR', 'Steam Controller Configs')

$round = 0
$online = $null
while ($true) {
    if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }

    $games = @{}
    foreach ($p in Get-Process) {
        $exe = $p.Path
        if (-not $exe) { continue }
        foreach ($r in $roots) {
            if ($exe.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) {
                $name = $exe.Substring($r.Length).Split('\')[0]
                if ($notGames -notcontains $name) { $games[$name] = $true }
            }
        }
    }

    $drives = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Removable' -and $_.IsReady } |
        ForEach-Object { @{ letter = $_.Name; label = $_.VolumeLabel } })

    # Windows' own connectivity check, no requests of ours; refreshed every ~15 s.
    if ($round % 5 -eq 0) {
        $online = [bool](Get-NetConnectionProfile -ErrorAction SilentlyContinue |
            Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv6Connectivity -eq 'Internet' })
    }

    $state = @{ games = @($games.Keys); idle = [Cogitator.Idle]::Seconds(); drives = $drives; online = $online }
    try {
        [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress -Depth 3))
        [Console]::Out.Flush()
    } catch { break }

    $round++
    Start-Sleep -Seconds 3
}
