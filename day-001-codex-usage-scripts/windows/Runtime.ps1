# 일반 실행에도 남는 작은 수명/오류 기록. 콘솔·계정 원문·대화 내용에는 의존하지 않는다.
$script:runtimePath=$null;$script:runtimeRun=[Guid]::NewGuid().ToString('N');$script:runtimeErrors=@{}
$script:exitReason='unexpected';$script:runtimeStage='startup'
function Initialize-RuntimeLog([string]$Profile,[string]$Version,[string]$Component='monitor') {
    $name=if($Component -eq 'taskbar'){'runtime-taskbar.jsonl'}else{'runtime.jsonl'}
    $script:runtimePath=Join-Path $Profile $name;$script:runtimeVersion=$Version
    Write-RuntimeEvent 'start' @{powershell=$PSVersionTable.PSVersion.ToString()}
}
function Write-RuntimeEvent([string]$Kind,$Details) {
    if(-not $script:runtimePath){return}
    try {
        # 현재 파일 + 직전 파일만 보관한다. 기록 실패가 원래 예외를 덮어쓰지 않는다.
        if([IO.File]::Exists($script:runtimePath) -and (New-Object IO.FileInfo($script:runtimePath)).Length -gt 262144){
            $backup=$script:runtimePath+'.1';if([IO.File]::Exists($backup)){[IO.File]::Delete($backup)};[IO.File]::Move($script:runtimePath,$backup)
        }
        $entry=@{at=[DateTimeOffset]::UtcNow.ToString('o');pid=$PID;run=$script:runtimeRun;version=$script:runtimeVersion;event=$Kind;details=$Details}
        [IO.File]::AppendAllText($script:runtimePath,($entry|ConvertTo-Json -Depth 8 -Compress)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
    }catch{}
}
function Get-RuntimeFailure($Failure) {
    $exception=$Failure.Exception;$chain=@()
    while($exception -and $chain.Count -lt 6){
        # 예외 메시지에는 JSON 응답/사용자 입력이 포함될 수 있어 기록하지 않는다.
        # 형식·HResult·함수/줄과 관리 스택으로 위치를 추적한다.
        $chain+=@{type=$exception.GetType().FullName;hresult=$exception.HResult;stack=([string]$exception.StackTrace -replace '(?m) in .*?:line ', ' line ')}
        $exception=$exception.InnerException
    }
    $frames=@([regex]::Matches([string]$Failure.ScriptStackTrace,'(?m)^.*?,.*?([^\\/:]+\.ps1):[^\d]*(\d+)')|ForEach-Object{@{file=$_.Groups[1].Value;line=[int]$_.Groups[2].Value}})
    return @{chain=$chain;file=[IO.Path]::GetFileName([string]$Failure.InvocationInfo.ScriptName);line=$Failure.InvocationInfo.ScriptLineNumber;frames=$frames}
}
function Write-RuntimeFailure([string]$Stage,$Failure) {
    try {
        $detail=Get-RuntimeFailure $Failure;$key=$Stage+':'+$detail.file+':'+$detail.line+':'+$detail.chain[0].type
        $now=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        if(-not $script:runtimeErrors.ContainsKey($key)){
            if($script:runtimeErrors.Count -ge 32){Flush-RuntimeErrors;$script:runtimeErrors.Clear()}
            $script:runtimeErrors[$key]=@{stage=$Stage;failure=$detail;count=1;first=$now;last=$now;written=$now}
            Write-RuntimeEvent 'error' $script:runtimeErrors[$key]
        }else{
            $entry=$script:runtimeErrors[$key];$entry.count++;$entry.last=$now
            if($now-$entry.written -ge 60){$entry.written=$now;Write-RuntimeEvent 'error-repeat' $entry}
        }
    }catch{}
}
function Flush-RuntimeErrors {
    foreach($entry in $script:runtimeErrors.Values){if($entry.count -gt 1){Write-RuntimeEvent 'error-summary' $entry}}
}
function Request-MonitorStop([string]$Reason) {
    $script:exitReason=$Reason;$script:quit=$true;Write-RuntimeEvent 'stop-request' @{reason=$Reason}
}
function Invoke-RuntimeCleanup([string]$Name,[scriptblock]$Action) {
    try {& $Action | Out-Null}catch{Write-RuntimeFailure ('cleanup:'+ $Name) $_}
}
