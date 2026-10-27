function Sync-Taskbar {
    $enabled=$script:config.taskbarWidget -and $script:alive
    if(-not $enabled){Stop-Taskbar;return}
    $now=Now
    if($now -lt $script:nextTaskbar){return};$script:nextTaskbar=$now+1
    if(-not ('UsageScripts.TaskbarService' -as [type])){
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions,UIAutomationClient,UIAutomationTypes,WindowsBase
        Add-Type -Path @("$PSScriptRoot/TaskbarNative.cs","$PSScriptRoot/TaskbarDesign.cs","$PSScriptRoot/TaskbarWidget.cs","$PSScriptRoot/TaskbarService.cs") -ReferencedAssemblies @('System.dll','System.Core.dll',[Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,[Windows.Forms.Form].Assembly.Location,[Drawing.Bitmap].Assembly.Location,[Windows.Automation.AutomationElement].Assembly.Location,[Windows.Automation.ControlType].Assembly.Location,[Windows.Rect].Assembly.Location)
    }
    if(-not [UsageScripts.TaskbarService]::Running){
        $diagnostic=if($TracePath){Join-Path $profile 'taskbar-diagnostic.json'}else{''}
        [UsageScripts.TaskbarService]::Start($script:taskbarStateFile,$PID,$diagnostic)
        $script:taskbarStateKey='';$script:nextTaskbarHeartbeat=0
    }
    $display=Get-UsagePresentation $script:data $script:usageHealth $script:config $now $script:words $script:lastError
    $text=if($script:lastData){$display.lines[0]}else{T 'connecting'}
    $text=[regex]::Replace($text,'\s*[\(（][^\)）]*[\)）]','')
    if($now -ge $script:nextTaskbarTheme){
        $system=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name SystemUsesLightTheme -ErrorAction SilentlyContinue
        $script:taskbarLight=[bool]$system.SystemUsesLightTheme;$script:nextTaskbarTheme=$now+5
    }
    $light=$script:taskbarLight
    $items=@(Get-TaskbarReadings $script:data $script:usageHealth $script:config $now $script:words)
    $basis=if($script:config.usageDisplay -eq 'remaining'){$script:words.taskbar_remaining}else{$script:words.used}
    $state=[ordered]@{enabled=$true;text=$text;tooltip=(($display.lines -join "`n")+"`n"+(T 'settings'));light=$light;remaining=($script:config.usageDisplay -eq 'remaining');basis=$basis;items=$items;commandHwnd=$script:commandHwnd}
    $key=$state|ConvertTo-Json -Depth 8 -Compress
    # 내용이 같으면 5초 간격의 생존 신호만 쓴다. 사용량 조회 주기는 변경하지 않는다.
    if($key -cne $script:taskbarStateKey -or $now -ge $script:nextTaskbarHeartbeat){
        $state.at=$now;Write-Json $script:taskbarStateFile $state
        $script:taskbarStateKey=$key;$script:nextTaskbarHeartbeat=$now+5
    }
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
    if('UsageScripts.TaskbarService' -as [type]){[UsageScripts.TaskbarService]::Stop()}
}
