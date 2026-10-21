Option Explicit
Dim fs, shell, root, q
Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(WScript.ScriptFullName)
q = Chr(34)
shell.Run q & shell.ExpandEnvironmentStrings("%WINDIR%\System32\wscript.exe") & q & " //B //NoLogo " & q & root & "\launch.vbs" & q & " install", 0, False
