# 조회 성공 여부와 상세정보 누락을 분리한다. 보존하는 값은 메모리에만 둔다.
function New-UsageHealth {
    return @{account='';lastSuccess=0.0;detailsAt=0.0;details=$null;count=$null;cycle='';retained=$false}
}
function Merge-UsageSnapshot($Health,$Incoming,[string]$Identity,[double]$Now) {
    $cycle=(@(foreach($bucket in (Get-Buckets $Incoming)){foreach($key in @('primary','secondary')){if($bucket.$key){[string]$bucket.$key.resetsAt}}}) -join ':')
    $r=$Incoming.rateLimitResetCredits;$count=$r.availableCount
    $validCount=(Test-Finite $count) -and $count -ge 0 -and [Math]::Floor($count) -eq $count
    if($Identity -cne $Health.account -or -not $validCount -or $count -ne $Health.count -or $cycle -cne $Health.cycle){
        $Health.details=$null;$Health.detailsAt=0
    }
    $Health.account=$Identity;$Health.count=$count;$Health.cycle=$cycle;$Health.retained=$false;$Health.lastSuccess=$Now
    if($r.credits -is [array]){
        # []는 서버가 상세 조회를 완료한 결과다. 이전 목록으로 덮어쓰지 않는다.
        $Health.details=@($r.credits|Where-Object {$_ -and $_.status -eq 'available' -and (Test-Finite $_.expiresAt) -and $_.expiresAt -gt $Now})
        $Health.detailsAt=$Now
    }elseif($r -and $null -eq $r.credits -and $Identity -and $validCount -and $count -gt 0 -and $Health.detailsAt -gt 0 -and $Now-$Health.detailsAt -le 120 -and $Now -ge $Health.detailsAt){
        $available=@($Health.details|Where-Object {$_.expiresAt -gt $Now})
        # 만료로 목록이 바뀌었으면 보존하지 않는다. 계정/개수/한도 주기 변화도 위에서 무효화한다.
        if($available.Count -gt 0 -and $available.Count -eq @($Health.details).Count){
            $copy=$Incoming|ConvertTo-Json -Depth 20|ConvertFrom-Json
            $copy.rateLimitResetCredits|Add-Member -NotePropertyName credits -NotePropertyValue $available -Force
            $Health.retained=$true;return $copy
        }
    }
    return $Incoming
}
function Get-UsagePresentation($Data,$Health,$Settings,[double]$Now,$Words,[string]$ErrorCode='') {
    $observed=if($Health){$Health.lastSuccess}else{0}
    $pending=@();$snapshot=$Data
    if($observed -gt 0){
        foreach($bucket in (Get-Buckets $Data)){
            foreach($key in @('primary','secondary')){
                $window=$bucket.$key
                if($window -and (Test-Finite $window.resetsAt) -and $Now -ge $window.resetsAt -and $observed -lt $window.resetsAt){$pending+=@{minutes=$window.windowDurationMins;at=$window.resetsAt}}
            }
        }
        if($pending.Count){
            $snapshot=$Data|ConvertTo-Json -Depth 20|ConvertFrom-Json
            foreach($bucket in (Get-Buckets $snapshot)){foreach($key in @('primary','secondary')){
                $window=$bucket.$key
                if($window -and (Test-Finite $window.resetsAt) -and $Now -ge $window.resetsAt -and $observed -lt $window.resetsAt){$window.usedPercent=$null;$window|Add-Member -NotePropertyName _resetPending -NotePropertyValue $true -Force}
            }}
        }
    }
    $view=Get-View $snapshot $Settings $Now $Words;$lines=@($view.lines);$notes=@()
    $info=$Data.rateLimitResetCredits
    if(($Settings.tickets -or $Settings.expiry) -and $info.availableCount -gt 0){
        if($Health.retained){$notes+=$Words.usage_details_delayed}
        elseif($null -eq $info.credits){$notes+=$Words.usage_details_missing}
        elseif(@($view.tickets.rows).Count -lt $info.availableCount){$notes+=$Words.usage_details_partial}
    }
    if($pending.Count){$notes+=$Words.usage_reset_pending}
    if($observed -gt 0 -and ($ErrorCode -or $Now-$observed -ge 60 -or $Now -lt $observed)){
        $notes+=$Words.usage_delayed
    }
    if($notes.Count){
        $status=($notes -join ' · ')
        $checkedAt=if($Health.retained){[Math]::Min($observed,$Health.detailsAt)}else{$observed}
        if($checkedAt -gt 0){$status+=' · '+$Words.usage_last_checked+' '+[DateTimeOffset]::FromUnixTimeSeconds([long]$checkedAt).ToLocalTime().ToString('HH:mm:ss')}
        $lines+=$status
    }
    return @{view=$view;lines=$lines;pending=$pending.Count -gt 0;notes=$notes;observed=$observed}
}
