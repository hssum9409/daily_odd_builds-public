param([switch]$Uninstall,[switch]$Startup,[switch]$Launch,[switch]$PurgeSettings,
    [string]$InstallBase = $env:CODEX_USAGE_SCRIPTS_INSTALL_BASE,[string]$Language='')
$ErrorActionPreference = 'Stop'
$product = 'CodexUsageMonitorScripts'
$source = Split-Path $PSScriptRoot -Parent
# 설치기가 자기 실행 위치의 디렉터리 핸들을 붙잡지 않도록 한다.
Set-Location -LiteralPath $env:TEMP
[Environment]::CurrentDirectory = $env:TEMP
if (-not $InstallBase) { $InstallBase = Join-Path $env:LOCALAPPDATA 'Programs' }
$base = [IO.Path]::GetFullPath($InstallBase).TrimEnd('\')
$target = Join-Path $base $product
# Explorer/자동 시작과 Codex 실행 환경의 LOCALAPPDATA가 달라도 설정 위치를 유지한다.
$previousReceipt=try {Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw -Encoding UTF8|ConvertFrom-Json} catch {$null}
$profile = if ($env:CODEX_USAGE_SCRIPTS_HOME) { $env:CODEX_USAGE_SCRIPTS_HOME } elseif ($previousReceipt.product -eq $product -and $previousReceipt.profile) { [string]$previousReceipt.profile } else { Join-Path $env:LOCALAPPDATA "DailyOddBuilds\$product" }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# 격리 QA에서도 사용 중인 설치/시작 등록을 덮어쓰지 않도록 별도 이름을 허용한다.
$registryName=if($env:CODEX_USAGE_SCRIPTS_REGISTRY_NAMESPACE){$env:CODEX_USAGE_SCRIPTS_REGISTRY_NAMESPACE}else{$product}
if($registryName -ne $product -and $registryName -notmatch '^CodexUsageMonitorScripts-QA-[a-f0-9]{6,32}$'){throw 'Invalid QA registry namespace.'}
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$registryName"
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) $product
if ($env:CODEX_USAGE_SCRIPTS_INSTALL_BASE) { $menu = Join-Path $base '.shortcuts' }
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
. (Join-Path $PSScriptRoot 'Launch.ps1') -LoadOnly
$lockHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($target.ToLowerInvariant()))).Replace('-','').Substring(0,16)
$lock = New-Object Threading.Mutex($false, "Local\UsageScriptsInstall-$lockHash")
$owned = $false
try { $owned=$lock.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
if (-not $owned) { throw 'Another installation is running.' }
function Payload-Digest([string]$Path) {
    # 기본 제공 .NET으로 계산하여 호출한 터미널의 모듈 경로에 영향받지 않는다.
    $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
}
function Remove-OwnedFolder([string]$Path,[bool]$RequireReceipt=$true) {
    # 재귀 삭제는 확인된 설치 폴더 또는 그 바로 옆의 작업 폴더에만 허용한다.
    $full=[IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetDirectoryName($full) -ne $base -or [IO.Path]::GetFileName($full) -notmatch '^CodexUsageMonitorScripts(?:\.(?:stage|backup)-[0-9a-f]+)?$') { throw "Unsafe install path: $full" }
    if (-not (Test-Path -LiteralPath $full)) {return}
    if ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Linked installation directories are not supported.'}
    if ($RequireReceipt) {
        $receipt=Get-Content -LiteralPath (Join-Path $full 'installed.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($receipt.product -ne $product) {throw 'Not a Scripts edition installation.'}
    }
    Remove-Item -LiteralPath $full -Recurse -Force
}
function Stop-OwnedMonitor {
    $record=Join-Path $profile 'instance.json'
    if (-not (Test-Path -LiteralPath $record)) {return $false}
    $instance=Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
    $process=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$instance.pid)" -ErrorAction SilentlyContinue
    if (-not $process) {return $false}
    if ($process.CommandLine.IndexOf((Join-Path $target 'windows\Monitor.ps1'),[StringComparison]::OrdinalIgnoreCase) -lt 0) {throw 'A monitor outside this installation is running. Stop that copy first.'}
    & $ps -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $target 'windows\Monitor.ps1') -Stop
    if ($LASTEXITCODE) {throw 'Could not request monitor shutdown.'}
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while ((Get-Process -Id $instance.pid -ErrorAction SilentlyContinue) -and $watch.Elapsed.TotalSeconds -lt 15) {Start-Sleep -Milliseconds 100}
    if (Get-Process -Id $instance.pid -ErrorAction SilentlyContinue) {throw 'Monitor did not stop. Installation has not changed.'}
    return $true
}
function Start-InstalledMonitor {
    $null=Start-BackgroundPowerShell (Join-Path $target 'windows\Monitor.ps1')
}
$stage=$null;$backup=$null;$wasRunning=$false;$committed=$false;$installPhase='verify'
try {
    if ($Uninstall) {
        if (-not (Test-Path -LiteralPath $target)) {Write-Output 'Already removed.';exit 0}
        $receipt=Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($receipt.product -ne $product) {throw 'Installation receipt mismatch.'}
        $null=Stop-OwnedMonitor
        $run=(Get-ItemProperty -Path $runKey -Name $registryName -ErrorAction SilentlyContinue).$registryName
        if (Test-OwnedStartupCommand $run $target) {Remove-ItemProperty -Path $runKey -Name $registryName}
        foreach ($name in @('Codex Usage Monitor Scripts.lnk','Settings.lnk','Uninstall.lnk')) {Remove-Item -LiteralPath (Join-Path $menu $name) -Force -ErrorAction SilentlyContinue}
        if ((Test-Path -LiteralPath $menu) -and -not (Get-ChildItem -LiteralPath $menu)) {Remove-Item -LiteralPath $menu}
        Remove-Item -LiteralPath $uninstallKey -Recurse -ErrorAction SilentlyContinue
        Set-Location -LiteralPath $env:TEMP
        Remove-OwnedFolder $target
        if ($PurgeSettings) {
            # 명시적 선택 때만 이 버전의 알려진 프로필 파일을 삭제한다.
            foreach ($name in @('settings.json','notices.json','instance.json')) {Remove-Item -LiteralPath (Join-Path $profile $name) -Force -ErrorAction SilentlyContinue}
        }
        Write-Output 'Removed. Settings are kept unless -PurgeSettings was selected.';exit 0
    }
    $manifest=Join-Path $source 'payload.sha256'
    if (-not (Test-Path -LiteralPath $manifest)) {throw 'Use a complete packaged release (payload.sha256 is missing).'}
    $files=@()
    foreach ($line in Get-Content -LiteralPath $manifest -Encoding UTF8) {
        if ($line -notmatch '^([0-9a-f]{64})  ([a-zA-Z0-9_./-]+)$') {throw 'Invalid file manifest.'}
        $digest=$Matches[1];$relative=$Matches[2]
        if ($relative.StartsWith('/') -or $relative.Split('/') -contains '..' -or $relative.StartsWith('macos/')) {throw 'Invalid platform payload.'}
        $file=Join-Path $source $relative
        if ((Payload-Digest $file) -ne $digest) {throw "Checksum mismatch: $relative"}
        $files+=$relative
    }
    foreach ($required in @('windows/Monitor.ps1','windows/Install.ps1','windows/Launch.ps1','assets/gp-chan-face.png','assets/gp-chan-monitor.png','defaults.json')) {if ($files -notcontains $required) {throw "Incomplete payload: $required"}}
    $version=(Get-Content -LiteralPath (Join-Path $source 'defaults.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Linked installation directories are not supported.'}
        $receipt=Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($receipt.product -ne $product) {throw 'Existing folder is not owned by Scripts edition.'}
    }
    $null=New-Item -ItemType Directory -Path $base -Force
    $installPhase='stage';$stage=Join-Path $base ($product+'.stage-'+[Guid]::NewGuid().ToString('N'))
    $null=New-Item -ItemType Directory -Path $stage
    foreach ($relative in $files+@('payload.sha256')) {
        $destination=Join-Path $stage $relative;$null=New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force
        Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $destination
    }
    @{product=$product;version=$version;root=$target;profile=$profile;installedAt=[DateTimeOffset]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'installed.json') -Encoding UTF8
    $installPhase='stop-monitor';$wasRunning=Stop-OwnedMonitor
    $installPhase='replace-folder'
    if (Test-Path -LiteralPath $target) {$backup=Join-Path $base ($product+'.backup-'+[Guid]::NewGuid().ToString('N'));Move-Item -LiteralPath $target -Destination $backup}
    Move-Item -LiteralPath $stage -Destination $target;$stage=$null
    $installPhase='registration';$shell=New-Object -ComObject WScript.Shell;$null=New-Item -ItemType Directory -Path $menu -Force
    foreach ($entry in @(@('Codex Usage Monitor Scripts','Launch.ps1',''),@('Settings','Launch.ps1',' -Settings'),@('Uninstall','Install.ps1',' -Uninstall'))) {
        $shortcut=$shell.CreateShortcut((Join-Path $menu ($entry[0]+'.lnk')));$shortcut.TargetPath=$ps
        $shortcut.Arguments='-NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $target ('windows\'+$entry[1]))+'"'+$entry[2]
        $shortcut.WorkingDirectory=$target;$shortcut.IconLocation=Join-Path $target 'assets\gp-chan.ico';$shortcut.Save()
    }
    $null=New-Item -Path $uninstallKey -Force
    $values=@{DisplayName='Codex Usage Monitor Scripts';DisplayVersion=$version;Publisher='hssum9409';InstallLocation=$target;DisplayIcon=(Join-Path $target 'assets\gp-chan.ico');UninstallString=('"'+$ps+'" -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $target 'windows\Install.ps1')+'" -Uninstall');NoModify=1;NoRepair=1}
    foreach ($key in $values.Keys) {$type=if ($values[$key] -is [int]) {'DWord'} else {'String'};$null=New-ItemProperty -Path $uninstallKey -Name $key -Value $values[$key] -PropertyType $type -Force}
    $run=(Get-ItemProperty -Path $runKey -Name $registryName -ErrorAction SilentlyContinue).$registryName
    if ($Startup -or (Test-OwnedStartupCommand $run $target)) {& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'windows\Monitor.ps1') -RegisterStartup;if ($LASTEXITCODE) {throw 'Startup registration failed.'}}
    $committed=$true
    if($Language -in @('ko','en','zh','ja') -or $Startup){
        $null=New-Item -ItemType Directory -Path $profile -Force;$settingsPath=Join-Path $profile 'settings.json'
        $preferences=if(Test-Path -LiteralPath $settingsPath){Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8|ConvertFrom-Json}else{Get-Content -LiteralPath (Join-Path $target 'defaults.json') -Raw -Encoding UTF8|ConvertFrom-Json}
        if(-not (Test-Path -LiteralPath $settingsPath) -and $Language){$preferences.language=$Language}
        if($Startup){$preferences|Add-Member -NotePropertyName startupPromptDismissed -NotePropertyValue $true -Force}
        $preferences|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $settingsPath -Encoding UTF8
    }
    if ($backup) {Remove-OwnedFolder $backup;$backup=$null}
    if ($wasRunning -or $Launch) {Start-InstalledMonitor}
    Write-Output "Installed $version at $target. Download files can now be removed."
} catch {
    $failure=$_;$restoreFailure=$null
    try {if (-not $committed -and $backup -and (Test-Path -LiteralPath $backup)) {
        if (Test-Path -LiteralPath $target) {Remove-OwnedFolder $target}
        Move-Item -LiteralPath $backup -Destination $target;$backup=$null
        if ($wasRunning) {Start-InstalledMonitor}
    }}catch{$restoreFailure=$_}
    # 1.4.4 업데이터처럼 자식 프로세스 출력을 보관하지 않아도 설치 실패는 추적한다.
    try {
        $null=New-Item -ItemType Directory -Path $profile -Force
        @{at=[DateTimeOffset]::UtcNow.ToString('o');phase=$installPhase;target=$target;workingDirectory=(Get-Location).Path;
          error=$failure.Exception.Message;errorId=$failure.FullyQualifiedErrorId;line=$failure.InvocationInfo.ScriptLineNumber;
          restoreError=$(if($restoreFailure){$restoreFailure.Exception.Message}else{$null});backup=$backup}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $profile 'install-last-error.json') -Encoding UTF8
    }catch{[Console]::Error.WriteLine('Could not write installer diagnostic log.')}
    throw $failure
} finally {
    if ($stage -and (Test-Path -LiteralPath $stage)) {Remove-OwnedFolder $stage $false}
    if ($owned) {$lock.ReleaseMutex()};$lock.Dispose()
}
