# GUI 실행기는 콘솔 창 없이 모니터를 시작한 뒤 바로 종료한다.
# 부모 CMD의 콘솔과 핸들을 상속하지 않아 CMD 종료에 영향받지 않는다.
$ErrorActionPreference = 'Stop'

function Quote-ProcessArgument([string]$Value) {
    # Windows 명령행의 따옴표와 끝의 역슬래시를 보존한다.
    # 셸을 거치지 않아 경로의 공백·한글·& 등이 명령으로 해석되지 않는다.
    $escaped = [Regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [Regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

$monitor = Join-Path $PSScriptRoot 'Monitor.ps1'
if (-not [IO.File]::Exists($monitor)) { throw 'Monitor.ps1 was not found. Extract the complete ZIP before starting.' }
$exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $monitor) + @($args)
$commandLine = (Quote-ProcessArgument $exe) + ' ' + (($arguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')

# .NET Process.Start는 콘솔을 없애도 부모의 파이프 핸들을 상속할 수 있다.
# CreateProcess의 inheritHandles=false로 CMD/터미널과의 연결을 완전히 끊는다.
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace UsageScripts {
    public static class BackgroundLauncher {
        [StructLayout(LayoutKind.Sequential)]
        private struct StartupInfo {
            public uint cb;
            public IntPtr reserved, desktop, title;
            public uint x, y, width, height, xChars, yChars, fillAttribute, flags;
            public ushort showWindow, reservedSize;
            public IntPtr reservedBytes, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInfo {
            public IntPtr process, thread;
            public uint processId, threadId;
        }
        [DllImport("kernel32.dll", EntryPoint="CreateProcessW", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern bool CreateProcess(string application, StringBuilder command,
            IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
            uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        public static void Start(string application, string command, string directory) {
            var startup = new StartupInfo();
            startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
            ProcessInfo process;
            const uint CreateNoWindow = 0x08000000;
            if (!CreateProcess(application, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero,
                false, CreateNoWindow, IntPtr.Zero, directory, ref startup, out process)) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            CloseHandle(process.thread);
            CloseHandle(process.process);
        }
    }
}
'@
[UsageScripts.BackgroundLauncher]::Start($exe, $commandLine, (Split-Path $PSScriptRoot -Parent))
