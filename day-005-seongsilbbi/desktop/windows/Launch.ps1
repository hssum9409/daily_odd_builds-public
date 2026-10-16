param([switch]$Emulator)
$ErrorActionPreference='Stop'
function Quote([string]$value){$v=[Regex]::Replace($value,'(\\*)"','$1$1\"');$v=[Regex]::Replace($v,'(\\+)$','$1$1');return '"'+$v+'"'}
Add-Type @'
using System;using System.Text;using System.Runtime.InteropServices;using System.ComponentModel;
namespace WorklogLaunch {
 public static class Native {
  [StructLayout(LayoutKind.Sequential)]struct SI{public uint cb;public IntPtr reserved,desktop,title;public uint x,y,w,h,cx,cy,fill,flags;public ushort show,reservedSize;public IntPtr bytes,input,output,error;}
  [StructLayout(LayoutKind.Sequential)]struct PI{public IntPtr process,thread;public uint pid,tid;}
  [DllImport("kernel32.dll",EntryPoint="CreateProcessW",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string dir,ref SI si,out PI pi);
  [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
  public static void Start(string app,string command,string dir){var si=new SI();si.cb=(uint)Marshal.SizeOf(typeof(SI));PI pi;if(!CreateProcess(app,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,dir,ref si,out pi))throw new Win32Exception(Marshal.GetLastWin32Error());CloseHandle(pi.thread);CloseHandle(pi.process);}
 }
}
'@
$exe=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$parameters=@('-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Runtime.ps1'))
if($Emulator){$parameters+='-Emulator'}
$command=(Quote $exe)+' '+(($parameters|ForEach-Object{Quote $_})-join ' ')
[WorklogLaunch.Native]::Start($exe,$command,$PSScriptRoot)
