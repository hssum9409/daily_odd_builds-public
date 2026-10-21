param(
  [Parameter(Mandatory=$true)][ValidateSet('initialize','register','start','stop','startup-enable','startup-disable','uninstall','remove')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Root,
  [string]$Version,
  [string]$ProductKey = 'DailyOddBuilds.TokenScale',
  [string]$DataHome,
  [int]$WaitPid = 0
)
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($Root)
if (-not [IO.Path]::IsPathRooted($Root) -or $installRoot -eq [IO.Path]::GetPathRoot($installRoot)) { throw 'Invalid installation root' }
if ($ProductKey -notmatch '^DailyOddBuilds\.TokenScale(?:\.[A-Za-z0-9_-]+)?$') { throw 'Invalid product key' }
$marker = Join-Path $installRoot 'product-id'
if ($Action -ne 'initialize' -and (Test-Path -LiteralPath (Join-Path $installRoot 'uninstall-key'))) {
  $ProductKey = (Get-Content -LiteralPath (Join-Path $installRoot 'uninstall-key') -Raw).Trim() -replace '_is1$',''
  if ($ProductKey -notmatch '^DailyOddBuilds\.TokenScale(?:\.[A-Za-z0-9_-]+)?$') { throw 'Invalid installation registration' }
}
if ($Action -ne 'initialize' -and ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'DailyOddBuilds.TokenScale')) { throw 'Wrong product' }
function Write-Text([string]$Path,[string]$Text) { [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false)) }
$hostScript = Join-Path $installRoot 'host.ps1'
$powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$wscript=Join-Path $env:WINDIR 'System32/wscript.exe'
$launch=Join-Path $installRoot 'launch.vbs'
$hostCommand='"'+$wscript+'" //B //NoLogo "'+$launch+'"'
$legacyHostCommand='"'+$powershell+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$hostScript+'"'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($Action -eq 'start') {
  . (Join-Path $installRoot 'launch.ps1') -LoadOnly
  $null=Start-BackgroundScript $hostScript
  exit 0
}
if ($Action -eq 'initialize') {
  $reinstall=Test-Path -LiteralPath $marker
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
  if (-not $DataHome) { $DataHome = Join-Path $env:LOCALAPPDATA 'TokenScaleCLI' }
  $DataHome = [IO.Path]::GetFullPath($DataHome)
  if (-not [IO.Path]::IsPathRooted($DataHome)) { throw 'Invalid data path' }
  Write-Text $marker 'DailyOddBuilds.TokenScale'
  Write-Text (Join-Path $installRoot 'current.txt') $Version
  Write-Text (Join-Path $installRoot 'previous.txt') $Version
  Write-Text (Join-Path $installRoot 'data-home.txt') $DataHome
  Write-Text (Join-Path $installRoot 'uninstall-key') ($ProductKey + '_is1')
  [IO.Directory]::CreateDirectory($DataHome) | Out-Null
  $pref = Join-Path $DataHome 'preferences.json'
  if (-not (Test-Path -LiteralPath $pref)) { Write-Text $pref '{"autoSync":true,"autoUpdate":true,"uploadConsent":true}' }
  $settings=Get-Content -LiteralPath $pref -Raw | ConvertFrom-Json
  if ($reinstall -and -not $settings.PSObject.Properties['startupEnabled']) {
    $values=Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue
    $registered=$values -and $values.PSObject.Properties[$ProductKey]
    $settings|Add-Member -NotePropertyName startupEnabled -NotePropertyValue ([bool]$registered)
    Write-Text $pref ($settings|ConvertTo-Json -Compress)
  }
  exit 0
}
if ($Action -eq 'register') {
  $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$ProductKey+'_is1'
  New-Item -Path $key -Force | Out-Null
  $uninstall='"'+$wscript+'" //B //NoLogo "'+$launch+'" remove'
  foreach ($pair in @{
    DisplayName='Token Scale Is All You Need';DisplayVersion=$Version;Publisher='hssum9409';InstallLocation=$installRoot;
    UninstallString=$uninstall;QuietUninstallString=$uninstall;URLInfoAbout='https://github.com/hssum9409/daily_odd_builds-public';
  }.GetEnumerator()) {New-ItemProperty -Path $key -Name $pair.Key -Value $pair.Value -PropertyType String -Force | Out-Null}
  New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $key -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
  $menu=Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
  $shell=New-Object -ComObject WScript.Shell
  $link=$shell.CreateShortcut((Join-Path $menu ($ProductKey+'.lnk')))
  $link.TargetPath=$wscript;$link.Arguments='//B //NoLogo "'+$launch+'" connect'
  $link.WorkingDirectory=$installRoot;$link.Description='Connect or start Token Scale in the background';$link.Save()
}
if ($Action -in @('stop','uninstall','remove')) {
  Write-Text (Join-Path $installRoot 'stop') 'stop'
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (Test-Path -LiteralPath (Join-Path $installRoot 'host-active')) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Collector did not stop; no files removed' }
    Start-Sleep -Milliseconds 200
  }
  if ($Action -eq 'stop') { exit 0 }
}
if ($Action -eq 'startup-enable') {
  $command = $hostCommand
  if ($command.Length -gt 260) { throw 'Startup path exceeds Windows Run limit' }
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name $ProductKey -Value $command -PropertyType String -Force | Out-Null
  # Do not override a user's Task Manager disabled state on reinstall/update.
}
if ($Action -in @('startup-disable','uninstall','remove')) {
  $runValues = Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue
  $current = if ($runValues -and $runValues.PSObject.Properties[$ProductKey]) { $runValues.PSObject.Properties[$ProductKey].Value } else { $null }
  if ($current -eq $hostCommand -or $current -eq $legacyHostCommand) {
    Remove-ItemProperty -Path $runKey -Name $ProductKey
    if ($Action -in @('uninstall','remove')) {
      $approval = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
      Remove-ItemProperty -Path $approval -Name $ProductKey -ErrorAction SilentlyContinue
    }
  }
}
if ($Action -eq 'uninstall') {
  Start-Process -FilePath $powershell -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $installRoot 'manage.ps1')+'"'),'-Action','remove','-Root',('"'+$installRoot+'"'),'-WaitPid',([string]$WaitPid)) -WindowStyle Hidden
  exit 0
}
if ($Action -eq 'remove') {
  # A shortcut/CLI can start us inside the installation directory. Release
  # both PowerShell's location and Win32's current-directory handle first.
  Set-Location -LiteralPath $env:WINDIR
  [Environment]::CurrentDirectory=$env:WINDIR
  if ($WaitPid -gt 0) {
    $caller=Get-Process -Id $WaitPid -ErrorAction SilentlyContinue
    if ($caller -and $caller.Path -and ([IO.Path]::GetFullPath($caller.Path)).StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)) {
      Wait-Process -Id $WaitPid -Timeout 30 -ErrorAction Stop
    }
  }
  $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$ProductKey+'_is1'
  $location=Get-ItemPropertyValue -Path $key -Name InstallLocation
  if ([IO.Path]::GetFullPath($location).TrimEnd('\') -ne $installRoot.TrimEnd('\')) { throw 'Wrong uninstall registration' }
  Remove-Item -LiteralPath (Join-Path $env:APPDATA ('Microsoft/Windows/Start Menu/Programs/'+$ProductKey+'.lnk')) -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $key -Recurse
  # Only our owned files and strictly versioned directories. Leave unexpected
  # user files alone rather than recursively deleting an arbitrary chosen root.
  $versions=Join-Path $installRoot 'versions'
  if (Test-Path -LiteralPath $versions) {
    foreach ($dir in Get-ChildItem -LiteralPath $versions -Directory) {
      $resolved=[IO.Path]::GetFullPath($dir.FullName)
      if ($dir.Name -match '^\d+\.\d+\.\d+$' -and $resolved.StartsWith($versions+'\',[StringComparison]::OrdinalIgnoreCase) -and -not ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        foreach ($file in @('token-scale.exe','token-scale.exe.download','token-scale.aot','token-scale.aot.download','sha256')) {Remove-Item -LiteralPath (Join-Path $resolved $file) -ErrorAction SilentlyContinue}
        if (-not (Get-ChildItem -LiteralPath $resolved -Force)) {Remove-Item -LiteralPath $resolved}
      }
    }
    if (-not (Get-ChildItem -LiteralPath $versions -Force)) {Remove-Item -LiteralPath $versions}
  }
  $runtime=Join-Path $installRoot 'runtime'
  if ((Test-Path -LiteralPath $runtime) -and -not ((Get-Item -LiteralPath $runtime).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -LiteralPath (Join-Path $runtime 'dartaotruntime.exe') -ErrorAction SilentlyContinue
    if (-not (Get-ChildItem -LiteralPath $runtime -Force)) {Remove-Item -LiteralPath $runtime}
  }
  foreach ($file in @('host.ps1','manage.ps1','launch.ps1','launch.vbs','setup.ps1','tray.ps1','desktop-strings.json','token-scale.cmd','start.cmd','runtime-mode','LICENSE','THIRD_PARTY_LICENSES.txt','README.txt','product-id','current.txt','previous.txt','data-home.txt','uninstall-key','ready','stop','restart','connect.request','sync.request','pause.request','resume.request','web.request','update.request','startup-enable.request','startup-disable.request','blocked-update.json','current.txt.host.backup','current.txt.host.tmp','blocked-update.json.host.backup','blocked-update.json.host.tmp')) {Remove-Item -LiteralPath (Join-Path $installRoot $file) -ErrorAction SilentlyContinue}
  # host-active is cleared during PowerShell's finally block, before the OS
  # releases its working-directory handle. Retry only this empty owned root;
  # never force-delete files or terminate another process to remove a directory.
  for ($attempt=0; $attempt -lt 50; $attempt++) {
    if (-not (Test-Path -LiteralPath $installRoot)) {break}
    if ((Get-Item -LiteralPath $installRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Linked uninstall root'}
    if (Get-ChildItem -LiteralPath $installRoot -Force) {break}
    try {Remove-Item -LiteralPath $installRoot -ErrorAction Stop;break}
    catch [IO.IOException] {
      if ($attempt -eq 49) {throw}
      Start-Sleep -Milliseconds 100
    }
  }
}
