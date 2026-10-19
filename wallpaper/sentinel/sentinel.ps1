# Cogitator Sentinel: watches the machine for heresy and reports it to the wallpaper.
#   - programs reaching the network that look wrong (new, unsigned, run from Temp/Downloads, odd ports)
#   - gates opened (programs listening to the whole network) and strangers coming through them
#   - knocks the firewall turned away, port scans, failed logons
#   - new autostart entries, hosts file edits, Defender detections
# Runs as SYSTEM from the "Cogitator Sentinel" task (see install-sentinel.ps1); the installed copy lives in
# C:\ProgramData\CogitatorSentinel, where ordinary programs can't change it.
# Verdicts clicked on the wallpaper (OK / NOT OK) arrive as small JSON files in the inbox folder.
param(
    [string]$DataDir = 'C:\ProgramData\CogitatorSentinel',
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
$config = Get-Content (Join-Path $DataDir 'config.json') -Raw | ConvertFrom-Json
$LEARN_DAYS = 3
$SUSPICIOUS_PORTS = @(23, 445, 1337, 3333, 4444, 5555, 6666, 6667, 9001, 9050, 14444, 31337)
$SENSITIVE_PORTS = @(22, 23, 135, 139, 445, 3389, 5900, 5985)
$FIREWALL_LOG = "$env:SystemRoot\System32\LogFiles\Firewall\pfirewall.log"
$HOSTS = "$env:SystemRoot\System32\drivers\etc\hosts"
$RULE_GROUP = 'Cogitator Sentinel'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
$utf8 = New-Object Text.UTF8Encoding $false

# ---------- storage ----------

function Write-Log($message) {
    $line = (Get-Date).ToString('s') + ' ' + $message + "`r`n"
    [IO.File]::AppendAllText((Join-Path $DataDir 'sentinel.log'), $line, $utf8)
}

function Read-Json($name) {
    $p = Join-Path $DataDir $name
    if (-not (Test-Path $p)) { return $null }
    try { return [IO.File]::ReadAllText($p) | ConvertFrom-Json } catch { return $null }
}

# write-then-rename, so the wallpaper server never reads half a file
function Write-Json($name, $obj) {
    $p = Join-Path $DataDir $name
    # -InputObject keeps a one-element array an array (piping would unroll it)
    [IO.File]::WriteAllText("$p.tmp", (ConvertTo-Json -InputObject $obj -Depth 6 -Compress), $utf8)
    Move-Item "$p.tmp" $p -Force
}

function Now-Ms { [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }

# What this machine considers normal: learned at first start and during the first days, plus every OK verdict.
$knownRaw = Read-Json 'known.json'
$baseline = -not $knownRaw
$known = @{}
foreach ($k in 'apps', 'ports', 'listeners', 'inbound', 'autostart', 'ips') {
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    if ($knownRaw -and $knownRaw.$k) { foreach ($v in $knownRaw.$k) { [void]$set.Add($v) } }
    $known[$k] = $set
}
$knownDirty = $baseline

function Learn($kind, $key) {
    if ($known[$kind].Add($key)) { $script:knownDirty = $true }
}

function Save-Known {
    $out = @{}
    foreach ($k in $known.Keys) { $out[$k] = @($known[$k]) }
    Write-Json 'known.json' $out
    $script:knownDirty = $false
}

$alerts = New-Object System.Collections.ArrayList
# ForEach-Object unrolls the array Windows PowerShell's ConvertFrom-Json hands over as a single object
foreach ($a in @(Read-Json 'alerts.json' | ForEach-Object { $_ })) { if ($a) { [void]$alerts.Add($a) } }
$alertsDirty = $false

function Add-Alert($type, $key, $severity, $title, $lines, $data, $actions) {
    $fullKey = "$type|$key"
    foreach ($a in $alerts) { if ($a.status -eq 'pending' -and $a.key -eq $fullKey) { return } }
    [void]$alerts.Add([pscustomobject]@{
        id = [guid]::NewGuid().ToString('N').Substring(0, 12)
        key = $fullKey; type = $type; severity = $severity; title = $title
        lines = @($lines); data = $data; actions = @($actions)
        time = Now-Ms; status = 'pending'; decided = 0; note = ''
    })
    $script:alertsDirty = $true
    Write-Log "ALERT $severity $title"
}

function Save-Alerts {
    # every pending alert, and the last 50 decided ones
    $keep = @($alerts | Where-Object { $_.status -eq 'pending' }) +
        @($alerts | Where-Object { $_.status -ne 'pending' } | Sort-Object decided -Descending | Select-Object -First 50)
    $script:alerts = New-Object System.Collections.ArrayList
    foreach ($a in $keep) { [void]$script:alerts.Add($a) }
    Write-Json 'alerts.json' @($script:alerts)
    $script:alertsDirty = $false
}

# ---------- helpers ----------

function Ip-Kind($ip) {
    # Windows writes "-" where a logon had no network address
    if (-not $ip -or $ip -eq '0.0.0.0' -or $ip -eq '::' -or $ip -eq '*' -or $ip -eq '-') { return 'none' }
    if ($ip -match '^(127\.|::1$)') { return 'loopback' }
    if ($ip -match '^(22[4-9]|23\d|255)\.' -or $ip -match '^ff[0-9a-f]{2}:' -or $ip -match '\.255$') { return 'multicast' }
    if ($ip -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|fe80:|f[cd][0-9a-f]{2}:)') { return 'lan' }
    return 'public'
}

function Proc-Path($p) {
    if ($p -and $p.ExecutablePath) { return $p.ExecutablePath }
    if ($p) { return 'SYSTEM:' + $p.Name }
    return 'SYSTEM:unknown'
}

function Proc-Name($p) {
    if ($p) { return $p.Name.ToUpper() }
    return 'UNKNOWN'
}

$signed = @{}
function Is-Signed($path) {
    if ($path -like 'SYSTEM:*') { return $true }
    if (-not $signed.ContainsKey($path)) {
        try { $signed[$path] = (Get-AuthenticodeSignature -FilePath $path).Status -eq 'Valid' } catch { $signed[$path] = $true }
    }
    return $signed[$path]
}

function Risky-Place($path) {
    return $path -match '\\(Temp|Downloads)\\'
}

$ptr = @{}
function Host-Name($ip) {
    if (-not $ptr.ContainsKey($ip)) {
        $ptr[$ip] = ''
        try {
            $r = Resolve-DnsName $ip -Type PTR -QuickTimeout -DnsOnly -ErrorAction Stop | Select-Object -First 1
            if ($r.NameHost) { $ptr[$ip] = $r.NameHost }
        } catch { }
    }
    return $ptr[$ip]
}

function Target($ip, $port) {
    $name = Host-Name $ip
    $address = if ($ip.Contains(':')) { "[$ip]:$port" } else { "${ip}:$port" }
    if ($name) { return "$address ($name)" }
    return $address
}

# ---------- network: programs reaching out, gates, strangers ----------

$stats = @{ online = 0; listening = 0 }

function Check-Network($learning) {
    $procs = @{}
    foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, Name, ExecutablePath) { $procs[[int]$p.ProcessId] = $p }
    $conns = @(Get-NetTCPConnection -ErrorAction SilentlyContinue)

    $gates = @{}
    foreach ($c in $conns | Where-Object { $_.State -eq 'Listen' }) {
        if ((Ip-Kind $c.LocalAddress) -ne 'none') { continue }   # only gates open to the whole network
        $p = $procs[[int]$c.OwningProcess]
        $path = Proc-Path $p
        $gates[[int]$c.LocalPort] = $true
        $key = "$path|$($c.LocalPort)"
        if ($known.listeners.Contains($key)) { continue }
        if ($baseline -or $learning) { Learn 'listeners' $key; continue }
        $actions = if ($path -like 'SYSTEM:*') { @('ok') } else { @('ok', 'purge') }
        Add-Alert 'listener' $key 'medium' "A GATE HAS OPENED :: $(Proc-Name $p) LISTENS ON PORT $($c.LocalPort)" @(
            "PROCESS :: $path",
            "GATE    :: port $($c.LocalPort), open to the whole network",
            'PURGE   :: firewall bars this program from the network'
        ) @{ path = $path; key = $key; name = (Proc-Name $p) } $actions
    }
    $stats.listening = $gates.Count

    $online = @{}
    foreach ($c in $conns | Where-Object { $_.State -eq 'Established' }) {
        $remote = $c.RemoteAddress -replace '^::ffff:', ''
        $kind = Ip-Kind $remote
        if ($kind -ne 'lan' -and $kind -ne 'public') { continue }
        $p = $procs[[int]$c.OwningProcess]
        $path = Proc-Path $p
        $name = Proc-Name $p
        $port = [int]$c.RemotePort

        if ($gates.ContainsKey([int]$c.LocalPort)) {
            # a stranger came in through an open gate
            $key = "$path|$remote"
            if ($known.inbound.Contains($key) -or $known.ips.Contains($remote)) { continue }
            if ($baseline -or ($learning -and $kind -eq 'lan')) { Learn 'inbound' $key; continue }
            $sev = if ($kind -eq 'public') { 'high' } else { 'medium' }
            Add-Alert 'inbound' $key $sev "STRANGER WITHIN THE WALLS :: $remote ENTERED THROUGH $name" @(
                "PROCESS :: $path (port $($c.LocalPort))",
                "VISITOR :: $(Target $remote $port), $kind",
                'PURGE   :: firewall bars this address from coming in'
            ) @{ ip = $remote; key = $key } @('ok', 'purge')
            continue
        }

        if ($kind -eq 'public') { $online[$path] = $true }
        $omens = @()
        if (Risky-Place $path) { $omens += 'RUNS FROM TEMP/DOWNLOADS' }
        if (-not (Is-Signed $path)) { $omens += 'NO DIGITAL SIGNATURE' }
        $oddPort = $kind -eq 'public' -and $SUSPICIOUS_PORTS -contains $port

        if ($known.apps.Contains($path)) {
            # a trusted program; only a strange port is worth a word, once
            $pkey = "$path|$port"
            if (-not $oddPort -or $known.ports.Contains($pkey)) { continue }
            if ($baseline) { Learn 'ports' $pkey; continue }
            Add-Alert 'net-app' $pkey 'high' "HERETEK SIGNAL :: $name CALLS AN UNHOLY PORT" @(
                "PROCESS :: $path",
                "TARGET  :: $(Target $remote $port)",
                "OMENS   :: port $port is favoured by heretics",
                'PURGE   :: firewall bars this program from the network'
            ) @{ path = $path; key = $pkey; name = $name; port = $pkey } @('ok', 'purge')
            continue
        }

        if ($oddPort) { $omens += "PORT $port FAVOURED BY HERETICS" }
        if ($baseline -or ($learning -and -not $omens.Count)) { Learn 'apps' $path; continue }
        if (-not $omens.Count) { $omens += 'FIRST CONTACT WITH THE NOOSPHERE' }

        $sev = if ((Risky-Place $path) -or $oddPort) { 'high' } elseif (-not (Is-Signed $path)) { 'medium' } else { 'low' }
        $actions = if ($path -like 'SYSTEM:*') { @('ok') } else { @('ok', 'purge') }
        Add-Alert 'net-app' $path $sev "UNKNOWN SPIRIT :: $name REACHES INTO THE NOOSPHERE" @(
            "PROCESS :: $path",
            "TARGET  :: $(Target $remote $port)",
            "OMENS   :: $($omens -join ', ')",
            'PURGE   :: firewall bars this program from the network'
        ) @{ path = $path; key = $path; name = $name } $actions
    }
    $stats.online = $online.Count
}

# ---------- knocks: what the firewall turned away ----------

$fwPos = -1
$knocks = New-Object System.Collections.ArrayList

function Check-Knocks {
    if (-not (Test-Path $FIREWALL_LOG)) { return }
    $len = (Get-Item $FIREWALL_LOG).Length
    if ($script:fwPos -lt 0 -or $len -lt $script:fwPos) { $script:fwPos = $len; return }   # start at the end; reset when rotated
    if ($len -eq $script:fwPos) { return }

    $fs = [IO.File]::Open($FIREWALL_LOG, 'Open', 'Read', 'ReadWrite')
    try {
        [void]$fs.Seek($script:fwPos, 'Begin')
        $text = (New-Object IO.StreamReader($fs)).ReadToEnd()
        $script:fwPos = $len
    } finally { $fs.Close() }

    $now = Now-Ms
    foreach ($line in $text -split "`n") {
        # date time action protocol src-ip dst-ip src-port dst-port size tcpflags tcpsyn tcpack tcpwin icmptype icmpcode info path
        $f = $line.Trim() -split ' '
        if ($f.Count -lt 17 -or $f[2] -ne 'DROP' -or $f[16] -ne 'RECEIVE') { continue }
        $kind = Ip-Kind $f[4]
        if (($kind -ne 'lan' -and $kind -ne 'public') -or (Ip-Kind $f[5]) -eq 'multicast') { continue }
        [void]$knocks.Add([pscustomobject]@{ t = $now; ip = $f[4]; port = $f[7]; kind = $kind })
    }

    # keep a day of knocks
    $script:knocks = New-Object System.Collections.ArrayList
    foreach ($k in @($knocks | Where-Object { $now - $_.t -lt 86400000 })) { [void]$script:knocks.Add($k) }

    foreach ($g in $knocks | Where-Object { $now - $_.t -lt 120000 } | Group-Object ip) {
        $ip = $g.Name
        if ($known.ips.Contains($ip)) { continue }
        $ports = @($g.Group | ForEach-Object { $_.port } | Sort-Object -Unique)
        $kind = $g.Group[0].kind
        if ($ports.Count -ge 8) {
            $sev = if ($kind -eq 'public') { 'high' } else { 'medium' }
            Add-Alert 'scan' $ip $sev "AUGURY PROBE :: $ip SWEEPS THE GATES" @(
                "SOURCE  :: $ip ($kind)$(if (Host-Name $ip) { ', ' + (Host-Name $ip) })",
                "PORTS   :: $($ports.Count) tried in two minutes, all turned away",
                'PURGE   :: firewall bars this address from coming in'
            ) @{ ip = $ip } @('ok', 'purge')
        } elseif ($kind -eq 'public' -and ($ports | Where-Object { $SENSITIVE_PORTS -contains [int]$_ })) {
            Add-Alert 'knock' $ip 'medium' "KNOCKING AT THE GATES :: $ip FROM THE OUTER VOID" @(
                "SOURCE  :: $ip$(if (Host-Name $ip) { ' (' + (Host-Name $ip) + ')' })",
                "PORTS   :: $($ports -join ', '), turned away by the firewall",
                'PURGE   :: firewall bars this address for good'
            ) @{ ip = $ip } @('ok', 'purge')
        }
    }
}

# ---------- failed logons ----------

$lastLogons = Get-Date

function Check-Logons {
    $from = $script:lastLogons
    $script:lastLogons = Get-Date
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625; StartTime = $from } -ErrorAction SilentlyContinue)
    foreach ($e in $events) {
        $d = @{}
        foreach ($n in ([xml]$e.ToXml()).Event.EventData.Data) { $d[$n.Name] = $n.'#text' }
        $user = $d['TargetUserName']
        $ip = $d['IpAddress']
        $kind = Ip-Kind $ip
        if ($kind -eq 'lan' -or $kind -eq 'public') {
            if ($known.ips.Contains($ip)) { continue }
            Add-Alert 'logon' "$ip|$user" 'high' "INTRUDER AT THE GATES :: FAILED LOGON AS '$user'" @(
                "SOURCE  :: $ip ($kind)$(if (Host-Name $ip) { ', ' + (Host-Name $ip) })",
                "LOGON   :: type $($d['LogonType']), from $($d['WorkstationName'])",
                'PURGE   :: firewall bars this address from coming in'
            ) @{ ip = $ip } @('ok', 'purge')
        } else {
            Add-Alert 'logon' "local|$user" 'medium' "THE GENE-LOCK WAS TESTED :: WRONG PASSWORD FOR '$user'" @(
                "WHERE   :: at this machine (logon type $($d['LogonType']))",
                "PROCESS :: $($d['ProcessName'])"
            ) @{ } @('ack')
        }
    }
}

