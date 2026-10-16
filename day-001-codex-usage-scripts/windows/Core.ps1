# 공유 fixture로 macOS의 순수 JS 로직과 결과를 비교하는 PowerShell 5.1 코어.
function Test-Number($Value) {
    if ($null -eq $Value -or $Value -is [bool] -or ($Value -is [string] -and $Value -eq '')) { return $false }
    $parsed = 0.0
    return [double]::TryParse([string]$Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed) -and -not [double]::IsNaN($parsed) -and -not [double]::IsInfinity($parsed)
}
function Test-Finite($Value) { return ($Value -is [ValueType] -and $Value -isnot [bool] -and (Test-Number $Value)) }
function Get-Buckets($Data) {
    if ($Data.rateLimitsByLimitId -and @($Data.rateLimitsByLimitId.PSObject.Properties).Count) {
        return @($Data.rateLimitsByLimitId.PSObject.Properties | ForEach-Object { if ($_.Value -is [pscustomobject]) { $_.Value } })
    }
    if ($Data.rateLimits) { return @($Data.rateLimits) }
    return @()
}
function Test-Pro($Data) { return @((Get-Buckets $Data) | Where-Object { $_.planType -eq 'pro' }).Count -gt 0 }
function Get-Duration($At, [double]$Now, [bool]$OmitMinutes = $false) {
    if (-not (Test-Finite $At)) { return '—' }
    $mins = [Math]::Max(0, [Math]::Floor(($At - $Now) / 60))
    $days = [Math]::Floor($mins / 1440); $hours = [Math]::Floor(($mins % 1440) / 60)
    if ($days -and $OmitMinutes) { return ('{0}d {1:00}h' -f $days, $hours) }
    $prefix = if ($days) { '{0}d {1:00}' -f $days, $hours } else { [string]$hours }
    return $prefix + (':{0:00}' -f ($mins % 60))
}
function Format-Credit($Value) {
    if (-not (Test-Number $Value) -or [decimal]$Value -lt 0) { return '—' }
    try { return ([decimal]$Value).ToString('#,##0.############################', [Globalization.CultureInfo]::InvariantCulture) } catch { return '—' }
}
function Get-Tickets($Data, [double]$Now) {
    $r = $Data.rateLimitResetCredits
    $rows = @($r.credits | Where-Object { $_ -and $_.status -eq 'available' -and (-not (Test-Finite $_.expiresAt) -or $_.expiresAt -gt $Now) })
    $dated = @($rows | Where-Object { Test-Finite $_.expiresAt } | ForEach-Object { $_.expiresAt })
    $count = if (Test-Finite $r.availableCount) { $r.availableCount } else { $null }
    $expiry = if ($dated.Count) { ($dated | Measure-Object -Minimum).Minimum } else { $null }
    return @{count = $count; expiry = $expiry; rows = $rows}
}
function Get-View($Data, $Settings, [double]$Now, $Words) {
    $windows = @(); $balance = $null; $unlimited = $false; $shortShown = $false
    foreach ($b in (Get-Buckets $Data)) {
        foreach ($key in @('primary', 'secondary')) {
            $w = $b.$key
            if (-not $w) { continue }
            $weekly = (Test-Finite $w.windowDurationMins) -and $w.windowDurationMins -ge 1440
            if (($weekly -and -not $Settings.weekly) -or (-not $weekly -and (-not $Settings.short -or (Test-Pro $Data)))) { continue }
            $windows += @{window = $w; weekly = $weekly}
            if (-not $weekly) { $shortShown = $true }
        }
        if ($b.credits) { $balance = $b.credits.balance; $unlimited = $b.credits.unlimited -eq $true }
    }
    $parts = @(); $lines = @(); $ticket = Get-Tickets $Data $Now
    foreach ($v in $windows) {
        $w = $v.window
        $label = if ($v.weekly) { $Words.weekly } elseif ($w.windowDurationMins -eq 300) { '5h' } else { 'Window' }
        $percent = '—'
        if (Test-Finite $w.usedPercent) {
            $n = [Math]::Min(100, [Math]::Max(0, $w.usedPercent))
            if ($Settings.usageDisplay -eq 'remaining') { $n = 100 - $n }
            $percent = ([Math]::Round($n, 1)).ToString([Globalization.CultureInfo]::InvariantCulture) + '%'
        }
        $text = "$label $percent"
        if (($v.weekly -and $Settings.weeklyReset) -or (-not $v.weekly -and $Settings.shortReset)) { $text += " ($($Words.reset) $(Get-Duration $w.resetsAt $Now ($v.weekly -and $shortShown)))" }
        $parts += $text
    }
    if ($parts.Count) { $suffix = if ($Settings.usageDisplay -eq 'remaining') { $Words.remaining } else { $Words.used }; $lines += ($parts -join ' · ') + " $suffix" }
    if ($Settings.tickets -or $Settings.expiry) {
        $text = ''
        if ($Settings.tickets) { $n = if ($null -eq $ticket.count) { '—' } elseif ($Words.count) { $Words.count.Replace('{n}',[string]$ticket.count) } else {$ticket.count}; $text = "$($Words.tickets) $n" }
        if ($Settings.expiry) { if ($text) { $text += ' · ' }; $text += "$($Words.expires) $(Get-Duration $ticket.expiry $Now $true)" }
        $lines += $text
    }
    if ($Settings.balance) { $value = if ($unlimited) { '∞' } else { Format-Credit $balance }; $lines += "$($Words.balance) $value" }
    if (-not $lines.Count) { $lines = @($Words.noData) }
    return @{lines = $lines; tickets = $ticket; balance = $balance; unlimited = $unlimited; pro = (Test-Pro $Data)}
}
function Get-ResetTimestamp($Value) {
    $date = [DateTimeOffset]::MinValue
    if ($Value -is [string] -and $Value -match '(Z|[+-]\d\d:\d\d)$' -and [DateTimeOffset]::TryParse($Value, [ref]$date)) { return $date.ToUnixTimeSeconds() }
    return $null
}
function Get-ResetSource($Source) {
    if ($Source.author -ceq 'thsottiaux' -and $Source.url -cmatch '^https://(x|twitter)\.com/thsottiaux/status/\d+(\?.*)?$') { return $Source.url }
    return ''
}
function Get-Scheduled($Payload, [double]$Now = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())) {
    $a = $Payload.data.scheduled_reset
    # 유효한 예고를 우선한다. 조짐 유효기간은 초기화 예정 시각과 분리한다.
    if ($a -and $a.status -eq 'scheduled' -and $a.id -match '^[a-zA-Z0-9_-]{1,64}$' -and $a.reset_type -in @('regular', 'banked')) {
        return @{id = $a.id; type = $a.reset_type; at = (Get-ResetTimestamp $a.scheduled_for); url = (Get-ResetSource $a.source)}
    }
    $watch = $Payload.data.active_watch
    if (-not $watch) { return $null }
    $url = Get-ResetSource $watch.source; $until = Get-ResetTimestamp $watch.expires_at
    if (-not $url -or -not (Test-Finite $until) -or $until -le $Now) { return $null }
    $observed = Get-ResetTimestamp $watch.observed_at; $completed = Get-ResetTimestamp $Payload.data.latest_reset.announced_at
    if ((Test-Finite $observed) -and (Test-Finite $completed) -and $completed -ge $observed) { return $null }
    $post = [regex]::Match($url, '/status/(\d+)').Groups[1].Value
    return @{id = "watch-$post"; type = 'watch'; at = $null; until = $until; url = $url}
}
function Test-NoticeActive($Announcement, [double]$Now) {
    return [bool]($Announcement -and ($Announcement.type -ne 'watch' -or ((Test-Finite $Announcement.until) -and $Now -lt $Announcement.until)))
}
function Get-NoticeTitle($Announcement, [double]$Now, $Words) {
    if ($Announcement.type -eq 'watch') {
        # 최초 범위(forecast_window) 대신 종료 시각으로 계산한다. 추가 API 조회 없이 분 단위로 줄어든다.
        $hint = if ((Test-Finite $Announcement.until) -and $Announcement.until -gt $Now) { $Words.watch_within.Replace('{value}', (Get-ForecastUntil $Announcement.until $Now $Words)) } else { $Words.watch_pending }
        return $Words.reset_watch + ' · ' + $hint
    }
    $kind = if ($Announcement.type -eq 'banked') { $Words.reset_stored } else { $Words.reset_normal }
    return "$kind $($Words.notice_reset) · $($Words.notice_after.Replace('{value}', (Get-Forecast $Announcement $Now $Words))) $($Words.estimated)"
}
function Get-ReminderKey($Announcement, [double]$Now, [int]$Minutes) {
    if (-not (Test-NoticeActive $Announcement $Now)) { return '' }
    if ($Announcement.type -eq 'watch') { return $Announcement.id + ':watch:' + [Math]::Floor($Now / ($Minutes * 60)) }
    if (-not (Test-Finite $Announcement.at)) { return $Announcement.id + ':pending' }
    $remain = [Math]::Max(0, $Announcement.at - $Now)
    $key = [string][Math]::Ceiling($remain / ($Minutes * 60))
    foreach ($m in @(3600, 1800, 600, 300, 60, 0)) { if ($remain -le $m) { $key = "m$m" } }
    return $Announcement.id + ':' + $key
}
function Get-Forecast($Announcement, [double]$Now, $Words) {
    return Get-ForecastUntil $Announcement.at $Now $Words
}
function Get-ForecastUntil($Until, [double]$Now, $Words) {
    if (-not (Test-Finite $Until)) { return $Words.pending }
    $mins = [Math]::Max(0, [Math]::Ceiling(($Until - $Now) / 60))
    if (-not $mins) { return $Words.due }
    $days = [Math]::Floor($mins / 1440); $hours = [Math]::Floor(($mins % 1440) / 60)
    if ($days -eq 1 -and $hours -eq 0) { return "24$($Words.hour)" }
    if ($days) { return "$days$($Words.day) $hours$($Words.hour)" }
    return "$([Math]::Floor($mins / 60))$($Words.hour) $($mins % 60)$($Words.minute)"
}
function Test-CreditEvent($State, $Data, [int]$Step) {
    $b = @(Get-Buckets $Data) | Select-Object -First 1; $c = $b.credits
    if ($c.unlimited -or -not (Test-Number $c.balance) -or [decimal]$c.balance -lt 0) { $State.previous = $null; return $false }
    $value = [decimal]$c.balance; $cycle = "$($b.primary.resetsAt):$($b.secondary.resetsAt)"; $old = $State.previous
    $changed = $null -ne $old -and $State.cycle -eq $cycle -and $value -lt $old
    $event = $changed -and (-not $State.consuming -or [Math]::Ceiling($value / $Step) -lt [Math]::Ceiling($old / $Step))
    if ($null -eq $old -or $State.cycle -ne $cycle -or $value -gt $old) { $State.consuming = $false }
    if ($changed) { $State.consuming = $true }
    $State.previous = $value; $State.cycle = $cycle
    return $event
}
function Get-Lifecycle($Settings, [bool]$Alive, [bool]$Pet, [double]$Now, $State) {
    if (-not $Alive) { $State.missingSince = $null; return 'idle' }
    if ($Settings.placement -eq 'hidden') { return 'hidden' }
    if ($Settings.placement -eq 'free') { return 'free' }
    if ($Pet) { $State.missingSince = $null; return $Settings.placement }
    if ($null -eq $State.missingSince) { $State.missingSince = $Now }
    if ($Now - $State.missingSince -lt 1) { return 'waiting' }
    return 'free'
}
function Get-Placement($Pet, $Blockers, $Screen, [double]$Width, [double]$Height, [string]$Preferred, $Insets=$null, $Settings=$null) {
    if ($Width -le 0 -or $Height -le 0 -or $Width -gt $Screen.w -or $Height -gt $Screen.h) {return $null}
    $x = [Math]::Max($Screen.x, [Math]::Min($Screen.x + $Screen.w - $Width, $Pet.x + $Pet.w / 2 - $Width / 2))
    $above = $Pet.y; $below = $Pet.y + $Pet.h
    foreach ($b in $Blockers) {
        if ($b.x + $b.w -gt $x -and $b.x -lt $x + $Width) {
            if ($b.y + $b.h -le $Pet.y + 3) { $above = [Math]::Min($above, $b.y) }
            if ($b.y -ge $Pet.y + $Pet.h - 3) { $below = [Math]::Max($below, $b.y + $b.h) }
        }
    }
    # 회피 간격은 창 전체가 아니라 실제 카드 테두리 기준이다.
    # 그림자·호버 버튼을 위한 투명 여백을 다시 더하지 않도록 보정한다.
    $topInset=if ($Insets) {[double]$Insets.top} else {0}
    $bottomInset=if ($Insets) {[double]$Insets.bottom} else {0}
    $aboveGap=if ($Settings) {$Settings.gapAbove} else {6}
    $belowGap=if ($Settings) {$Settings.gapBelow} else {12}
    $top = $above - $Height - $aboveGap + $bottomInset; $bottom = $below + $belowGap - $topInset
    $fitsTop = $top -ge $Screen.y; $fitsBottom = $bottom + $Height -le $Screen.y + $Screen.h
    $side = if ($Preferred -eq 'above') { if ($fitsTop) { 'above' } elseif ($fitsBottom) { 'below' } } else { if ($fitsBottom) { 'below' } elseif ($fitsTop) { 'above' } }
    if (-not $side) { return $null }
    return @{x = $x; y = $(if ($side -eq 'above') { $top } else { $bottom }); side = $side}
}
function Get-Normalized($Raw, $Defaults) {
    $s = $Defaults | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    foreach ($p in $s.PSObject.Properties) { if ($p.Value -is [bool] -and $Raw.($p.Name) -is [bool]) { $s.($p.Name) = $Raw.($p.Name) } }
    $options = @{language = @('ko','en','zh','ja'); timezone = @('system','UTC','Asia/Seoul','Asia/Tokyo','Asia/Shanghai','America/Los_Angeles','America/New_York','Europe/London','Europe/Berlin'); usageDisplay = @('used','remaining'); placement = @('above','below','free','hidden'); attachedPlacement = @('above','below')}
    foreach ($k in $options.Keys) { if ($Raw.$k -in $options[$k]) { $s.$k = $Raw.$k } }
    if ($Raw.resetMinutes -in @(10,30,60,120)) { $s.resetMinutes = $Raw.resetMinutes }
    if ($Raw.creditStep -in @(1000,3000,5000,10000)) { $s.creditStep = $Raw.creditStep }
    if (Test-Finite $Raw.pollSeconds) { $s.pollSeconds = [Math]::Max(10,[Math]::Min(300,$Raw.pollSeconds)) }
    # 직접 편집한 설정과 오래된 프로필에도 같은 안전 범위를 적용한다.
    $ranges=@{gapAbove=@(0,40);gapBelow=@(0,40);noticeGap=@(0,40);dragMs=@(16,100);idleMs=@(100,500);chromeMs=@(250,2000);motionMs=@(80,300)}
    foreach ($key in $ranges.Keys) {
        if (Test-Finite $Raw.$key) {
            $bounded=[Math]::Max([double]$ranges[$key][0],[Math]::Min([double]$ranges[$key][1],[double]$Raw.$key))
            $s.$key=[int][Math]::Floor($bounded+0.5)
        }
    }
    if ($Raw.codexPath -is [string]) { $s.codexPath = $Raw.codexPath }
    foreach ($k in @('x','y')) { if (Test-Finite $Raw.$k) { $s.$k = $Raw.$k } }
    foreach ($g in @('main','reset','credit')) {
        foreach ($k in @('color','text')) { if ($Raw.styles.$g.$k -match '^#[0-9a-fA-F]{6}$') { $s.styles.$g.$k = $Raw.styles.$g.$k } }
        if (Test-Finite $Raw.styles.$g.opacity) { $s.styles.$g.opacity = [Math]::Max(0.1,[Math]::Min(1.0,[double]$Raw.styles.$g.opacity)) }
        if ($Raw.styles.$g.autoText -is [bool]) {$s.styles.$g.autoText=$Raw.styles.$g.autoText}
    }
    foreach ($pair in @(@('short','shortReset'),@('weekly','weeklyReset'),@('tickets','expiry'),@('resetNotice','resetSound'),@('creditNotice','creditSound'))) {if (-not $s.($pair[0])) {$s.($pair[1])=$false}}
    return $s
}
function Get-SpeedPreset($Settings,$Presets) {
    foreach ($name in @('fast','default','relaxed')) {
        $same=$true
        foreach ($key in @('dragMs','idleMs','chromeMs','motionMs')) {if ($Settings.$key -ne $Presets.$name.$key) {$same=$false;break}}
        if ($same) {return $name}
    }
    return 'custom'
}
function Get-ReactionInterval($Settings,[bool]$Alive,[bool]$PointerDown) {
    # Codex 비활성 상태의 2초 대기는 고급 설정으로도 짧아지지 않는다.
    if (-not $Alive) {return 2000}
    return $(if ($PointerDown) {$Settings.dragMs} else {$Settings.idleMs})
}
function Get-StyleInk($Style,[string]$Kind) {
    if (-not $Style.autoText) {return $Style.text}
    $default=@{main='#202020';credit='#802b31';reset='#fae297'}
    if ($Style.color.ToLowerInvariant() -eq $default[$Kind]) {return $(if ($Kind -eq 'reset') {'#372c16'} else {'#f8f8f8'})}
    $luminance=0.0;$weights=@(0.2126,0.7152,0.0722)
    for ($i=0;$i -lt 3;$i++) {$value=[Convert]::ToInt32($Style.color.Substring(1+$i*2,2),16)/255.0;$linear=if ($value -le 0.04045) {$value/12.92} else {[Math]::Pow(($value+0.055)/1.055,2.4)};$luminance+=$linear*$weights[$i]}
    # 원본 앱과 같은 후보(흰색 / 짙은 갈색) 중 대비가 높은 색을 선택한다.
    $light=(0.938686+0.05)/($luminance+0.05);$dark=($luminance+0.05)/(0.0267151659402045+0.05)
    return $(if ($light -ge $dark) {'#f8f8f8'} else {'#372c16'})
}
