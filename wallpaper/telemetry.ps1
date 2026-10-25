# Feeds server.js with what Node can't see cheaply: running games, idle time, removable and fixed drives,
# internet status, network traffic and what is playing.
# Prints one JSON line every few seconds; exits when the server that started it is gone.
param([int]$ParentPid)

# track and drive names may be in any language
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

# "Now playing" from Windows' media sessions (Spotify, browsers, players): WinRT, awaited by hand
$mediaManager = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await($operation, [Type]$type) {
        $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
        [void]$task.Wait(3000)
        return $task.Result
    }
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $mediaManager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { }

function Now-Playing {
    if (-not $mediaManager) { return $null }
    try {
        $s = $mediaManager.GetCurrentSession()
        if (-not $s) { return $null }
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if (-not $p -or -not $p.Title) { return $null }
        return @{ artist = $p.Artist; title = $p.Title; playing = [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing' }
    } catch { return $null }
}

# bytes through the real network cards (not VPN or virtual adapters, which would count twice)
function Net-Bytes {
    $stats = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' |
        Get-NetAdapterStatistics -ErrorAction SilentlyContinue
    return @{
        rx = [double](($stats | Measure-Object ReceivedBytes -Sum).Sum)
        tx = [double](($stats | Measure-Object SentBytes -Sum).Sum)
    }
}
$lastNet = Net-Bytes
$clock = [Diagnostics.Stopwatch]::StartNew()

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

    $disks = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } |
        ForEach-Object { @{ letter = $_.Name.TrimEnd('\'); free = [double]$_.AvailableFreeSpace; total = [double]$_.TotalSize } })

    $netNow = Net-Bytes
    $seconds = [Math]::Max(0.5, $clock.Elapsed.TotalSeconds)
    $clock.Restart()
    $net = @{ down = [Math]::Max(0, ($netNow.rx - $lastNet.rx) / $seconds); up = [Math]::Max(0, ($netNow.tx - $lastNet.tx) / $seconds) }
    $lastNet = $netNow

    $state = @{
        games = @($games.Keys); idle = [Cogitator.Idle]::Seconds(); drives = $drives; online = $online
        disks = $disks; net = $net; media = (Now-Playing)
    }
    try {
        [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress -Depth 3))
        [Console]::Out.Flush()
    } catch { break }

    $round++
    Start-Sleep -Seconds 3
}
