' Starts the Cogitator wallpaper server without a console window (used from the Startup folder).
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" ""C:\cogitator\wallpaper\server.js""", 0, False
