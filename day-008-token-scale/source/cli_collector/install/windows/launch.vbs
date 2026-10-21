Option Explicit
Dim fs, shell, root, mode, command, q
Set fs = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(WScript.ScriptFullName)
mode = "start"
If WScript.Arguments.Count > 0 Then mode = WScript.Arguments(0)
q = Chr(34)
command = q & shell.ExpandEnvironmentStrings("%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe") & q & " -NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "
If mode = "install" Then
  command = command & q & root & "\setup.ps1" & q
ElseIf mode = "remove" Then
  command = command & q & root & "\manage.ps1" & q & " -Action remove -Root " & q & root & q
Else
  command = command & q & root & "\launch.ps1" & q
  If mode = "connect" Then command = command & " -Connect"
End If
shell.Run command, 0, False
