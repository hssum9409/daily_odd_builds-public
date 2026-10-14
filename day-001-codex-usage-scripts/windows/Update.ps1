# 조회는 활성 상태에서 별도 프로세스로 수행한다. 다운로드 검증 후 자기 모니터만 종료한다.
param([string]$TargetRoot=(Split-Path $PSScriptRoot -Parent),[string]$Profile=$env:CODEX_USAGE_SCRIPTS_HOME,
    [switch]$Force,[string]$PackagePath='',[string]$Digest='',[string]$ExpectedVersion='',[switch]$NoRelaunch)
$ErrorActionPreference='Stop'
# 테스트 사본도 제품과 같은 실행기를 사용하며 모니터 PID를 직접 추적한다.
. (Join-Path $PSScriptRoot 'Launch.ps1') -LoadOnly
[Environment]::CurrentDirectory=$env:TEMP
$TargetRoot=[IO.Path]::GetFullPath($TargetRoot)
if (-not $Profile) {
    $receipt=try {Get-Content -LiteralPath (Join-Path $TargetRoot 'installed.json') -Raw -Encoding UTF8|ConvertFrom-Json} catch {$null}
    $Profile=if($receipt.product -eq 'CodexUsageMonitorScripts' -and $receipt.profile){[string]$receipt.profile}else{Join-Path $env:LOCALAPPDATA 'DailyOddBuilds\CodexUsageMonitorScripts'}
}
$null=New-Item -ItemType Directory -Path $Profile -Force
$cachePath=Join-Path $Profile 'updates.json';$cache=@{nextCheck=0;blockedUntil=0;status='update_checking';failedVersion=''}
function Json([string]$Path) {try {return Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json} catch {return $null}}
function File-Digest([string]$Path) {
    # 기본 제공 .NET으로 계산하여 실행 호스트의 PSModulePath에 영향받지 않는다.
    $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
    try{return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
}
function Save-Status([string]$Status) {
    $cache.status=$Status;$temp=$cachePath+'.'+$PID+'.tmp'
    $cache|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $temp -Encoding UTF8
    if([IO.File]::Exists($cachePath)){$backup=$cachePath+'.bak';[IO.File]::Replace($temp,$cachePath,$backup);[IO.File]::Delete($backup)}else{[IO.File]::Move($temp,$cachePath)}
}
function Newer([string]$A,[string]$B) {return $A -match '^\d+\.\d+\.\d+$' -and $B -match '^\d+\.\d+\.\d+$' -and [version]$A -gt [version]$B}
function Select-Release($Items,[string]$Current) {
    $name='CodexUsageMonitorScripts-windows-update.zip';$list=@()
    foreach($item in $Items) {
        if ($item.draft -ne $false -or $item.prerelease -ne $false -or $item.tag_name -notmatch '^day001-v(\d+\.\d+\.\d+)$') {continue}
        $version=$Matches[1];if(-not (Newer $version $Current)){continue}
        $base="https://github.com/hssum9409/daily_odd_builds-public/releases/download/$($item.tag_name)/"
        $zip=@($item.assets|Where-Object{$_.name -eq $name -and $_.state -eq 'uploaded'});$sums=@($item.assets|Where-Object{$_.name -eq 'SHA256SUMS.txt' -and $_.state -eq 'uploaded'})
        if($zip.Count -ne 1 -or $sums.Count -ne 1 -or $zip[0].browser_download_url -ne $base+$name -or $sums[0].browser_download_url -ne $base+'SHA256SUMS.txt'){continue}
        $zip=$zip[0];if($zip.size -isnot [ValueType] -or $zip.size -is [bool] -or $zip.size -le 0 -or $zip.size -gt 32MB -or $zip.size -ne [math]::Floor([double]$zip.size) -or ($zip.digest -and $zip.digest -notmatch '^sha256:[a-fA-F0-9]{64}$')){continue}
        $list+=@{version=$version;name=$name;url=$zip.browser_download_url;sums=$sums[0].browser_download_url;size=$zip.size;digest=([string]$zip.digest).Replace('sha256:','').ToLowerInvariant()}
    }
    return $list|Sort-Object @{Expression={[version]$_.version};Descending=$true}|Select-Object -First 1
}
function Fetch([string]$Url,[string]$Path,[long]$Maximum) {
    for($hop=0;$hop -lt 6;$hop++) {
        $uri=[Uri]$Url
        if($uri.Scheme -ne 'https' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Host -notin @('api.github.com','github.com','objects.githubusercontent.com','release-assets.githubusercontent.com')){throw 'update_download'}
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        $request=[Net.HttpWebRequest]::Create($uri);$request.AllowAutoRedirect=$false;$request.UserAgent='CodexUsageMonitorScripts-Updater';$request.Timeout=20000;$request.ReadWriteTimeout=20000
        try{$response=$request.GetResponse()}catch [Net.WebException]{
            $response=$_.Exception.Response
            if($response -and [int]$response.StatusCode -in @(403,429)){
                $seconds=21600;$retry=$response.Headers['Retry-After'];$retryNumber=0
                if([int]::TryParse($retry,[ref]$retryNumber)){$seconds=[Math]::Max(21600,[Math]::Min(86400,$retryNumber))}
                $cache.nextCheck=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+$seconds
                $cache.blockedUntil=$cache.nextCheck
                $response.Dispose();throw 'update_rate_limit'
            }
            if($response){$response.Dispose()};throw
        }
        try {
            if([int]$response.StatusCode -in @(301,302,303,307,308)) {$Url=([Uri]::new($uri,$response.Headers['Location'])).AbsoluteUri;continue}
            if([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt $Maximum){throw 'update_download'}
            $input=$response.GetResponseStream();$output=[IO.File]::Create($Path)
            try{$buffer=New-Object byte[] 65536;$total=0;while(($read=$input.Read($buffer,0,$buffer.Length)) -gt 0){$total+=$read;if($total -gt $Maximum){throw 'update_download'};$output.Write($buffer,0,$read)}}finally{$output.Dispose();$input.Dispose()}
            return
        } finally {$response.Dispose()}
    }
    throw 'update_download'
}
function Safe-Path([string]$Root,[string]$Name) {
    $full=[IO.Path]::GetFullPath((Join-Path $Root $Name));$base=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    if(-not $full.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'update_checksum'}
    # 포터블 교체가 심볼릭 링크/정션을 따라 다른 폴더에 쓰지 않게 한다.
    $part=$full
    while($part){if((Test-Path -LiteralPath $part) -and ((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'update_install'};$part=[IO.Path]::GetDirectoryName($part)}
    return $full
}
function Payload-Files([string]$Root) {
    $files=@();$seen=@{}
    foreach($line in Get-Content -LiteralPath (Join-Path $Root 'payload.sha256') -Encoding UTF8){
        if($line -notmatch '^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$'){throw 'update_checksum'}
        $hash=$Matches[1];$name=$Matches[2]
        if($name.StartsWith('/') -or $name.Split('/') -contains '..' -or $name.StartsWith('macos/') -or $seen[$name]){throw 'update_checksum'}
        $seen[$name]=$true
        if((File-Digest (Safe-Path $Root $name)) -ne $hash){throw 'update_checksum'}
        $files+=$name
    }
    foreach($required in @('windows/Monitor.ps1','windows/Install.ps1','defaults.json','ui.json','assets/gp-chan-monitor.png')){if($files -notcontains $required){throw 'update_checksum'}}
    return $files
}
function Copy-Payload([string]$From,[string]$To,$Files) {
    foreach($name in $Files+@('payload.sha256')){$path=Safe-Path $To $name;$null=New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force;Copy-Item -LiteralPath (Safe-Path $From $name) -Destination $path -Force}
}
function Launch-Monitor {
    return Start-BackgroundPowerShell (Join-Path $TargetRoot 'windows\Monitor.ps1')
}
function Confirm-Update($Words,[string]$Old,[string]$New) {
    Add-Type -AssemblyName PresentationFramework
    $body=$Words.update_body.Replace('{old}',$Old).Replace('{new}',$New)
    return [Windows.MessageBox]::Show($body,$Words.update_title,'YesNo','Information') -eq 'Yes'
}
$hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($Profile)))).Replace('-','')
$mutex=New-Object Threading.Mutex($false,('Local\ScriptsUpdate-'+$hash.Substring(0,16)));$owned=$false
try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
if(-not $owned){$mutex.Dispose();exit 0}
$job=Join-Path $Profile ('updates\'+[Guid]::NewGuid().ToString('N'));$null=New-Item -ItemType Directory -Path $job -Force
$backup=Join-Path $job 'backup';$swapped=$false;$oldFiles=@();$newFiles=@();$running=$null;$newProcess=$null
try {
    $oldCache=Json $cachePath;if($oldCache){foreach($key in @('nextCheck','blockedUntil','failedVersion')){if($null -ne $oldCache.$key){$cache[$key]=$oldCache.$key}}}
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds();$oldVersion=(Json (Join-Path $TargetRoot 'defaults.json')).version
    if(-not $PackagePath){
        if($cache.blockedUntil -gt $now -and $cache.blockedUntil -le $now+86400){exit 0}
        if(-not $Force -and $cache.nextCheck -gt $now -and $cache.nextCheck -le $now+86400){exit 0}
        $cache.nextCheck=$now+21600;Save-Status 'update_checking'
        $api=Join-Path $job 'releases.json';Fetch 'https://api.github.com/repos/hssum9409/daily_odd_builds-public/releases?per_page=100' $api 4MB
        try{$list=Get-Content -LiteralPath $api -Raw -Encoding UTF8|ConvertFrom-Json}catch{throw 'update_response'}
        if((Get-Content -LiteralPath $api -Raw -Encoding UTF8).TrimStart()[0] -ne '['){throw 'update_response'}
        $candidate=Select-Release $list $oldVersion
        if(-not $candidate){Save-Status 'update_unavailable';exit 0}
        if(-not $Force -and $candidate.version -eq $cache.failedVersion){exit 0}
        $config=Json (Join-Path $Profile 'settings.json');$language=if($config.language -in @('ko','en','zh','ja')){$config.language}else{'ko'}
        $words=(Json (Join-Path $TargetRoot 'strings.json')).$language
        if(-not $config.autoUpdate -and -not (Confirm-Update $words $oldVersion $candidate.version)){Save-Status 'update_available';exit 0}
        Save-Status 'update_downloading';$sums=Join-Path $job 'SHA256SUMS.txt';Fetch $candidate.sums $sums 256KB
        $checksumLines=@(Get-Content -LiteralPath $sums|Where-Object{$_ -match ('^([a-fA-F0-9]{64})\s+\*?'+[regex]::Escape($candidate.name)+'$')})
        if($checksumLines.Count -ne 1){throw 'update_checksum'};$Digest=($checksumLines[0] -split '\s+')[0].ToLowerInvariant()
        if($candidate.digest -and $candidate.digest -ne $Digest){throw 'update_checksum'}
        $PackagePath=Join-Path $job 'payload.zip';Fetch $candidate.url $PackagePath 32MB
        if((Get-Item -LiteralPath $PackagePath).Length -ne $candidate.size){throw 'update_checksum'};$ExpectedVersion=$candidate.version
    }
    if($Digest -notmatch '^[a-fA-F0-9]{64}$' -or (File-Digest $PackagePath) -ne $Digest){throw 'update_checksum'}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($PackagePath);$payload=Join-Path $job 'payload';$expanded=0;$seen=@{}
    try{if($archive.Entries.Count -gt 256){throw 'update_checksum'};foreach($entry in $archive.Entries){$name=$entry.FullName;$expanded+=$entry.Length
        if($expanded -gt 64MB -or $name -notmatch '^CodexUsageMonitorScripts/[a-zA-Z0-9_./-]+$' -or $name.Split('/') -contains '..' -or $seen[$name] -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'update_checksum'}
        $seen[$name]=$true;$path=Join-Path $payload $name;$null=New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force;[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$path)
    }}finally{$archive.Dispose()}
    $source=Join-Path $payload 'CodexUsageMonitorScripts';$newFiles=@(Payload-Files $source);$oldFiles=@(Payload-Files $TargetRoot)
    if((Json (Join-Path $source 'defaults.json')).version -ne $ExpectedVersion -or -not (Newer $ExpectedVersion $oldVersion)){throw 'update_response'}
    Copy-Payload $TargetRoot $backup $oldFiles
    $record=Json (Join-Path $Profile 'instance.json');$env:CODEX_USAGE_SCRIPTS_HOME=$Profile
    if($record){$running=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.pid)" -ErrorAction SilentlyContinue
        if($running -and $running.CommandLine.IndexOf((Join-Path $TargetRoot 'windows\Monitor.ps1'),[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'update_shutdown'}
        Save-Status 'applying';& powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $TargetRoot 'windows\Monitor.ps1') -Stop
        $watch=[Diagnostics.Stopwatch]::StartNew();while($running -and (Get-Process -Id $record.pid -ErrorAction SilentlyContinue) -and $watch.Elapsed.TotalSeconds -lt 25){Start-Sleep -Milliseconds 100}
        if($running -and (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)){throw 'update_shutdown'}
    }
    $swapped=$true
    if(Test-Path -LiteralPath (Join-Path $TargetRoot 'installed.json')){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $source 'windows\Install.ps1') -InstallBase ([IO.Path]::GetDirectoryName($TargetRoot));if($LASTEXITCODE){throw 'update_install'}}
    else{Copy-Payload $source $TargetRoot $newFiles;foreach($name in $oldFiles){if($newFiles -notcontains $name){Remove-Item -LiteralPath (Join-Path $TargetRoot $name) -Force}}}
    if(-not $NoRelaunch){$newProcess=Launch-Monitor;$watch=[Diagnostics.Stopwatch]::StartNew();$ready=$false
        while($watch.Elapsed.TotalSeconds -lt 30 -and -not $newProcess.HasExited){$instance=Json (Join-Path $Profile 'instance.json');if($instance.pid -eq $newProcess.Id -and $instance.ready -and $instance.version -eq $ExpectedVersion){$ready=$true;break};Start-Sleep -Milliseconds 200}
        if(-not $ready){throw 'update_startup'};Start-Sleep -Seconds 2;if($newProcess.HasExited){throw 'update_startup'}
    }
    $cache.failedVersion='';Save-Status 'installed';@{status='installed';version=$ExpectedVersion;settingsPreserved=$true}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job 'result.json') -Encoding UTF8
} catch {
    $errorCode=if($_.Exception.Message -match '^update_'){$_.Exception.Message}else{'update_network'}
    if($swapped){
        if($newProcess -and -not $newProcess.HasExited){& powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $TargetRoot 'windows\Monitor.ps1') -Stop;$null=$newProcess.WaitForExit(15000)}
        if($newProcess -and -not $newProcess.HasExited){Save-Status 'recovery_required';throw 'New monitor is still running; backup preserved.'}
        if(Test-Path -LiteralPath (Join-Path $TargetRoot 'installed.json')){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $backup 'windows\Install.ps1') -InstallBase ([IO.Path]::GetDirectoryName($TargetRoot));if($LASTEXITCODE){Save-Status 'recovery_required';throw 'Rollback failed; backup preserved.'}}
        else{Copy-Payload $backup $TargetRoot $oldFiles;foreach($name in $newFiles){if($oldFiles -notcontains $name){Remove-Item -LiteralPath (Join-Path $TargetRoot $name) -Force -ErrorAction SilentlyContinue}}}
        if(-not $NoRelaunch){$null=Launch-Monitor}
    }
    $cache.failedVersion=$ExpectedVersion;Save-Status $errorCode
    @{status=$(if($swapped){'rolled_back'}else{'failed'});error=$errorCode;backup=$backup}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job 'result.json') -Encoding UTF8
    if($PackagePath){throw $errorCode}
} finally {if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
