function Sync-Taskbar {
    $enabled=$script:config.taskbarWidget -and $script:alive
    if(-not $enabled){Stop-Taskbar;return}
    $now=Now
    if($now -lt $script:nextTaskbar){return};$script:nextTaskbar=$now+1
    if(-not $script:taskbarProcess -or $script:taskbarProcess.HasExited){
        $path=Join-Path $PSScriptRoot 'Taskbar.ps1';$ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $args='-NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$path+'" -StatePath "'+$script:taskbarStateFile+'" -ParentId '+$PID
        if($TracePath){$args+=' -ReportPath "'+(Join-Path $profile 'taskbar-diagnostic.json')+'"'}
        if($TracePath){$script:taskbarProcess=Start-Process -FilePath $ps -ArgumentList $args -WindowStyle Hidden -RedirectStandardError (Join-Path $profile 'taskbar-stderr.log') -PassThru}
        else{$script:taskbarProcess=Start-Process -FilePath $ps -ArgumentList $args -WindowStyle Hidden -PassThru}
    }
    $display=Get-UsagePresentation $script:data $script:usageHealth $script:config $now $script:words $script:lastError
    $text=if($script:lastData){$display.lines[0]}else{T 'connecting'}
    $text=[regex]::Replace($text,'\s*[\(（][^\)）]*[\)）]','')
    $system=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name SystemUsesLightTheme -ErrorAction SilentlyContinue
    $light=[bool]$system.SystemUsesLightTheme
    $items=@(Get-TaskbarReadings $script:data $script:usageHealth $script:config $now $script:words)
    $basis=if($script:config.usageDisplay -eq 'remaining'){$script:words.taskbar_remaining}else{$script:words.used}
    $state=@{enabled=$true;at=$now;text=$text;tooltip=(($display.lines -join "`n")+"`n"+(T 'settings'));light=$light;remaining=($script:config.usageDisplay -eq 'remaining');basis=$basis;items=$items;commandHwnd=$script:commandHwnd}
    Write-Json $script:taskbarStateFile $state
}
function Get-TaskbarReadings($Data,$Health,$Settings,[double]$Now,$Words) {
    # 표시 문구를 다시 파싱하지 않고 원본 수치에서 게이지 데이터를 만든다.
    $items=@();$seen=@{}
    foreach($bucket in (Get-Buckets $Data)) {
        foreach($key in @('primary','secondary')) {
            $window=$bucket.$key;if(-not $window){continue}
            $weekly=(Test-Finite $window.windowDurationMins) -and $window.windowDurationMins -ge 1440
            if(($weekly -and -not $Settings.weekly) -or (-not $weekly -and (-not $Settings.short -or (Test-Pro $Data)))){continue}
            $kind=if($weekly){'weekly'}else{'short'};if($seen[$kind]){continue};$seen[$kind]=$true
            $value=$null
            $pending=$window._resetPending -or ($Health.lastSuccess -gt 0 -and (Test-Finite $window.resetsAt) -and $Now -ge $window.resetsAt -and $Health.lastSuccess -lt $window.resetsAt)
            if(-not $pending -and (Test-Finite $window.usedPercent)){$value=[Math]::Max(0,[Math]::Min(100,$window.usedPercent))}
            $label=if($weekly){$Words.weekly}elseif($window.windowDurationMins -eq 300){'5h'}else{'Window'}
            $detail='';$showReset=if($weekly){$Settings.weeklyReset}else{$Settings.shortReset}
            if($showReset){$detail=if($pending){$Words.usage_reset_pending}else{$Words.taskbar_reset.Replace('{value}',(Get-Duration $window.resetsAt $Now $true))}}
            $items+=@{label=$label;used=$value;weekly=[bool]$weekly;detail=$detail}
        }
    }
    return $items
}
function Stop-Taskbar {
    if($script:taskbarProcess){
        if(-not $script:taskbarProcess.HasExited){Stop-Process -Id $script:taskbarProcess.Id -ErrorAction SilentlyContinue;$null=$script:taskbarProcess.WaitForExit(1500)}
        $script:taskbarProcess.Dispose();$script:taskbarProcess=$null
    }
}
