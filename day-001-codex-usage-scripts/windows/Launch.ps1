# GUI 실행기는 콘솔 창 없이 모니터를 시작한 뒤 바로 종료한다.
# 부모 CMD의 콘솔과 핸들을 상속하지 않아 CMD 종료에 영향받지 않는다.
param([switch]$LoadOnly,[switch]$Background)
$ErrorActionPreference = 'Stop'

function Quote-ProcessArgument([string]$Value) {
    # Windows 명령행의 따옴표와 끝의 역슬래시를 보존한다.
    # 셸을 거치지 않아 경로의 공백·한글·& 등이 명령으로 해석되지 않는다.
    $escaped = [Regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [Regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Initialize-BackgroundLauncher {
if ('UsageScripts.BackgroundLauncher' -as [type]) { return }
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

        [DllImport("kernel32.dll")]
        private static extern bool FreeConsole();
        [DllImport("kernel32.dll")]
        private static extern IntPtr GetStdHandle(int identifier);
        [DllImport("kernel32.dll")]
        private static extern bool SetStdHandle(int identifier, IntPtr handle);

        public static void Disconnect() {
            // 이전 실행기가 넘긴 파이프도 닫아 부모가 출력 EOF를 기다리지 않게 한다.
            var handles = new IntPtr[3];
            for (int index = 0; index < handles.Length; index++) {
                handles[index] = GetStdHandle(-10 - index);
                SetStdHandle(-10 - index, IntPtr.Zero);
            }
            FreeConsole();
            for (int index = 0; index < handles.Length; index++) {
                var handle = handles[index];
                if (handle == IntPtr.Zero || handle == new IntPtr(-1)) continue;
                bool duplicate = false;
                for (int previous = 0; previous < index; previous++) {
                    if (handles[previous] == handle) duplicate = true;
                }
                if (!duplicate) CloseHandle(handle);
            }
        }

        public static uint Start(string application, string command, string directory) {
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
            return process.processId;
        }
    }
}
'@
}

function Start-BackgroundPowerShell([string]$ScriptPath, [string[]]$ScriptArguments=@()) {
    $ScriptPath=[IO.Path]::GetFullPath($ScriptPath)
    if (-not [IO.File]::Exists($ScriptPath)) { throw 'Script was not found. Extract the complete ZIP before starting.' }
    Initialize-BackgroundLauncher
    $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $parameters = @('-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $ScriptArguments
    $commandLine = (Quote-ProcessArgument $exe) + ' ' + (($parameters | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')
    # 설치 폴더를 작업 위치로 물려주면 다음 업데이트의 폴더 교체를 방해할 수 있다.
    $processId = [UsageScripts.BackgroundLauncher]::Start($exe, $commandLine, $env:TEMP)
    return [Diagnostics.Process]::GetProcessById($processId)
}

function Disconnect-MonitorConsole {
    # 구버전 바로가기/업데이터가 Monitor.ps1을 직접 실행한 경우도 보호한다.
    # 현재 모니터만 콘솔에서 분리하며 사용자 터미널의 다른 프로세스는 건드리지 않는다.
    Initialize-BackgroundLauncher
    [UsageScripts.BackgroundLauncher]::Disconnect()
}

function Test-OwnedStartupCommand([string]$Command, [string]$Root) {
    if (-not $Command) { return $false }
    foreach ($name in @('Monitor.ps1','Launch.ps1')) {
        $path = '"' + (Join-Path $Root ('windows\'+$name)) + '"'
        if ($Command.IndexOf($path, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    return $false
}

if (-not $LoadOnly) {
    $forward=@($args)
    # 시작 메뉴·포터블 더블클릭은 숨김 상태의 설정을 연다. 로그온 실행은 조용히 유지한다.
    if(-not $Background -and $forward.Count -eq 0){$forward=@('-Reopen')}
    $null = Start-BackgroundPowerShell (Join-Path $PSScriptRoot 'Monitor.ps1') $forward
}
