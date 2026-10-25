# Installs the Cogitator live wallpaper on this computer, from wherever this folder lives.
#   powershell -ExecutionPolicy Bypass -File install.ps1              (Warhammer 40,000)
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Theme eva   (Evangelion)
# What it does, skipping whatever is already there:
#   1. installs Node.js, Ollama and Lively Wallpaper with winget (installers may ask for permission)
#   2. downloads the small qwen2.5:0.5b model for the machine-spirit's lines
#   3. starts the wallpaper server now and at every logon (a shortcut in the Startup folder)
#   4. puts the wallpaper into Lively's library and turns it on
# The admin page is then at http://127.0.0.1:8484/admin. Remove with uninstall.ps1.
param([ValidateSet('40k', 'eva')][string]$Theme = '40k')

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = "$env:ProgramFiles\nodejs\node.exe"
$ollamaApp = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
$livelyExe = "$env:ProgramFiles\Lively Wallpaper\Lively.exe"
$library = "$env:LOCALAPPDATA\Lively Wallpaper\Library\wallpapers\cogitator"
$startup = [Environment]::GetFolderPath('Startup')

function Step($text) { Write-Host "`n>> $text" -ForegroundColor Green }

# files unpacked from a downloaded zip carry "from the internet" and would ask before running
Get-ChildItem $here -Recurse -File | Unblock-File

function Ensure($name, $id, $test) {
    if (& $test) { Write-Host "   $name is already installed"; return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget is missing: install '$name' by hand, or App Installer from the Microsoft Store, then run this again."
    }
    Write-Host "   installing $name ..."
    winget install --id $id --exact --source winget --silent --accept-package-agreements --accept-source-agreements | Out-Host
    if (-not (& $test)) { throw "$name did not install; install it by hand and run this again." }
}

function Wait-For($what, $seconds, $test) {
    for ($i = 0; $i -lt $seconds; $i++) { if (& $test) { return $true }; Start-Sleep 1 }
    Write-Warning "$what did not answer in $seconds s"
    return $false
}

Step 'Programs'
Ensure 'Node.js' 'OpenJS.NodeJS.LTS' { (Test-Path $nodeExe) -or (Get-Command node -ErrorAction SilentlyContinue) }
Ensure 'Ollama' 'Ollama.Ollama' { Test-Path $ollamaApp }
Ensure 'Lively Wallpaper' 'rocksdanister.LivelyWallpaper' { Test-Path $livelyExe }

Step 'Model qwen2.5:0.5b'
$ollamaUp = { try { Invoke-RestMethod http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (& $ollamaUp)) { Start-Process $ollamaApp; [void](Wait-For 'Ollama' 60 $ollamaUp) }
$models = try { (Invoke-RestMethod http://127.0.0.1:11434/api/tags).models.name } catch { @() }
if ($models -contains 'qwen2.5:0.5b') {
    Write-Host '   already downloaded'
} else {
    & $ollamaExe pull qwen2.5:0.5b
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ('The model did not download. The wallpaper works without it, just without the spirit''s lines. ' +
            'If the error mentions "non-public ::", your DNS answers "::" for Cloudflare; switch DNS and run: ollama pull qwen2.5:0.5b')
    }
}

Step "Theme: $Theme"
[IO.File]::WriteAllText((Join-Path $here 'settings.json'), (@{ theme = $Theme } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

Step 'Wallpaper server'
$sh = New-Object -ComObject WScript.Shell
$link = $sh.CreateShortcut((Join-Path $startup 'Cogitator wallpaper server.lnk'))
$link.TargetPath = "$env:WINDIR\System32\wscript.exe"
$link.Arguments = '"' + (Join-Path $here 'start-server.vbs') + '"'
$link.WorkingDirectory = $here
$link.Description = 'Cogitator Lively wallpaper server (127.0.0.1:8484)'
$link.Save()
Write-Host '   starts at every logon (Startup folder)'
$serverUp = { try { Invoke-WebRequest http://127.0.0.1:8484/news/settings -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (& $serverUp)) { Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList $link.Arguments }
if (Wait-For 'The wallpaper server' 20 $serverUp) { Write-Host '   running at http://127.0.0.1:8484' }

Step 'Lively wallpaper'
New-Item -ItemType Directory -Force $library | Out-Null
Copy-Item (Join-Path $here 'lively\LivelyInfo.json'), (Join-Path $here 'lively\thumbnail.jpg') $library -Force
# the loader falls back to this folder's offline copy when the server is not up
$offline = ([Uri](Join-Path $here 'www\app.html')).AbsoluteUri
$loader = [IO.File]::ReadAllText((Join-Path $here 'lively\index.html')).Replace('file:///C:/cogitator/wallpaper/www/app.html', $offline)
[IO.File]::WriteAllText((Join-Path $library 'index.html'), $loader, (New-Object Text.UTF8Encoding $false))
if (-not (Get-Process Lively -ErrorAction SilentlyContinue)) { Start-Process $livelyExe; Start-Sleep 8 }
& $livelyExe setwp --file "$library"
Write-Host '   set as the wallpaper'

Write-Host "`nDone. Admin page (pictures, news, theme): http://127.0.0.1:8484/admin" -ForegroundColor Green
Write-Host 'Put pictures for the carousel into the art folder, or upload them in the admin page.'
