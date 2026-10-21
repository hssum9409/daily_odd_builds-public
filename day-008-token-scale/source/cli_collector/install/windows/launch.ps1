# Adapted from Day 001 Launch.ps1 (MIT): detach handles as well as the console.
param([switch]$Connect, [switch]$LoadOnly)
$ErrorActionPreference='Stop'
function Quote-BackgroundArgument([string]$Value) {
  $escaped=[Regex]::Replace($Value,'(\\*)"','$1$1\"')
  $escaped=[Regex]::Replace($escaped,'(\\+)$','$1$1')
  return '"'+$escaped+'"'
}
function Initialize-BackgroundLauncher {
  if ('TokenScale.Background' -as [type]) { return }
  Add-Type @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace TokenScale {
  public static class Background {
    [StructLayout(LayoutKind.Sequential)] struct StartupInfo {
      public uint cb; public IntPtr reserved, desktop, title;
      public uint x,y,width,height,xChars,yChars,fillAttribute,flags;
      public ushort showWindow,reservedSize;
      public IntPtr reservedBytes,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
      public IntPtr process,thread; public uint processId,threadId;
    }
    [DllImport("kernel32.dll",EntryPoint="CreateProcessW",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool CreateProcess(string app,StringBuilder command,IntPtr a,IntPtr b,bool inherit,
      uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll")] static extern bool SetStdHandle(int id,IntPtr handle);
    public static uint Start(string app,string command,string directory) {
      var startup=new StartupInfo(); startup.cb=(uint)Marshal.SizeOf(typeof(StartupInfo));
      ProcessInfo process;
      if (!CreateProcess(app,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,
        0x08000000,IntPtr.Zero,directory,ref startup,out process)) throw new Win32Exception(Marshal.GetLastWin32Error());
      CloseHandle(process.thread); CloseHandle(process.process); return process.processId;
    }
    public static void Disconnect() {
      var handles=new IntPtr[3];
      for(int i=0;i<3;i++){handles[i]=GetStdHandle(-10-i);SetStdHandle(-10-i,IntPtr.Zero);}
      FreeConsole();
      for(int i=0;i<3;i++){
        if(handles[i]==IntPtr.Zero || handles[i]==new IntPtr(-1))continue;
        bool duplicate=false;for(int j=0;j<i;j++)if(handles[j]==handles[i])duplicate=true;
        if(!duplicate)CloseHandle(handles[i]);
      }
    }
  }
}
'@
}
function Start-BackgroundScript([string]$Script,[string[]]$Parameters=@()) {
  Initialize-BackgroundLauncher
  $exe=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',$Script)+$Parameters
  $command=(Quote-BackgroundArgument $exe)+' '+(($arguments | ForEach-Object {Quote-BackgroundArgument $_}) -join ' ')
  return [TokenScale.Background]::Start($exe,$command,(Split-Path -Parent $Script))
}
if (-not $LoadOnly) {
  $parameters=@();if ($Connect) {$parameters+= '-Connect'}
  $null=Start-BackgroundScript (Join-Path $PSScriptRoot 'host.ps1') $parameters
}
