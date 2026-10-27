function Update-VisibleSession([double]$Now) {
    if(-not (Test-DockSessionWork)){return}
    $sessionHome=if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}
    $pin=[Guid]::Empty;$pinned=[Guid]::TryParse([string]$script:config.sessionThreadId,[ref]$pin)
    $script:sessionFollowing=-not $pinned
    if(-not $pinned){
        if($Now -ge $script:nextVisibleSession){
            $script:visibleSession.Refresh($env:LOCALAPPDATA,[int][UsageScripts.AppDock]::WatchedProcess)
            $script:nextVisibleSession=$Now+1
        }
        $script:sessionExpectedThread=$script:visibleSession.Thread
        # 모호하거나 원격인 화면에 다른 대화의 통계를 대신 보여주지 않는다.
        if(-not $script:sessionExpectedThread){return}
    }else{$script:sessionExpectedThread=$pin.ToString('D')}
    if(-not $script:sessionReader.Busy -and ($Now -ge $script:nextSession -or $script:sessionReader.Current.Thread -cne $script:sessionExpectedThread)){
        $script:sessionReader.Refresh($sessionHome,$script:sessionExpectedThread,'');$script:nextSession=$Now+5
    }
}
function Get-DashboardSnapshot {
    if($script:sessionFixture){return $script:sessionFixture}
    $snapshot=if($script:sessionReader){$script:sessionReader.Current}else{$null}
    if($script:sessionFollowing -and (-not $script:sessionExpectedThread -or $snapshot.Thread -cne $script:sessionExpectedThread)){return $null}
    return $snapshot
}
