param([ValidateSet('Install','Update','Uninstall')][string]$Action='Install',[string]$Source,[string]$InstallBase,[switch]$Startup,[switch]$Launch,[switch]$Isolated)
$ErrorActionPreference='Stop'
if(-not $Source){$Source=Join-Path $PSScriptRoot '../..'};$Source=[IO.Path]::GetFullPath($Source)
if(-not $InstallBase){$InstallBase=Join-Path $env:LOCALAPPDATA 'Programs'};$InstallBase=[IO.Path]::GetFullPath($InstallBase)
$target=Join-Path $InstallBase 'WorklogScripts';$stage=$target+'.stage-'+[Guid]::NewGuid().ToString('N');$backup=$target+'.backup-'+[Guid]::NewGuid().ToString('N')
function AssertPlain([string]$p){$check=$p;while($check){if((Test-Path -LiteralPath $check)-and((Get-Item -LiteralPath $check -Force).Attributes-band[IO.FileAttributes]::ReparsePoint)){throw 'Linked installation paths are unsupported.'};$parent=Split-Path -Path $check -Parent;if($parent-eq$check){break};$check=$parent}}
function AssertOwned(){if(-not(Test-Path -LiteralPath (Join-Path $target 'installed.json'))){throw 'Existing folder is not a Worklog Scripts installation.'};$receipt=Get-Content -LiteralPath (Join-Path $target 'installed.json') -Raw|ConvertFrom-Json;if($receipt.product-ne'WorklogScripts'-or[IO.Path]::GetFullPath($receipt.root)-ne$target){throw 'Installation ownership mismatch.'}}
function RemoveOwnedPath([string]$p){if($p-notin@($target,$stage,$backup)){throw 'Unsafe removal path'};AssertPlain $p;if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force}}
function StopOwned(){if(Test-Path -LiteralPath $target){AssertOwned;&(Join-Path $target 'desktop/windows/Control.ps1') -Action stop}}
AssertPlain $InstallBase;$null=New-Item -ItemType Directory -Path $InstallBase -Force
$lockPath=$target+'.install-lock';$lock=$null;$swapped=$false;$wasRunning=$false
$menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Worklog Scripts';$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WorklogScripts'
try {
 $lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 if(Test-Path -LiteralPath $target){AssertPlain $target;AssertOwned}
 if($Action-eq'Uninstall'){
  if(-not(Test-Path -LiteralPath $target)){'Already removed.';return};StopOwned
  if(-not $Isolated){$run=(Get-ItemProperty -Path $runKey -Name WorklogScripts -ErrorAction SilentlyContinue).WorklogScripts;if($run-and$run.Contains((Join-Path $target 'desktop/windows/Launch.ps1'))){Remove-ItemProperty -Path $runKey -Name WorklogScripts};if(Test-Path -LiteralPath $menu){AssertPlain $menu;foreach($name in @('Worklog.lnk','성실삐.lnk','성실삐🤖.lnk','Uninstall.lnk')){Remove-Item -LiteralPath (Join-Path $menu $name) -Force -ErrorAction SilentlyContinue};if(-not(Get-ChildItem -LiteralPath $menu)){Remove-Item -LiteralPath $menu}};if(Test-Path $uninstallKey){Remove-Item -Path $uninstallKey}}
  RemoveOwnedPath $target;'Removed. Account and local settings were preserved.';return
 }
 $manifest=Join-Path $Source 'payload.sha256';if(-not(Test-Path -LiteralPath $manifest)){throw 'Extract the complete packaged release.'}
 $files=@();foreach($line in Get-Content -LiteralPath $manifest){if($line-notmatch'^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$'){throw 'Invalid payload manifest'};$hash=$matches[1];$relative=$matches[2];if($relative.Contains('..')-or$relative.StartsWith('/')-or$relative.StartsWith('desktop/macos/')){throw 'Unsafe payload path'};$path=Join-Path $Source $relative;AssertPlain $path;if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()-ne$hash){throw 'Payload checksum mismatch'};$files+=$relative}
 foreach($required in @('desktop/windows/Runtime.ps1','desktop/windows/Client.cs','desktop/windows/Panel.cs','desktop/windows/Control.ps1','desktop/windows/Install.ps1','desktop/windows/Launch.ps1','config/firebase.json','desktop/themes.json','desktop/windows/Settings.cs','desktop/windows/Startup.cs','desktop/windows/Settings.xaml','desktop/windows/WidgetChrome.xaml','desktop/assets/Nunito-Bold.ttf','desktop/assets/Nunito-ExtraBold.ttf','desktop/assets/NanumSquareRoundR.ttf','desktop/assets/NanumSquareRoundB.ttf','desktop/assets/NanumSquareRoundEB.ttf','desktop/assets/robot.png','desktop/assets/app.ico','desktop/assets/LICENSE-Fluent-Emoji.txt','desktop/assets/OFL-Nunito.txt','desktop/assets/OFL-NanumSquareRound.txt','release.json')){if($required-notin$files){throw 'Incomplete payload'}}
 $release=Get-Content -LiteralPath (Join-Path $Source 'release.json') -Raw|ConvertFrom-Json;if($release.product-ne'WorklogScripts'){throw 'Wrong product'}
 $null=New-Item -ItemType Directory -Path $stage
 foreach($relative in $files+@('payload.sha256')){$out=Join-Path $stage $relative;$null=New-Item -ItemType Directory -Path (Split-Path $out -Parent) -Force;Copy-Item -LiteralPath (Join-Path $Source $relative) -Destination $out}
 @{product='WorklogScripts';version=$release.version;root=$target;isolated=[bool]$Isolated;installedAt=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $stage 'installed.json') -Encoding UTF8
 $profile=if($env:WORKLOG_SCRIPTS_HOME){$env:WORKLOG_SCRIPTS_HOME}else{Join-Path $env:LOCALAPPDATA 'DailyOddBuilds/Worklog/production'}
 $wasRunning=Test-Path -LiteralPath (Join-Path $profile 'instance.json');StopOwned
 if(Test-Path -LiteralPath $target){[IO.Directory]::Move($target,$backup)}
 [IO.Directory]::Move($stage,$target);$swapped=$true
 $ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
 $arguments='-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $target 'desktop/windows/Launch.ps1')+'"'
 if(-not $Isolated){
  $null=New-Item -ItemType Directory -Path $menu -Force;$shell=New-Object -ComObject WScript.Shell
  foreach($oldName in @('Worklog.lnk','성실삐.lnk')){Remove-Item -LiteralPath (Join-Path $menu $oldName) -Force -ErrorAction SilentlyContinue}
  foreach($item in @(@('성실삐',$arguments),@('Uninstall',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $target 'desktop/windows/Install.ps1')+'" -Action Uninstall')))){$link=$shell.CreateShortcut((Join-Path $menu ($item[0]+'.lnk')));$link.TargetPath=$ps;$link.Arguments=$item[1];$link.WorkingDirectory=$target;$link.IconLocation=(Join-Path $target 'desktop/assets/app.ico')+',0';$link.Description='성실삐';$link.Save()}
  $null=New-Item -Path $uninstallKey -Force;foreach($pair in @{DisplayName='성실삐🤖';DisplayIcon=((Join-Path $target 'desktop/assets/app.ico')+',0');DisplayVersion=$release.version;InstallLocation=$target;UninstallString=('"'+$ps+'" -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $target 'desktop/windows/Install.ps1')+'" -Action Uninstall')}.GetEnumerator()){$null=New-ItemProperty -Path $uninstallKey -Name $pair.Key -Value $pair.Value -Force}
  if($Startup){$null=New-Item -Path $runKey -Force;$null=New-ItemProperty -Path $runKey -Name WorklogScripts -Value ('"'+$ps+'" '+$arguments) -Force}
 }
 if($Launch-or$wasRunning-or(-not$Isolated-and$Action-eq'Install')){&(Join-Path $target 'desktop/windows/Launch.ps1');$deadline=[DateTime]::UtcNow.AddSeconds(20);$ok=$false;while([DateTime]::UtcNow-lt$deadline){$statusFile=Join-Path $profile 'status.json';if(Test-Path -LiteralPath $statusFile){try{$s=Get-Content -LiteralPath $statusFile -Raw|ConvertFrom-Json;if($s.ready-and([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$s.updatedAt)-lt5000){$ok=$true;break}}catch{}};Start-Sleep -Milliseconds 200};if(-not$ok){throw 'New version did not become ready. Rolling back.'}}
 RemoveOwnedPath $backup;"Installed Worklog Scripts $($release.version): $target"
}catch{
 if($swapped){StopOwned;RemoveOwnedPath $target}
 if(Test-Path -LiteralPath $backup){[IO.Directory]::Move($backup,$target);if($wasRunning){&(Join-Path $target 'desktop/windows/Launch.ps1')}}
 throw
}finally{if(Test-Path -LiteralPath $stage){RemoveOwnedPath $stage};if($lock){$lock.Dispose();Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue}}
