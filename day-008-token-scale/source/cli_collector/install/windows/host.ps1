param([switch]$Connect)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'launch.ps1') -LoadOnly
Initialize-BackgroundLauncher
[TokenScale.Background]::Disconnect()
. (Join-Path $PSScriptRoot 'tray.ps1')
$installRoot=[IO.Path]::GetFullPath($PSScriptRoot)
if ((Get-Content -LiteralPath (Join-Path $installRoot 'product-id') -Raw).Trim() -ne 'DailyOddBuilds.TokenScale') { exit 1 }
if ($Connect) { [IO.File]::WriteAllText((Join-Path $installRoot 'connect.request'),'connect') }
$sha=[Security.Cryptography.SHA256]::Create()
$mutexName='Local\TokenScaleHost'+[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($installRoot.ToLowerInvariant()))).Replace('-','')
$sha.Dispose()
$created=$false
$mutex=[Threading.Mutex]::new($true,$mutexName,[ref]$created)
if (-not $created) {
  if ($Connect) {[IO.File]::WriteAllText((Join-Path $installRoot 'connect.request'),'connect')}
  $mutex.Dispose();exit 0
}
$child=$null
$active=Join-Path $installRoot 'host-active'
$stop=Join-Path $installRoot 'stop'
function Write-Atomic([string]$Path,[string]$Text) {
  $tmp=$Path+'.host.tmp'
  [IO.File]::WriteAllText($tmp,$Text,[Text.UTF8Encoding]::new($false))
  if ([IO.File]::Exists($Path)) { [IO.File]::Replace($tmp,$Path,$Path+'.host.backup') } else { [IO.File]::Move($tmp,$Path) }
}
function Read-Version([string]$File) {
  $value=(Get-Content -LiteralPath (Join-Path $installRoot $File) -Raw).Trim()
  if ($value -notmatch '^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$') { throw 'Invalid version' }
  return $value
}
try {
  Remove-Item -LiteralPath $stop -ErrorAction SilentlyContinue
  $dataPath=(Get-Content -LiteralPath (Join-Path $installRoot 'data-home.txt') -Raw).Trim()
  if (-not [IO.Path]::IsPathRooted($dataPath) -or $dataPath.Contains('"')) { throw 'Invalid data path' }
  [IO.File]::WriteAllText($active,[string]$PID)
  Initialize-TokenScaleTray $installRoot $dataPath
  $crashes=0
  while (-not (Test-Path -LiteralPath $stop)) {
    $version=Read-Version 'current.txt'
    $ready=Join-Path $installRoot 'ready'
    $token=[Guid]::NewGuid().ToString('N')
    Remove-Item -LiteralPath $ready -ErrorAction SilentlyContinue
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=Join-Path $installRoot ('versions\'+$version+'\token-scale.exe')
    $start.Arguments='daemon --install-root "'+$installRoot+'" --home "'+$dataPath+'" --ready-file "'+$ready+'" --ready-token '+$token
    if ((Test-Path -LiteralPath (Join-Path $installRoot 'runtime-mode')) -and (Get-Content -LiteralPath (Join-Path $installRoot 'runtime-mode') -Raw).Trim() -eq 'aot') {
      $start.FileName=Join-Path $installRoot 'runtime/dartaotruntime.exe'
      $start.Arguments='"'+(Join-Path $installRoot ('versions\'+$version+'\token-scale.aot'))+'" '+$start.Arguments
    }
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WorkingDirectory=$installRoot
    $child=[Diagnostics.Process]::Start($start)
    $healthy=$false
    for ($n=0;$n -lt 300 -and -not $child.HasExited -and -not (Test-Path -LiteralPath $stop);$n++) {
      if (Test-Path -LiteralPath $ready) {
        try { $healthy=(Get-Content -LiteralPath $ready -Raw).Trim() -eq ($version+"`n"+$token) } catch [IO.IOException] {}
      }
      Update-TokenScaleTray
      if ($healthy) { break };Start-Sleep -Milliseconds 100
    }
    if ($healthy) {
      $key=(Get-Content -LiteralPath (Join-Path $installRoot 'uninstall-key') -Raw).Trim()
      if ($key -match '^DailyOddBuilds\.TokenScale(?:\.[A-Za-z0-9_-]+)?_is1$') {
        $registration='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$key
        $location=Get-ItemPropertyValue -Path $registration -Name InstallLocation -ErrorAction SilentlyContinue
        if ($location -and [IO.Path]::GetFullPath($location).TrimEnd('\') -eq $installRoot.TrimEnd('\')) {
          Set-ItemProperty -Path $registration -Name DisplayVersion -Value $version
        }
      }
      while (-not $child.WaitForExit(100) -and -not (Test-Path -LiteralPath $stop)) {Update-TokenScaleTray}
    }
    if (-not $child.HasExited -and -not $child.WaitForExit(45000)) { $child.Kill();$child.WaitForExit(10000)|Out-Null }
    $code=$child.ExitCode;$child.Dispose();$child=$null
    if (Test-Path -LiteralPath $stop) { break }
    if (-not $healthy) {
      $previous=Read-Version 'previous.txt'
      if ($previous -eq $version) { break }
      Write-Atomic (Join-Path $installRoot 'blocked-update.json') ('{"version":"'+$version+'"}')
      Write-Atomic (Join-Path $installRoot 'current.txt') $previous
    } elseif ($code -eq 42) { $crashes=0;continue }
    else { $crashes++;if ($crashes -gt 3) { break };Start-Sleep -Seconds ([Math]::Min($crashes*10,30)) }
  }
} catch {
  if ($dataPath -and [IO.Directory]::Exists($dataPath)) {
    [IO.File]::WriteAllText((Join-Path $dataPath 'host-error.log'),'host-failed',[Text.UTF8Encoding]::new($false))
  }
} finally {
  if ($child) { if (-not $child.HasExited) { $child.Kill() };$child.Dispose() }
  Remove-Item -LiteralPath $active,$stop -ErrorAction SilentlyContinue
  Close-TokenScaleTray
  $mutex.ReleaseMutex();$mutex.Dispose()
}
