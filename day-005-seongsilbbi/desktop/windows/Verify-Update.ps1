param([Parameter(Mandatory=$true)][string]$PreviousArchive,[Parameter(Mandatory=$true)][string]$CurrentArchive,[Parameter(Mandatory=$true)][string]$UpdateArchive,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
$PreviousArchive=[IO.Path]::GetFullPath($PreviousArchive)
$CurrentArchive=[IO.Path]::GetFullPath($CurrentArchive)
$UpdateArchive=[IO.Path]::GetFullPath($UpdateArchive)
$env:WORKLOG_DISABLE_UPDATE_CHECK='1'
if(-not $OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('seongsil-update-verify-'+[Guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$previous=Join-Path $OutputDirectory 'previous';$current=Join-Path $OutputDirectory 'current'
[IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($PreviousArchive),$previous)
[IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($CurrentArchive),$current)
$base=Join-Path $OutputDirectory 'install space 한글';$target=Join-Path $base 'WorklogScripts';$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'profile'
$ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$helper=Join-Path $current 'desktop/windows/Update.ps1';$checks=New-Object 'Collections.Generic.List[string]'
$report=@{passed=$false;platform='Windows';interaction='Actual PowerShell/WPF processes; local packages, no GitHub network';checks=$checks;output=$OutputDirectory}
function Assert($condition,[string]$name){if(-not $condition){throw $name};$checks.Add($name)}
function Status {Get-Content -LiteralPath (Join-Path $env:WORKLOG_SCRIPTS_HOME 'status.json') -Raw|ConvertFrom-Json}
function Wait-Ready([string]$version){$until=[DateTime]::UtcNow.AddSeconds(25);do{try{$s=Status;if($s.ready-and((Get-Content -LiteralPath (Join-Path $target 'release.json') -Raw|ConvertFrom-Json).version-eq$version)-and([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$s.updatedAt)-lt5000){return $s}}catch{};Start-Sleep -Milliseconds 200}while([DateTime]::UtcNow-lt$until);throw 'Runtime did not become ready'}
function Update([string]$archive,[string]$version,[string]$hash){
 if(-not $hash){$hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()}
 $arguments=@('-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',$helper,'-TargetRoot',$target,'-Profile',$env:WORKLOG_SCRIPTS_HOME,'-PackagePath',$archive,'-Digest',$hash,'-ExpectedVersion',$version,'-Isolated')
 $info=New-Object Diagnostics.ProcessStartInfo;$info.FileName=$ps;$info.Arguments=($arguments|ForEach-Object {'"'+$_+'"'})-join ' ';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WorkingDirectory=$env:TEMP;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $process=[Diagnostics.Process]::Start($info);$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync();$process.WaitForExit();$code=$process.ExitCode
 $script:attempt++;[IO.File]::WriteAllText((Join-Path $OutputDirectory ('attempt-'+$script:attempt+'.stdout.log')),$stdout.Result);[IO.File]::WriteAllText((Join-Path $OutputDirectory ('attempt-'+$script:attempt+'.stderr.log')),$stderr.Result);$process.Dispose();return $code
}
function Zip-Files([string]$from,[string]$to){$zip=[IO.Compression.ZipFile]::Open($to,[IO.Compression.ZipArchiveMode]::Create);try{foreach($file in Get-ChildItem -LiteralPath $from -File -Recurse){$relative=$file.FullName.Substring($from.Length+1).Replace('\','/');$null=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,('WorklogScripts/'+$relative))}}finally{$zip.Dispose()}}
try {
 &(Join-Path $previous 'desktop/windows/Install.ps1') -Source $previous -InstallBase $base -Isolated -Launch|Out-Null
 $old=(Get-Content -LiteralPath (Join-Path $previous 'release.json') -Raw|ConvertFrom-Json).version
 $version=(Get-Content -LiteralPath (Join-Path $current 'release.json') -Raw|ConvertFrom-Json).version
 $before=Wait-Ready $old;$marker=Join-Path $env:WORKLOG_SCRIPTS_HOME 'release-test-marker.txt';[IO.File]::WriteAllText($marker,'preserve profile')
 $exit=Update $UpdateArchive $version ('0'*64)
 Assert ($exit-ne0-and(Status).pid-eq$before.pid) 'bad checksum leaves the running previous version untouched'
 $exit=Update $UpdateArchive $version ''
 Assert ($exit-eq0) 'verified update installs through the real installer'
 $after=Wait-Ready $version
 Assert ($after.pid-ne$before.pid-and-not(Get-Process -Id $before.pid -ErrorAction SilentlyContinue)) 'new WPF process becomes ready and the old process exits'
 Assert ([IO.File]::ReadAllText($marker)-eq'preserve profile') 'update preserves the separate profile'
 $unsafe=Join-Path $OutputDirectory 'unsafe.zip';$zip=[IO.Compression.ZipFile]::Open($unsafe,[IO.Compression.ZipArchiveMode]::Create);$entry=$zip.CreateEntry('../escape.txt');$writer=New-Object IO.StreamWriter($entry.Open());$writer.Write('must not extract');$writer.Dispose();$zip.Dispose()
 $exit=Update $unsafe '0.6.5' ''
 Assert ($exit-ne0-and(Status).pid-eq$after.pid-and-not(Test-Path -LiteralPath (Join-Path $OutputDirectory 'escape.txt'))) 'archive traversal is rejected before stopping the app'
 $broken=Join-Path $OutputDirectory 'broken';Copy-Item -LiteralPath $current -Destination $broken -Recurse
 $release=Get-Content -LiteralPath (Join-Path $broken 'release.json') -Raw|ConvertFrom-Json;$release.version='0.6.5';$release|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $broken 'release.json') -Encoding UTF8
 [IO.File]::WriteAllText((Join-Path $broken 'desktop/windows/Runtime.ps1'),"throw 'Intentional verification startup failure'",(New-Object Text.UTF8Encoding($true)))
 $lines=@();foreach($line in Get-Content -LiteralPath (Join-Path $broken 'payload.sha256')){$name=($line-split '  ',2)[1];$lines+=((Get-FileHash -LiteralPath (Join-Path $broken $name) -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$name)}
 [IO.File]::WriteAllLines((Join-Path $broken 'payload.sha256'),$lines,(New-Object Text.UTF8Encoding($false)))
 $brokenZip=Join-Path $OutputDirectory 'broken.zip';Zip-Files $broken $brokenZip;$exit=Update $brokenZip '0.6.5' ''
 Assert ($exit-ne0) 'a correctly hashed but unstartable runtime fails the health check'
 $restored=Wait-Ready $version;$last=Get-ChildItem -LiteralPath (Join-Path $env:WORKLOG_SCRIPTS_HOME 'updates') -Filter result.json -Recurse|Sort-Object LastWriteTimeUtc|Select-Object -Last 1;$result=Get-Content -LiteralPath $last.FullName -Raw|ConvertFrom-Json
 Assert ($result.status-eq'rolled_back'-and$result.rollback.succeeded-and[IO.File]::ReadAllText($marker)-eq'preserve profile') 'failed startup restores and relaunches the previous version with the profile preserved'
 $report.passed=$true
}catch{$report.error=$_.Exception.Message;throw}
finally{
 if(Test-Path -LiteralPath (Join-Path $target 'installed.json')){&(Join-Path $target 'desktop/windows/Control.ps1') -Action stop;&(Join-Path $target 'desktop/windows/Install.ps1') -Action Uninstall -InstallBase $base -Isolated|Out-Null}
 $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $OutputDirectory 'verification.json') -Encoding UTF8
}
$report|ConvertTo-Json -Depth 8
