' Starts the wallpaper server without a console window (used from the Startup folder).
' Works from wherever the wallpaper folder lives.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
sh.CurrentDirectory = here
sh.Run """" & node & """ """ & here & "\server.js""", 0, False
