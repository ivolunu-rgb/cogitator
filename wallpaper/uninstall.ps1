# Removes the Cogitator live wallpaper: its autostart, the running server and its place in Lively.
# Node.js, Ollama and Lively themselves stay (remove them in Windows settings if you like),
# and so does this folder with your pictures.
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Cogitator wallpaper server.lnk'
$library = "$env:LOCALAPPDATA\Lively Wallpaper\Library\wallpapers\cogitator"
$livelyExe = "$env:ProgramFiles\Lively Wallpaper\Lively.exe"

Remove-Item $startupLink -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*wallpaper\server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
if (Test-Path $livelyExe) { & $livelyExe closewp --monitor -1 }
Remove-Item $library -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Cogitator wallpaper removed.'
