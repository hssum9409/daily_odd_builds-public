# Codex 창 안쪽에 붙는 도구 창이다. 앱 파일·DOM·프로세스 메모리는 수정하지 않는다.
# 소유자 지정으로 최소화와 Z 순서를 따르고, 빈 우측 여백이 부족하면 숨긴다.
function Get-DockGeometry($Client,[double]$Scale=1,[double]$Sidebar=0) {
    if(-not $Client -or $Scale -le 0){return $null}
    $width=$Client.w/$Scale;$height=$Client.h/$Scale
    # 중앙 채팅 폭 720 DIP와 양쪽 완충 공간을 남겨 입력창을 가리지 않는다.
    $rail=($width-$Sidebar-720)/2-12
    if($height -lt 400 -or $width-$Sidebar -lt 340){return $null}
    # 여백이 좁으면 자동 요약으로 시작한다. 전체 패널을 겹쳐 표시하려면 사용자가 펼쳐야 한다.
    $compact=$rail -lt 180
    $cardWidth=if($rail -ge 260){308}else{224}
    # 새 대화/워크트리 대기 화면은 입력창이 우측 여백까지 넓어진다.
    # 하단 입력 영역을 예약하고, 패널을 올려놓을 높이가 부족하면 표시하지 않는다.
    $bottomInset=200
    if($height-$bottomInset-100 -lt 120){return $null}
    return @{x=$Client.x/$Scale;y=$Client.y/$Scale;w=$width;h=$height;cardWidth=$cardWidth;compact=$compact;bottomInset=$bottomInset;maxBodyHeight=[Math]::Max(80,$height-$bottomInset-112)}
}
function Sync-DockSurface {
    $docked=$script:config.placement -eq 'dock'
    if(-not $docked -and -not $script:mainCard.docked){$script:dockReady=$false;return}
    if($docked){$null=Update-CodexAppearance}
    $hostFrame=if($script:dockTestHost){$script:dockTestHost}else{[UsageScripts.AppDock]::Read([UsageScripts.AppDock]::Current.Hwnd)}
    $hostForeground=[UsageScripts.AppDock]::IsForeground($hostFrame.Hwnd)
    $source=[Windows.PresentationSource]::FromVisual($script:mainCard.window)
    $scale=if($source){$source.CompositionTarget.TransformToDevice.M11}else{1.0}
    $sidebar=0
    if($docked -and $script:alive -and $hostFrame.Visible -and -not $script:dockTestHost -and $hostForeground){
        $codexStateHome=if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}
        [UsageScripts.DockOccupancy]::RefreshSidebar($codexStateHome);$sidebar=[UsageScripts.DockOccupancy]::SidebarWidth
    }
    if($docked -and -not $script:dockTestHost -and $sidebar -eq 0){$sidebar=[UsageScripts.DockOccupancy]::SidebarWidth}
    $script:dockGeometry=Get-DockGeometry $hostFrame.Client $scale $sidebar
    $now=Now
    if($docked -and $script:dockGeometry -and -not $script:dockTestHost -and $hostForeground){
        $g=$script:dockGeometry
        $signature=[string]$hostFrame.Hwnd+':'+$hostFrame.Client.w+':'+$hostFrame.Client.h+':'+$scale+':'+$sidebar+':'+$script:codexAppearance.surface
        if($signature -cne $script:dockProbeSignature){$script:dockProbeSignature=$signature;$script:dockProbe=$null;$script:dockClearance=@{clear=0;inset=200;confirmed=$false};$script:dockProbeStarted=$now}
        $probeKey=$signature+':'+$hostFrame.Client.x+':'+$hostFrame.Client.y+':'+$g.cardWidth
        if($now -ge $script:nextDockProbe){
            $script:nextDockProbe=$now+1
            $x=[int]($hostFrame.Client.x+$hostFrame.Client.w-($g.cardWidth+14)*$scale)
            $background=[Convert]::ToInt32($script:codexAppearance.surface.Substring(1),16)
            [UsageScripts.DockOccupancy]::Request($probeKey,$hostFrame.Hwnd,$x,$hostFrame.Client,$scale,$background)
        }
        $sample=[UsageScripts.DockOccupancy]::Current
        if($sample -and $sample.Key -ceq $probeKey -and $now-$sample.Stamp -lt 2 -and $sample.Stamp -ne $script:lastDockProbeStamp){
            $script:lastDockProbeStamp=$sample.Stamp
            if($sample.Known -or -not $script:dockProbe){$script:dockProbe=$sample}
            $script:dockClearance=Resolve-DockClearance $script:dockClearance $sample $scale
        }
        # 일시적 툴팁/팝업 때문에 직전 정상 레이아웃을 버리지 않는다.
        # 창 크기·배율·테마가 바뀌면 위 signature 경로에서 관찰 상태를 초기화한다.
        $g.bottomInset=$script:dockClearance.inset;$g.maxBodyHeight=$g.h-$g.bottomInset-112
        if($script:dockClearance.full){
            # 우측 패널이 여백을 차지하면 사라지는 대신 접힌 요약을 남긴다.
            $g.compact=$true;$g.cardWidth=224;$g.bottomInset=16;$g.maxBodyHeight=$g.h-128
        }
        if($g.maxBodyHeight -lt 120){$script:dockGeometry=$null}
    }
    # 설정창으로 포커스가 옮겨져도 같은 호스트 경계의 마지막 정상 배치를 유지한다.
    $probeContext=[string]$hostFrame.Hwnd+':'+$hostFrame.Client.w+':'+$hostFrame.Client.h+':'+$scale+':'+$sidebar+':'+$script:codexAppearance.surface
    $contextKnown=$script:dockTestHost -or $probeContext -ceq $script:dockProbeSignature
    if($docked -and $script:dockGeometry -and -not $hostForeground -and $contextKnown -and $script:dockClearance.confirmed){
        $g=$script:dockGeometry;$g.bottomInset=$script:dockClearance.inset;$g.maxBodyHeight=$g.h-$g.bottomInset-112
        if($script:dockClearance.full){$g.compact=$true;$g.cardWidth=224;$g.bottomInset=16;$g.maxBodyHeight=$g.h-128}
        if($g.maxBodyHeight -lt 120){$script:dockGeometry=$null}
    }
    if($script:dockGeometry -and $hostFrame.Caret -and (-not $script:dockProbe -or -not $script:dockProbe.Known)){
        $caretTop=$hostFrame.Caret.y/$scale-32
        $safeBottom=[Math]::Min($script:dockGeometry.y+$script:dockGeometry.h-$script:dockGeometry.bottomInset,$caretTop)
        $script:dockGeometry.bottomInset=$script:dockGeometry.y+$script:dockGeometry.h-$safeBottom
        $script:dockGeometry.maxBodyHeight=$safeBottom-$script:dockGeometry.y-112
        if($script:dockGeometry.maxBodyHeight -lt 120){$script:dockGeometry=$null}
    }
    $layoutKind=[string]$hostFrame.Hwnd+':'+[bool]$script:dockGeometry.compact+':'+[bool]$script:dockClearance.full
    if($layoutKind -cne $script:dockLayoutKind){$script:dockLayoutKind=$layoutKind;$script:dockCompactExpanded=$false}
    $initialKnown=$script:dockTestHost -or $script:dockProbe.Known -or ($script:dockProbeStarted -gt 0 -and $now-$script:dockProbeStarted -ge 2)
    $rawReady=$docked -and $script:alive -and $hostFrame.Visible -and [bool]$script:dockGeometry -and $initialKnown -and $contextKnown -and -not $script:dockClearance.pending -and ($script:dockTestHost -or [UsageScripts.AppDock]::IsSettled)
    # 다른 앱이나 트레이 팝업이 전면이어도 창 전체를 숨기지 않는다.
    # Codex 소유·비최상위 창의 Z 순서로 덮인 부분만 자연스럽게 가려진다.
    $entering=$docked -and -not $script:mainCard.docked
    $signature=[string]$hostFrame.Hwnd+':'+($hostFrame.Client|ConvertTo-Json -Compress)+':'+$script:dockGeometry.cardWidth+':'+$script:dockGeometry.compact+':'+$script:dockGeometry.bottomInset
    if(-not $rawReady){$script:dockStableSignature='';$script:dockStableAfter=$now+0.18}
    elseif($signature -cne $script:dockStableSignature){$script:dockStableSignature=$signature;$script:dockStableAfter=$now+0.18}
    $script:dockReady=$rawReady -and ($script:dockTestHost -or $now -ge $script:dockStableAfter)
    $script:dockPendingShow=$rawReady -and -not $script:dockReady
    $script:dockHost=$hostFrame
    foreach($card in @($script:mainCard,$script:resetCard,$script:creditCard)) {
        $w=$card.window
        if($card.docked -ne $docked) {
            $w.Opacity=0;$w.Hide();$card.unmask=$true
            $card.docked=$docked;$card.key=$null;$card.forceWidth=$null
            $w.BeginAnimation([Windows.Window]::LeftProperty,$null);$w.BeginAnimation([Windows.Window]::TopProperty,$null)
            $w.Topmost=-not $docked
            $existing=(New-Object Windows.Interop.WindowInteropHelper($w)).Handle
            if($existing -ne [IntPtr]::Zero){[UsageScripts.WindowChrome]::SetNoActivate($existing,$docked)}
            if($w.Tag -and $w.Tag.GetType().FullName -eq 'UsageScripts.WindowSignals'){$w.Tag.NoActivate=$docked}
            $card.border.CornerRadius=if($docked){12}else{30}
            $card.border.Margin=if($docked){'4,16,4,4'}else{'10,16,10,4'}
            $card.border.Effect=if($docked){$null}else{$card.shadow}
            if(-not $docked){$card.border.BorderBrush=Brush '#ffffff' (48/255);$card.border.Child=$card.stack;$card.border.Padding='15,7';$card.dashboardKey=$null}
        }
        $owner=if($docked -and $hostFrame.Hwnd){[IntPtr]$hostFrame.Hwnd}else{[IntPtr]::Zero}
        $interop=New-Object Windows.Interop.WindowInteropHelper($w)
        if($interop.Owner -ne $owner){$interop.Owner=$owner}
    }
}
function Resolve-DockClearance($State,$Probe,[double]$Scale) {
    if(-not $State){$State=@{clear=0;inset=200;confirmed=$false}}
    # 우측 패널 전체를 입력창 높이로 저장하면, 패널을 닫는 첫 프레임에 본체가 위로 튄다.
    # 접힌 배치는 별도 상태로 보관하고, 닫힘 후 같은 관찰이 두 번 확인되어야 한 번에 복원한다.
    if($Probe.Known -and $Probe.Full){
        $State.full=$true;$State.pending=$false;$State.candidateCount=0
        $State.clear=0;$State.inset=16;$State.confirmed=$true
        return $State
    }
    if($State.full){
        if(-not $Probe.Known){$State.candidateCount=0;return $State}
        $State.pending=$true
        $inset=if($Probe.Blocked){[Math]::Max(16,$Probe.Inset/$Scale+12)}else{16}
        if($State.candidateCount -gt 0 -and [Math]::Abs($State.candidateInset-$inset) -lt 4){$State.candidateCount++}
        else{$State.candidateInset=$inset;$State.candidateCount=1}
        if($State.candidateCount -lt 2){return $State}
        $State.full=$false;$State.pending=$false;$State.inset=$inset;$State.clear=0
        return $State
    }
    # 툴팁 등으로 잠깐 가려진 관찰은 마지막 배치를 유지한다. 호스트 경계 변경 시에는 별도로 초기화한다.
    if(-not $Probe.Known){$State.clear=0}
    elseif($Probe.Blocked){$State.clear=0;$State.inset=[Math]::Max(16,$Probe.Inset/$Scale+12);$State.confirmed=$true}
    else{$State.clear++;if(-not $State.confirmed -or $State.clear -ge 2){$State.inset=16;$State.confirmed=$true}}
    return $State
}
function Test-DockSessionWork {
    # 접힘·백그라운드에서는 마지막 통계를 유지한다. 다시 펼쳐 보일 때 다음 틱부터 읽는다.
    $visible=$script:alive -and $script:config.placement -eq 'dock' -and $script:dockReady -and
        $script:mainCard.window.IsVisible -and -not $script:mainCard.dashboardCollapsed -and
        ($script:config.sessionTokens -or $script:config.sessionCache -or $script:config.sessionCost -or $script:config.sessionSpeed)
    if(-not $visible){return $false}
    if($script:dockHost -and -not $script:dockTestHost){return [UsageScripts.AppDock]::IsForeground($script:dockHost.Hwnd)}
    return $true
}
function Fill-DockCard($Card,[string[]]$Lines,[bool]$Visible) {
    if($Card.kind -eq 'main'){Fill-Dashboard $Card $Lines $Visible}else{$Card.window.Hide()}
}
function Position-Dock {
    if(-not $script:dockReady){return}
    $g=$script:dockGeometry;$bottom=$g.y+$g.h-$g.bottomInset
    # 본체를 하단에, 알림은 위로 쌓는다. 투명 외곽 여백을 제외하고 8 DIP 간격을 둔다.
    foreach($card in @($script:mainCard,$script:creditCard,$script:resetCard)){
        if(-not $card.window.IsVisible){continue}
        $h=$card.border.ActualHeight
        $top=$bottom-$h
        if($top -lt $g.y+80){$card.window.Hide();continue}
        Move-Card $card ($g.x+$g.w-$card.window.Width-8) ($top-$card.border.Margin.Top) $false
        $bottom=$top-8
    }
}
function Update-Dock {
    $wasReady=$script:dockReady;$old=$script:dockGeometry;$themeKey=$script:appearanceKey
    # 이동 중에는 숨기고, 조작이 끝난 뒤 안정된 경계에서만 다시 표시한다.
    $now=Now;$revision=[UsageScripts.AppDock]::Revision
    if(-not $script:dockTestHost -and $revision -eq $script:lastDockRevision -and $now -lt $script:nextDockCheck){return}
    $script:lastDockRevision=$revision;$script:nextDockCheck=$now+0.5
    if(-not $script:dockTestHost -and -not [UsageScripts.AppDock]::IsSettled){
        $script:dockReady=$false;$script:dockStableSignature='';$script:dockStableAfter=$now+0.18
        foreach($card in @($script:mainCard,$script:resetCard,$script:creditCard)){if($card.window.IsVisible){$card.window.Hide()}}
        return
    }
    Sync-DockSurface
    if(-not $script:dockReady){
        foreach($card in @($script:mainCard,$script:resetCard,$script:creditCard)){$card.window.Hide()}
        if($script:dockPendingShow){$script:nextDockCheck=$now+0.25}
        elseif([UsageScripts.AppDock]::IsForeground($script:dockHost.Hwnd)){$script:nextDockCheck=$now+0.25}
        return
    }
    # 복원/폭 변경에만 텍스트를 다시 배치한다. 단순 창 이동은 좌표만 갱신한다.
    if(-not $wasReady -or $old.cardWidth -ne $script:dockGeometry.cardWidth -or $old.compact -ne $script:dockGeometry.compact -or $old.maxBodyHeight -ne $script:dockGeometry.maxBodyHeight -or $themeKey -cne $script:appearanceKey){Render}else{Position-Dock}
}