# ---------- autostart, hosts, Defender ----------

function Get-Autostart {
    $items = @()
    $runKeys = @(
        @{ src = 'USER RUN'; key = "Registry::HKEY_USERS\$($config.userSid)\Software\Microsoft\Windows\CurrentVersion\Run" },
        @{ src = 'USER RUNONCE'; key = "Registry::HKEY_USERS\$($config.userSid)\Software\Microsoft\Windows\CurrentVersion\RunOnce" },
        @{ src = 'MACHINE RUN'; key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' },
        @{ src = 'MACHINE RUNONCE'; key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce' },
        @{ src = 'MACHINE RUN (32-BIT)'; key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run' }
    )
    foreach ($r in $runKeys) {
        if (-not (Test-Path $r.key)) { continue }
        $k = Get-Item $r.key
        foreach ($name in $k.GetValueNames()) {
            if (-not $name) { continue }
            $items += [pscustomobject]@{ src = $r.src; where = $r.key; name = $name; command = [string]$k.GetValue($name) }
        }
    }
    $folders = @(
        (Join-Path $config.userProfile 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup'),
        "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
    )
    foreach ($dir in $folders) {
        if (-not (Test-Path $dir)) { continue }
        foreach ($f in Get-ChildItem $dir -File | Where-Object { $_.Name -ne 'desktop.ini' }) {
            $items += [pscustomobject]@{ src = 'STARTUP FOLDER'; where = $f.FullName; name = $f.Name; command = $f.FullName }
        }
    }
    foreach ($t in Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' -and $_.State -ne 'Disabled' }) {
        $cmd = (@($t.Actions) | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join '; '
        $items += [pscustomobject]@{ src = 'SCHEDULED TASK'; where = $t.TaskPath; name = $t.TaskName; command = $cmd }
    }
    return $items
}

# Microsoft-signed programs that run whatever they are told to: never trusted on the signature alone
$LAUNCHERS = @('powershell.exe', 'pwsh.exe', 'cmd.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'rundll32.exe',
    'regsvr32.exe', 'msiexec.exe', 'schtasks.exe', 'certutil.exe', 'bitsadmin.exe', 'conhost.exe', 'explorer.exe',
    'msbuild.exe', 'installutil.exe', 'regasm.exe', 'regsvcs.exe', 'cmstp.exe', 'forfiles.exe', 'wmic.exe', 'hh.exe')

# the program an autostart command starts: quoted path or first token, environment variables expanded
function Command-Program($command) {
    # quoted; unquoted with spaces ("C:\Program Files\x\y.exe /arg"); or a bare first word
    $exe = if ($command -match '^\s*"([^"]+)"') { $Matches[1] }
        elseif ($command -match '^\s*(.+?\.(exe|com))(\s|$)') { $Matches[1] }
        elseif ($command -match '^\s*(\S+)') { $Matches[1] }
        else { '' }
    $exe = [Environment]::ExpandEnvironmentVariables($exe)
    if ($exe -and -not [IO.Path]::IsPathRooted($exe)) {
        $found = Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $exe = $found.Source }
    }
    return $exe
}

function Signed-By-Microsoft($path) {
    if (-not $path -or -not (Test-Path $path -PathType Leaf)) { return $false }
    if ($LAUNCHERS -contains ([IO.Path]::GetFileName($path)).ToLower()) { return $false }
    $s = Get-AuthenticodeSignature -FilePath $path
    return $s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match 'O=Microsoft Corporation'
}

function Check-Autostart {
    foreach ($i in Get-Autostart) {
        $key = "$($i.src)|$($i.name)|$($i.command)"
        if ($known.autostart.Contains($key)) { continue }
        if ($baseline) { Learn 'autostart' $key; continue }
        if ($i.src -ne 'STARTUP FOLDER' -and (Signed-By-Microsoft (Command-Program $i.command))) {
            Learn 'autostart' $key
            Write-Log "autostart accepted (signed by Microsoft): $($i.name) :: $($i.command)"
            continue
        }
        Add-Alert 'autostart' $key 'high' "SOMETHING HAS ROOTED ITSELF IN THE IGNITION RITES :: $($i.name.ToUpper())" @(
            "WHERE   :: $($i.src), $($i.where)",
            "COMMAND :: $($i.command)",
            'PURGE   :: entry disabled (kept aside, can be restored)'
        ) @{ key = $key; src = $i.src; where = $i.where; name = $i.name; command = $i.command } @('ok', 'purge')
    }
}

# hosts without the section Tailscale rewrites on its own (MagicDNS names come and go with the network)
function Hosts-Lines($path) {
    $inside = $false
    foreach ($line in Get-Content $path) {
        if ($line -match 'TailscaleHostsSectionStart') { $inside = $true; continue }
        if ($line -match 'TailscaleHostsSectionEnd') { $inside = $false; continue }
        if (-not $inside) { $line }
    }
}

function Check-Hosts {
    $backup = Join-Path $DataDir 'hosts.bak'
    if (-not (Test-Path $backup)) { Copy-Item $HOSTS $backup; return }
    $hash = (Get-FileHash $HOSTS).Hash
    $settled = $hash -eq (Get-FileHash $backup).Hash -or
        -not (Compare-Object @(Hosts-Lines $backup) @(Hosts-Lines $HOSTS))
    if ($settled) {
        # only Tailscale's section moved: take it as the new normal
        if ($hash -ne (Get-FileHash $backup).Hash) { Copy-Item $HOSTS $backup -Force }
        # a change that has already been undone needs no verdict
        foreach ($a in $alerts) {
            if ($a.type -eq 'hosts' -and $a.status -eq 'pending') {
                $a.status = 'sanctioned'; $a.note = 'hosts file returned to normal'; $a.decided = Now-Ms
                $script:alertsDirty = $true
            }
        }
        return
    }
    $added = @(Compare-Object @(Get-Content $backup) @(Get-Content $HOSTS) |
        Where-Object { $_.SideIndicator -eq '=>' -and $_.InputObject.Trim() -and $_.InputObject -notmatch '^\s*#' } |
        ForEach-Object { $_.InputObject.Trim() } | Select-Object -First 3)
    if (-not $added.Count) { $added = @('(only comments or removals)') }
    Add-Alert 'hosts' $hash 'high' 'THE NOOSPHERE MAP WAS ALTERED :: HOSTS FILE CHANGED' (
        @($added | ForEach-Object { "NEW     :: $_" }) + 'PURGE   :: the previous hosts file is restored'
    ) @{ } @('ok', 'purge')
}

$lastDefender = Get-Date

function Check-Defender {
    $from = $script:lastDefender
    $script:lastDefender = Get-Date
    foreach ($d in @(Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { $_.InitialDetectionTime -gt $from })) {
        $threat = Get-MpThreat -ThreatID $d.ThreatID -ErrorAction SilentlyContinue
        $name = if ($threat) { $threat.ThreatName } else { "threat $($d.ThreatID)" }
        Add-Alert 'av' "$($d.ThreatID)|$($d.InitialDetectionTime.Ticks)" 'high' "DAEMON BANISHED BY THE SACRED WARDS :: $name" @(
            "WHERE   :: $(@($d.Resources) -join ', ')",
            'Windows Defender has already dealt with it'
        ) @{ } @('ack')
    }
}

# ---------- verdicts ----------

function Block-Program($a) {
    foreach ($dir in 'Outbound', 'Inbound') {
        New-NetFirewallRule -DisplayName "$RULE_GROUP :: $($a.data.name) ($dir)" -Group $RULE_GROUP `
            -Direction $dir -Program $a.data.path -Action Block | Out-Null
    }
}

function Block-Address($ip) {
    New-NetFirewallRule -DisplayName "$RULE_GROUP :: $ip" -Group $RULE_GROUP `
        -Direction Inbound -RemoteAddress $ip -Action Block | Out-Null
}

function Disable-Autostart($d) {
    if ($d.src -eq 'STARTUP FOLDER') {
        $q = Join-Path $DataDir 'quarantine'
        New-Item -ItemType Directory -Force $q | Out-Null
        Move-Item $d.where (Join-Path $q $d.name) -Force
    } elseif ($d.src -eq 'SCHEDULED TASK') {
        Disable-ScheduledTask -TaskPath $d.where -TaskName $d.name | Out-Null
    } else {
        # remember the value so it can be put back by hand
        [IO.File]::AppendAllText((Join-Path $DataDir 'disabled-autostart.txt'),
            "$(Get-Date -Format s)`t$($d.where)`t$($d.name)`t$($d.command)`r`n", $utf8)
        Remove-ItemProperty -Path $d.where -Name $d.name
    }
}

function Trust($a) {
    switch ($a.type) {
        'net-app' { if ($a.data.port) { Learn 'ports' $a.data.port } else { Learn 'apps' $a.data.path } }
        'listener' { Learn 'listeners' $a.data.key }
        'inbound' { Learn 'inbound' $a.data.key }
        'autostart' { Learn 'autostart' $a.data.key }
        'hosts' { Copy-Item $HOSTS (Join-Path $DataDir 'hosts.bak') -Force }
        default { if ($a.data.ip) { Learn 'ips' $a.data.ip } }
    }
}

function Purge($a) {
    switch ($a.type) {
        'net-app' { Block-Program $a; if ($a.data.port) { Learn 'ports' $a.data.port } else { Learn 'apps' $a.data.path } }
        'listener' { Block-Program $a; Learn 'listeners' $a.data.key }
        'autostart' { Disable-Autostart $a.data; Learn 'autostart' $a.data.key }
        'hosts' { Copy-Item (Join-Path $DataDir 'hosts.bak') $HOSTS -Force }
        default { Block-Address $a.data.ip; Learn 'ips' $a.data.ip }
    }
}

function Apply-Verdicts {
    if (-not (Test-Path $config.inbox)) { return }
    foreach ($f in Get-ChildItem $config.inbox -Filter '*.json') {
        $v = $null
        try { $v = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { }
        Remove-Item $f.FullName -Force
        if (-not $v -or $v.id -notmatch '^[0-9a-f]{12}$') { continue }
        $a = $alerts | Where-Object { $_.id -eq $v.id -and $_.status -eq 'pending' } | Select-Object -First 1
        if (-not $a) { continue }
        try {
            if ($v.verdict -eq 'purge' -and $a.actions -contains 'purge') { Purge $a; $a.status = 'purged' }
            else { Trust $a; $a.status = 'sanctioned' }
        } catch {
            $a.status = 'failed'
            $a.note = $_.Exception.Message
            Write-Log "VERDICT FAILED $($a.title): $($a.note)"
        }
        $a.decided = Now-Ms
        $script:alertsDirty = $true
        Write-Log "VERDICT $($a.status) $($a.title)"
    }
}

# ---------- state for the wallpaper ----------

function Write-State($learning, $learnUntil) {
    $now = Now-Ms
    $day = @($knocks | Where-Object { $now - $_.t -lt 86400000 })
    Write-Json 'state.json' ([pscustomobject]@{
        running = $true
        updated = $now
        admin = $isAdmin
        learning = $learning
        learningUntil = ([DateTimeOffset]$learnUntil).ToUnixTimeMilliseconds()
        online = $stats.online
        listening = $stats.listening
        knocks = @{ lan = @($day | Where-Object { $_.kind -eq 'lan' }).Count; outer = @($day | Where-Object { $_.kind -eq 'public' }).Count }
        pending = @($alerts | Where-Object { $_.status -eq 'pending' } | Sort-Object time | Select-Object -First 20)
        recent = @($alerts | Where-Object { $_.status -ne 'pending' } | Sort-Object decided -Descending | Select-Object -First 5)
    })
}

# ---------- main loop ----------

function Run-Check($name, [scriptblock]$check) {
    try { & $check } catch { Write-Log "ERROR in ${name}: $($_.Exception.Message)" }
}

Write-Log "start (admin: $isAdmin, baseline: $baseline)"
$learnUntil = ([datetime]$config.installedAt).AddDays($LEARN_DAYS)
$tick = 0
while ($true) {
    $learning = (Get-Date) -lt $learnUntil
    Run-Check 'network' { Check-Network $learning }
    Run-Check 'knocks' { Check-Knocks }
    if ($isAdmin) { Run-Check 'logons' { Check-Logons } }
    if ($tick % 12 -eq 0) {
        Run-Check 'autostart' { Check-Autostart }
        Run-Check 'hosts' { Check-Hosts }
        Run-Check 'defender' { Check-Defender }
    }
    Run-Check 'verdicts' { Apply-Verdicts }

    if ($baseline) {
        $baseline = $false
        Write-Log 'baseline learned: this machine as it is now is considered pure'
    }
    Run-Check 'save' {
        if ($knownDirty) { Save-Known }
        if ($alertsDirty) { Save-Alerts }
        Write-State $learning $learnUntil
    }

    if ($Once) { break }
    $tick++
    Start-Sleep -Seconds 5
}
