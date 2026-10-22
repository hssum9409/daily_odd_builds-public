param(
    [switch]$Once, [switch]$Settings, [switch]$Stop, [switch]$Toggle,
    [switch]$RegisterStartup, [switch]$RemoveStartup,
    [int]$SmokeSeconds = 0, [string]$ReportPath = '', [string]$FixturePath = '', [switch]$SelfTest, [switch]$ForceIdle, [int]$MeasureAfterSeconds = 0,
    [string]$TracePath = $env:CODEX_USAGE_SCRIPTS_TRACE
)
$ErrorActionPreference = 'Stop'
if ($Once) { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) }
$root = Split-Path $PSScriptRoot -Parent
. "$PSScriptRoot\Core.ps1"
$defaults = Get-Content -LiteralPath "$root\defaults.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$uiSpec = Get-Content -LiteralPath "$root\ui.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$allWords = Get-Content -LiteralPath "$root\strings.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$receipt=try {Get-Content -LiteralPath (Join-Path $root 'installed.json') -Raw -Encoding UTF8|ConvertFrom-Json} catch {$null}
$profile = if ($env:CODEX_USAGE_SCRIPTS_HOME) { $env:CODEX_USAGE_SCRIPTS_HOME } elseif ($receipt.product -eq 'CodexUsageMonitorScripts' -and $receipt.profile) { [string]$receipt.profile } else { Join-Path $env:LOCALAPPDATA 'DailyOddBuilds\CodexUsageMonitorScripts' }
$null = New-Item -ItemType Directory -Path $profile -Force
$settingsFile = Join-Path $profile 'settings.json'; $stateFile = Join-Path $profile 'notices.json'; $commandFolder = Join-Path $profile 'commands'
$null=New-Item -ItemType Directory -Path $commandFolder -Force
function Read-Json([string]$Path) { try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null } }
function Write-Json([string]$Path, $Value) {
    $temp = $Path + '.' + $PID + '.tmp'
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 15), (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($Path)) { $backup=$Path+'.bak';[IO.File]::Replace($temp,$Path,$backup);[IO.File]::Delete($backup) } else { [IO.File]::Move($temp,$Path) }
}
$config = Get-Normalized (Read-Json $settingsFile) $defaults
$words = $allWords.($config.language)
function Save-Config { Write-Json $settingsFile $script:config }
function T([string]$Key) { return [string]$script:words.$Key }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; $runName = 'CodexUsageMonitorScripts'
if($env:CODEX_USAGE_SCRIPTS_REGISTRY_NAMESPACE){
    if($env:CODEX_USAGE_SCRIPTS_REGISTRY_NAMESPACE -notmatch '^CodexUsageMonitorScripts-QA-[a-f0-9]{6,32}$'){throw 'Invalid QA registry namespace.'}
    $runName=$env:CODEX_USAGE_SCRIPTS_REGISTRY_NAMESPACE
}
function Set-Startup([bool]$Enabled) {
    if ($Enabled) {
        $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $value = '"' + $exe + '" -NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Launch.ps1') + '"'
        if (-not (Test-Path $runKey)) {$null = New-Item -Path $runKey}
        $null = New-ItemProperty -Path $runKey -Name $runName -Value $value -PropertyType String -Force
    } else { Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue }
}
if ($RegisterStartup -or $RemoveStartup) { Set-Startup ([bool]$RegisterStartup); exit 0 }
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($profile).ToLowerInvariant()))
$mutex = New-Object Threading.Mutex($false, ('Local\CodexUsageScripts-' + ([BitConverter]::ToString($hash).Replace('-','').Substring(0,16))))
$owns = $false
try { $owns = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owns = $true }
if (-not $owns) {
    if ($Once) { Write-Error 'Monitor already running. Use refresh.cmd or stop.cmd first.'; exit 2 }
    $command = if ($Stop) { 'stop' } elseif ($Toggle) { 'toggle' } elseif ($Settings) { 'settings' } else { 'refresh' }
    # PS 5.1의 경로 길이 제한을 고려해 GUID의 불필요한 구분자를 생략한다.
    $id=[Guid]::NewGuid().ToString('N');Write-Json (Join-Path $commandFolder ($id+'.json')) @{command=$command;id=$id}
    $mutex.Dispose(); exit 0
}
if ($Stop -or $Toggle) { $mutex.ReleaseMutex(); $mutex.Dispose(); exit 0 }
if (-not $Once) {Write-Json (Join-Path $profile 'instance.json') @{pid=$PID;version=$defaults.version}}
if (-not $Once) {
    . (Join-Path $PSScriptRoot 'Launch.ps1') -LoadOnly
    Disconnect-MonitorConsole
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Web.Extensions,WindowsBase
Add-Type -Path "$PSScriptRoot\Native.cs" -ReferencedAssemblies @('System.dll','System.Core.dll',[Web.Script.Serialization.JavaScriptSerializer].Assembly.Location,[Windows.Automation.AutomationElement].Assembly.Location,[Windows.Automation.ControlType].Assembly.Location,[Windows.Rect].Assembly.Location)
[UsageScripts.TaskbarIdentity]::InitializeProcess()
$rpc = $null; $feed = New-Object UsageScripts.Feed
$data = $null; $lastData = 0.0; $announcement = $null; $lastFeed = 0.0; $nextFeed = 0.0; $nextUsage = 0.0; $nextScan = 0.0; $nextPresence = 0.0
$alive = $false; $mode = 'idle'; $life = @{missingSince=$null}; $creditState = @{previous=$null;consuming=$false;cycle=''}
$noticeState = Read-Json $stateFile; $lastKey = if ($noticeState) { $noticeState.lastKey } else { '' }
$dismissedResetKey = if ($noticeState) { [string]$noticeState.dismissedKey } else { '' }
$feedCacheFile=Join-Path $profile 'feed-cache.json';$feedDiagnosticFile=Join-Path $profile 'feed-diagnostic.json'
$feedValidated=$false;$feedError=$null;$feedHttpStatus=0;$feedReason='inactive';$layoutFallback=$false;$feedRecoveryPending=$false
$updateProcess=$null;$nextUpdate=0.0
$resetVisible = $false; $creditVisible = $false; $quit = $false; $uiLoaded = $false; $settingsWindow = $null; $tray = $null
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
$loopCpu=0.0
$report = [ordered]@{version=$defaults.version;runtime=$PSVersionTable.PSVersion.ToString();passed=$false;settingsOpened=$false;usageRead=$false;petDetected=$false;feedRead=$false;ownedServerStopped=$false}
function Now { return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0 }
function Save-FeedCache {
    try {Write-Json $script:feedCacheFile @{version=1;checkedAt=$script:lastFeed;etag=$script:feed.ETag;announcement=$script:announcement}}
    catch {$script:feedError='cache-write'} # 저장 실패가 화면 복원을 막지 않게 한다.
}
function Initialize-FeedCache {
    $cache=Get-FeedCache (Read-Json $script:feedCacheFile) (Now)
    if($cache){$script:announcement=$cache.announcement;$script:lastFeed=$cache.checkedAt;$script:feed.ETag=$cache.etag;$script:feedValidated=$true}
    elseif(Test-Path -LiteralPath $script:feedCacheFile){$script:feedError='cache-read'}
}
function Write-FeedDiagnostic {
    try {
        $state=[ordered]@{httpStatus=$script:feedHttpStatus;error=$script:feedError;checkedAt=$script:lastFeed;nextRetryAt=$script:nextFeed;reason=$script:feedReason;mode=$script:mode;layoutFallback=$script:layoutFallback;hasAnnouncement=[bool]$script:announcement}
        $signature=$state|ConvertTo-Json -Compress
        if($signature -eq $script:lastFeedDiagnostic){return}
        $script:lastFeedDiagnostic=$signature;$state.recordedAt=Now;Write-Json $script:feedDiagnosticFile $state
    } catch { } # 계정 응답·토큰·원문을 기록하지 않는다.
}
function Receive-Feed([double]$Now) {
    if($script:feed.Busy){return}
    $status=$script:feed.Status
    if($status){$script:feedHttpStatus=$status}
    if($script:feed.Result){
        try {
            $value=Get-FeedValue ($script:feed.Result|ConvertFrom-Json) $Now $script:announcement
            $script:announcement=$value;$script:lastFeed=$Now;$script:feed.ETag=$script:feed.ResponseETag
            $script:feedValidated=$true;$script:feedRecoveryPending=$false;$script:feedError=$null;$script:report.feedRead=$true;Save-FeedCache
        } catch {$script:feedError='parse';$script:feed.ETag=''}
        $script:feed.Result=$null
    } elseif($status -eq 304){
        if($script:feedValidated){$script:lastFeed=$Now;$script:feedError=$null;Save-FeedCache}
        else {$script:feed.ETag='';$script:nextFeed=if($script:feedRecoveryPending){$Now+60}else{0};$script:feedRecoveryPending=$true;$script:feedError='body-missing'}
    } elseif($status -eq 200){$script:feedError='parse';$script:feed.ETag=''}
    if($script:feed.Error){$script:feedError=$script:feed.Error;$script:nextFeed=[Math]::Max($script:nextFeed,$Now+$script:feed.RetrySeconds);$script:feed.Error=$null}
    $script:feed.Status=0
}
function Dismiss-ResetNotice {
    # 표시 이력과 사용자가 닫은 이력을 구분해야 업데이트 후에도 표시 중이던 알림을 복원할 수 있다.
    $script:resetVisible=$false;$script:dismissedResetKey=$script:lastKey
    Write-Json $script:stateFile @{lastKey=$script:lastKey;dismissedKey=$script:dismissedResetKey}
}
function Check-ScriptUpdate([bool]$Force=$false) {
    if(-not $script:alive -or $FixturePath -or ($script:updateProcess -and -not $script:updateProcess.HasExited)){return}
    $cache=Read-Json (Join-Path $profile 'updates.json')
    if(-not $Force -and $cache -and (Test-Number $cache.nextCheck) -and $cache.nextCheck -gt (Now) -and $cache.nextCheck -le (Now)+86400){$script:nextUpdate=$cache.nextCheck;return}
    $script:nextUpdate=(Now)+21600
    $parameters=@('-TargetRoot',$root,'-Profile',$profile)
    if($Force){$parameters+='-Force'}
    $script:updateProcess=Start-BackgroundPowerShell (Join-Path $root 'windows\Update.ps1') $parameters
}
function Stop-UpdateCheck {
    if($script:updateProcess -and -not $script:updateProcess.HasExited){
        $state=Read-Json (Join-Path $profile 'updates.json')
        # 파일 교체 도우미가 정상 종료를 요청한 경우에는 도우미를 계속 실행한다.
        if($state.status -notin @('applying','installed')){Stop-Process -Id $script:updateProcess.Id -ErrorAction SilentlyContinue}
    }
}
function Write-Diagnostic {
    # 실사용 QA에서만 켜는 상태 기록. 계정 응답·인증·창 제목은 저장하지 않는다.
    if (-not $TracePath) { return }
    try {
        $frame=[UsageScripts.Desktop]::MovedFrame()
        $main=if ($script:uiLoaded) {$script:mainCard.window} else {$null}
        $state=[ordered]@{alive=$script:alive;mode=$script:mode;preferred=$script:config.placement;pet=$frame.Pet;blockers=$frame.Blockers;pointerDown=[UsageScripts.Desktop]::PointerDown;visible=[bool]($main -and $main.IsVisible);left=$null;top=$null;height=$null;rpcPid=0;settingsVisible=[bool]($script:settingsWindow -and $script:settingsWindow.IsVisible);error=$script:lastError}
        if ($main) {
            if (Test-Finite $main.Left) {$state.left=$main.Left}
            if (Test-Finite $main.Top) {$state.top=$main.Top}
            $state.height=$main.ActualHeight
        }
        if ($script:rpc) {$state.rpcPid=$script:rpc.OwnedPid}
        $key=$state|ConvertTo-Json -Depth 6 -Compress
        if ($key -eq $script:lastTrace) {return}
        $script:lastTrace=$key
        $state.time=[DateTimeOffset]::UtcNow.ToString('o');$state.pid=$PID
        [IO.File]::AppendAllText($TracePath,($state|ConvertTo-Json -Depth 6 -Compress)+[Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
    } catch { } # 진단 파일의 오류로 모니터 동작을 중단하지 않는다.
}
function Start-Rpc {
    $path = $script:config.codexPath
    if (-not $path) { $path = [UsageScripts.Desktop]::FindCodex() }
    if (-not $path -or -not [IO.File]::Exists($path) -or [IO.Path]::GetExtension($path) -ne '.exe') { throw (T 'error') }
    $script:rpc = New-Object UsageScripts.Rpc($path)
    $script:rpc.ClientVersion=$defaults.version
}
function Local-Date($At) {
    if (-not (Test-Finite $At)) { return '—' }
    $time = [DateTimeOffset]::FromUnixTimeSeconds([long]$At)
    $ids = @{'UTC'='UTC';'Asia/Seoul'='Korea Standard Time';'Asia/Tokyo'='Tokyo Standard Time';'Asia/Shanghai'='China Standard Time';'America/Los_Angeles'='Pacific Standard Time';'America/New_York'='Eastern Standard Time';'Europe/London'='GMT Standard Time';'Europe/Berlin'='W. Europe Standard Time'}
    $labels = @{'Asia/Seoul'='KST';'Asia/Tokyo'='JST';'Asia/Shanghai'='CST'}
    $zone = if ($script:config.timezone -eq 'system') { [TimeZoneInfo]::Local } else { [TimeZoneInfo]::FindSystemTimeZoneById($ids[$script:config.timezone]) }
    $local = [TimeZoneInfo]::ConvertTime($time,$zone)
    $label = if ($labels.ContainsKey($script:config.timezone)) { $labels[$script:config.timezone] } else { 'UTC' + $local.ToString('zzz') }
    return $local.ToString('yyyy-MM-dd HH:mm') + ' ' + $label
}
function Play-Notice([string]$Kind) {
    if ($script:config.placement -eq 'hidden') { return }
    if (($Kind -eq 'reset' -and $script:config.resetSound) -or ($Kind -eq 'credit' -and $script:config.creditSound)) { [Media.SystemSounds]::Exclamation.Play() }
}
function Brush([string]$Color, [double]$Opacity=1) {
    $b = New-Object Windows.Media.SolidColorBrush([Windows.Media.ColorConverter]::ConvertFromString($Color)); $b.Opacity=$Opacity; return $b
}
function Label([string]$Text, [double]$Size=14) {
    $v=New-Object Windows.Controls.TextBlock; $v.Text=$Text; $v.FontSize=$Size; $v.TextWrapping='Wrap'; $v.Margin=0; $v.FontFamily=New-Object Windows.Media.FontFamily(@{ko='Malgun Gothic';en='Segoe UI';zh='Microsoft YaHei';ja='Meiryo'}[$script:config.language]); return $v
}
function Button([string]$Text, [scriptblock]$Action) {
    $v=New-Object Windows.Controls.Button; $v.Content=$Text; $v.Padding='10,5'; $v.Margin='3'; $v.Add_Click($Action); return $v
}
function Card([string]$Kind) {
    $w=New-Object Windows.Window; $w.Title="Codex Usage Monitor Scripts - $Kind"; $w.WindowStyle='None'; $w.AllowsTransparency=$true; $w.Background=[Windows.Media.Brushes]::Transparent
    $w.Topmost=$true; $w.ShowActivated=$false; $w.ShowInTaskbar=$false; $w.ResizeMode='NoResize'; $w.SizeToContent='Height'; $w.Width=350
    # HWND가 만들어지는 즉시 적용하여 첫 표시부터 Alt+Tab에 패널이 섞이지 않게 한다.
    $w.Add_SourceInitialized({
        param($sender,$eventArgs)
        $handle=(New-Object Windows.Interop.WindowInteropHelper($sender)).Handle
        [UsageScripts.WindowChrome]::HideFromSwitcher($handle)
    })
    $w.FontFamily=New-Object Windows.Media.FontFamily(@{ko='Malgun Gothic';en='Segoe UI';zh='Microsoft YaHei';ja='Meiryo'}[$script:config.language])
    $outer=New-Object Windows.Controls.Grid; $outer.Margin=0
    $w.Resources=[Windows.Markup.XamlReader]::Parse([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Theme.xaml')))
    $border=New-Object Windows.Controls.Border; $border.CornerRadius=30; $border.Margin='10,16,10,4'; $border.BorderThickness=1; $border.Padding='15,7'; $border.BorderBrush=(Brush '#FFFFFF' (48/255))
    $shadow=New-Object Windows.Media.Effects.DropShadowEffect; $shadow.BlurRadius=4; $shadow.ShadowDepth=3; $shadow.Opacity=24/255; $border.Effect=$shadow
    $stack=New-Object Windows.Controls.Canvas; $stack.HorizontalAlignment='Left'; $border.Child=$stack; $null=$outer.Children.Add($border)
    # Pet 기본 작업 패널의 56 DIP를 본체 최소 높이로 사용한다.
    # 창의 투명 여백 20 DIP는 별도이며, 적은 내용은 위아래 중앙에 놓는다.
    if ($Kind -eq 'main') {$border.MinHeight=[double]$script:uiSpec.panel.mainMinHeight;$stack.VerticalAlignment='Center'}
    $controls=New-Object Windows.Controls.Grid; $controls.VerticalAlignment='Top'; $controls.Margin='2,4,2,0'; $controls.Visibility='Collapsed'
    $close=Button '×' { }
    $close.Style=$w.Resources['HoverPill'];$close.HorizontalAlignment='Left'
    if ($Kind -eq 'main') { $close.Add_Click({$script:config.placement='hidden'; Save-Config; Render}) } elseif ($Kind -eq 'reset') { $close.Add_Click({Dismiss-ResetNotice; Render}) } else { $close.Add_Click({$script:creditVisible=$false; Render}) }
    $null=$controls.Children.Add($close)
    if ($Kind -eq 'main') { $more=Button '···' {Show-Settings};$more.Style=$w.Resources['HoverPill'];$more.HorizontalAlignment='Left';$more.Margin='27,0,0,0';$null=$controls.Children.Add($more) }
    if ($Kind -eq 'reset') { $arrow=Button '→' {if ($script:announcement.url) { Start-Process $script:announcement.url }};$arrow.Style=$w.Resources['HoverPill'];$arrow.HorizontalAlignment='Right';$null=$controls.Children.Add($arrow) }
    $null=$outer.Children.Add($controls); $w.Content=$outer
    $w.Add_MouseEnter({$this.Content.Children[1].Visibility='Visible'})
    $w.Add_MouseLeave({$this.Content.Children[1].Visibility='Collapsed'})
    if ($Kind -eq 'main') {
        $w.Add_MouseLeftButtonDown({
            if ($script:mode -eq 'free' -and $_.OriginalSource -isnot [Windows.Controls.Button]) {
                $this.BeginAnimation([Windows.Window]::LeftProperty,$null); $this.BeginAnimation([Windows.Window]::TopProperty,$null)
                $this.DragMove(); $script:config.x=$this.Left; $script:config.y=$this.Top; Save-Config
            }
        })
    }
    return @{window=$w;border=$border;stack=$stack;kind=$Kind;close=$close}
}
function Load-UI {
    if ($script:uiLoaded) { return }
    Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Windows.Forms,System.Drawing
    $script:mainCard=Card 'main'; $script:resetCard=Card 'reset'; $script:creditCard=Card 'credit'; $script:uiLoaded=$true
    Sync-Tray
}
function Close-Tray {
    if (-not $script:tray) {return}
    # 아이콘을 숨길 때 알림 영역 등록과 메뉴·아이콘 리소스도 함께 해제한다.
    $menu=$script:tray.ContextMenuStrip;$icon=$script:tray.Icon
    $script:tray.Visible=$false;$script:tray.Dispose();$script:tray=$null
    if ($menu) {$menu.Dispose()};if ($icon) {$icon.Dispose()}
    $script:toggleItem=$null;$script:startupItem=$null
}
function Sync-Tray {
    if (-not $script:config.trayIcon) {Close-Tray;return}
    if ($script:tray) {return}
    $script:tray=New-Object Windows.Forms.NotifyIcon; $script:tray.Icon=New-Object Drawing.Icon((Join-Path $root 'assets\gp-chan.ico')); $script:tray.Text='Codex Usage Monitor'; $script:tray.Visible=$true
    $menu=New-Object Windows.Forms.ContextMenuStrip
    $item=$menu.Items.Add((T 'settings')); $item.Add_Click({Show-Settings})
    $script:toggleItem=$menu.Items.Add('Monitor OFF'); $script:toggleItem.Add_Click({ Toggle-Monitor })
    $item=$menu.Items.Add((T 'refresh')); $item.Add_Click({$script:nextUsage=0; $script:nextFeed=0})
    $script:startupItem=$menu.Items.Add((T 'startup_register')); $script:startupItem.Add_Click({Set-Startup $true})
    $item=$menu.Items.Add((T 'quit')); $item.Add_Click({$script:quit=$true})
    $menu.Add_Opening({$script:toggleItem.Text=if ($script:config.placement -eq 'hidden') {T 'monitorOn'} else {T 'monitorOff'}; $script:startupItem.Visible=-not (Get-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue)})
    $script:tray.ContextMenuStrip=$menu; $script:tray.Add_DoubleClick({Show-Settings})
}
function Toggle-Monitor {
    if ($script:config.placement -eq 'hidden') { $script:config.placement=$script:config.attachedPlacement } else { $script:config.placement='hidden' }
    Save-Config; Render
}
function Ticket-Tooltip($View) {
    $tip=New-Object Windows.Controls.ToolTip;$tip.Placement='Left';$tip.Background=Brush $script:config.styles.main.color $script:config.styles.main.opacity;$tip.Foreground=Brush $script:config.styles.main.text;$tip.Padding=12
    $stack=New-Object Windows.Controls.StackPanel;$i=1
    foreach ($ticket in $View.tickets.rows) {
        $big=Label ("$i : "+(Get-Duration $ticket.expiresAt (Now) $false)+' '+(T 'expires')) 15;$big.FontWeight='SemiBold';$null=$stack.Children.Add($big)
        $small=Label (Local-Date $ticket.expiresAt) 11;$small.Opacity=0.7;$null=$stack.Children.Add($small);$i++
    }
    if (-not $View.tickets.rows.Count) {$null=$stack.Children.Add((Label (T 'noData') 13))}
    $tip.Content=$stack;return $tip
}
function Measure-Text([string]$Text,[double]$Size=9.5) {
    $font=New-Object Windows.Media.FontFamily(@{ko='Malgun Gothic';en='Segoe UI';zh='Microsoft YaHei';ja='Meiryo'}[$script:config.language])
    $face=New-Object Windows.Media.Typeface($font,[Windows.FontStyles]::Normal,[Windows.FontWeights]::Normal,[Windows.FontStretches]::Normal)
    return New-Object Windows.Media.FormattedText($Text,[Globalization.CultureInfo]::CurrentUICulture,[Windows.FlowDirection]::LeftToRight,$face,$Size,[Windows.Media.Brushes]::White)
}
function Reset-Footer([string]$Text,[double]$Width,[string]$Ink) {
    $viaText=T 'via';$viaWidth=(Measure-Text $viaText).WidthIncludingTrailingWhitespace
    $lines=New-Object 'Collections.Generic.List[string]';$remaining=$Text
    while ($remaining) {
        $fit=0
        for ($j=1;$j -le $remaining.Length;$j++) {if ((Measure-Text $remaining.Substring(0,$j)).WidthIncludingTrailingWhitespace -gt $Width) {break};$fit=$j}
        if ($fit -lt $remaining.Length) {$space=$remaining.Substring(0,[Math]::Max(1,$fit)).LastIndexOf(' ');if ($space -gt 0) {$fit=$space}}
        $fit=[Math]::Max(1,$fit);$lines.Add($remaining.Substring(0,$fit).Trim());$remaining=$remaining.Substring($fit).TrimStart()
    }
    $last=$lines[$lines.Count-1]
    if ((Measure-Text $last).WidthIncludingTrailingWhitespace -gt $Width-$viaWidth-12) {
        $fit=$last.Length
        while ($fit -gt 0 -and (Measure-Text $last.Substring(0,$fit)).WidthIncludingTrailingWhitespace -gt $Width-$viaWidth-12) {$fit--}
        $space=$last.Substring(0,[Math]::Max(1,$fit)).LastIndexOf(' ');if ($space -gt 0) {$fit=$space};$fit=[Math]::Max(1,$fit)
        $lines[$lines.Count-1]=$last.Substring(0,$fit).TrimEnd();$lines.Add($last.Substring($fit).TrimStart())
    }
    $canvas=New-Object Windows.Controls.Canvas;$canvas.Width=$Width
    $glyphHeight=0
    for ($i=0;$i -lt $lines.Count;$i++) {
        $label=Label $lines[$i] 9.5;$label.Foreground=Brush $Ink (240/255);$bounds=(Measure-Text $lines[$i]).BuildGeometry((New-Object Windows.Point(0,0))).Bounds
        [Windows.Controls.Canvas]::SetTop($label,($i*14-$bounds.Y));$null=$canvas.Children.Add($label);$glyphHeight=[Math]::Ceiling($bounds.Height)
    }
    $link=Label $viaText 9.5;$link.Foreground=Brush $Ink (240/255);$link.Cursor='Hand';$link.Add_MouseLeftButtonUp({Start-Process 'https://codex-resets.com/'})
    $bounds=(Measure-Text $viaText).BuildGeometry((New-Object Windows.Point(0,0))).Bounds
    [Windows.Controls.Canvas]::SetLeft($link,($Width-$viaWidth));[Windows.Controls.Canvas]::SetTop($link,(($lines.Count-1)*14-$bounds.Y));$null=$canvas.Children.Add($link)
    $canvas.Height=($lines.Count-1)*14+[Math]::Max($glyphHeight,[Math]::Ceiling($bounds.Height));return $canvas
}
function Fill-Card($Card, [string[]]$Lines, [bool]$Visible,[bool]$Offscreen=$false) {
    $w=$Card.window
    $w.FontFamily=New-Object Windows.Media.FontFamily(@{ko='Malgun Gothic';en='Segoe UI';zh='Microsoft YaHei';ja='Meiryo'}[$script:config.language])
    if (-not $Visible) { $w.Hide(); return }
    $style=$script:config.styles.($Card.kind); $Card.border.Background=Brush $style.color $style.opacity
    $ink=Get-StyleInk $style $Card.kind
    $Card.lastLines=$Lines
    $key=($Lines -join "`n")+($style|ConvertTo-Json -Compress)+$Card.forceWidth+$script:config.language
    if ($Card.key -eq $key) {if (-not $Offscreen -and -not $w.IsVisible) {$w.Show()};return}
    $Card.key=$key
    $Card.stack.Children.Clear()
    $widths=@();$rowIndex=0
    foreach ($text in $Lines) {
        $length=0.0
        foreach ($part in [regex]::Split($text,'([\(（][^\)）]*[\)）])')) {
            $subtle=$part.StartsWith('(') -or $part.StartsWith('（')
            $size=if ($rowIndex -eq 0) {if ($Card.kind -eq 'credit') {14} elseif ($subtle) {if ($Card.kind -eq 'reset') {10.5} else {11}} else {12}} elseif ($Card.kind -eq 'reset') {9.5} else {11.5}
            $weight=if ($rowIndex -eq 0 -and -not $subtle) {[Windows.FontWeights]::Bold} else {[Windows.FontWeights]::Normal}
            $face=New-Object Windows.Media.Typeface($w.FontFamily,[Windows.FontStyles]::Normal,$weight,[Windows.FontStretches]::Normal)
            $ft=New-Object Windows.Media.FormattedText($part,[Globalization.CultureInfo]::CurrentUICulture,[Windows.FlowDirection]::LeftToRight,$face,$size,[Windows.Media.Brushes]::White)
            $length+=$ft.WidthIncludingTrailingWhitespace
        }
        if ($Card.kind -ne 'reset' -or $rowIndex -eq 0) {$widths+=$length};$rowIndex++
    }
    $Card.naturalWidth=[Math]::Max(350,[Math]::Min(660,[Math]::Floor([Math]::Max(298,($widths|Measure-Object -Maximum).Maximum)+54)))
    $w.Width=if ($Card.forceWidth) {$Card.forceWidth} else {$Card.naturalWidth}
    $innerWidth=$w.Width-52;$y=0.0
    $i=0
    foreach ($line in $Lines) {
        $size=if ($i -eq 0) {if ($Card.kind -eq 'credit') {14} else {12}} elseif ($Card.kind -eq 'reset') {9.5} else {11.5}
        $label=Label $line $size; $label.Foreground=Brush $ink
        if ($i -gt 0 -and $ink -eq '#f8f8f8' -and $Card.kind -eq 'main') {$label.Foreground=Brush '#dcdcdc'}
        if ($i -gt 0 -and $Card.kind -eq 'reset') {$label.Foreground=Brush '#4c3e21' (240/255)}
        if ($i -eq 0) {
            $label.FontWeight='Bold';$label.TextWrapping='NoWrap';$label.TextTrimming='CharacterEllipsis'
            if ($Card.kind -in @('main','reset')) {
                $label.Text=''
                foreach ($part in [regex]::Split($line,'([\(（][^\)）]*[\)）])')) {
                    $run=New-Object Windows.Documents.Run($part)
                    if ($part.StartsWith('(') -or $part.StartsWith('（')) {$run.FontSize=if ($Card.kind -eq 'reset') {10.5} else {11};$run.FontWeight='Normal';$run.Foreground=if ($Card.kind -eq 'reset') {Brush '#696969' (240/255)} else {Brush '#b9b9b9' (220/255)}}
                    $null=$label.Inlines.Add($run)
                }
            }
        }
        $label.Width=$innerWidth;$label.Measure((New-Object Windows.Size($innerWidth,[double]::PositiveInfinity)))
        $height=$label.DesiredSize.Height
        $face=New-Object Windows.Media.Typeface($label.FontFamily,[Windows.FontStyles]::Normal,$label.FontWeight,[Windows.FontStretches]::Normal)
        $ft=New-Object Windows.Media.FormattedText($line,[Globalization.CultureInfo]::CurrentUICulture,[Windows.FlowDirection]::LeftToRight,$face,$size,[Windows.Media.Brushes]::White)
        $bounds=$ft.BuildGeometry((New-Object Windows.Point(0,0))).Bounds
        $glyphTop=$bounds.Y
        if ($Card.kind -ne 'reset' -or $i -eq 0) {$height=[Math]::Ceiling($bounds.Height)}
        if ($Card.kind -eq 'reset' -and $i -eq 1) {
            $footer=Reset-Footer $line $innerWidth $ink;$height=$footer.Height;[Windows.Controls.Canvas]::SetTop($footer,$y);$null=$Card.stack.Children.Add($footer)
        } else {[Windows.Controls.Canvas]::SetTop($label,($y-$glyphTop));$null=$Card.stack.Children.Add($label)}
        $y+=if ($i -lt $Lines.Count-1) {if ($Card.kind -eq 'reset') {18} elseif ($Card.kind -eq 'credit') {22} else {18}} else {$height};$i++
    }
    $Card.stack.Width=$innerWidth;$Card.stack.Height=$y
    if ($Offscreen) {$w.Content.Measure((New-Object Windows.Size($w.Width,[double]::PositiveInfinity)));$w.Content.Arrange((New-Object Windows.Rect(0,0,$w.Width,$w.Content.DesiredSize.Height)))}
    else {if (-not $w.IsVisible) { $w.Show() };$w.UpdateLayout()}
}
function Move-Card($Card, [double]$X, [double]$Y, [bool]$Animate) {
    $w=$Card.window
    $Card.targetX=$X;$Card.targetY=$Y
    if ([Math]::Abs($w.Left-$X) -lt 0.5 -and [Math]::Abs($w.Top-$Y) -lt 0.5) { return }
    if (-not $Animate -or [double]::IsNaN($w.Left)) {
        $w.BeginAnimation([Windows.Window]::LeftProperty,$null);$w.BeginAnimation([Windows.Window]::TopProperty,$null);$w.Left=$X;$w.Top=$Y;return
    }
    foreach ($axis in @(@([Windows.Window]::LeftProperty,$w.Left,$X),@([Windows.Window]::TopProperty,$w.Top,$Y))) {
        $animation=New-Object Windows.Media.Animation.DoubleAnimation; $animation.From=$axis[1];$animation.To=$axis[2];$animation.Duration=[TimeSpan]::FromMilliseconds($script:config.motionMs)
        $Card.motionDurationMs=$script:config.motionMs
        $ease=New-Object Windows.Media.Animation.CubicEase;$ease.EasingMode='EaseOut';$animation.EasingFunction=$ease
        $w.BeginAnimation($axis[0],$animation)
    }
}
function Screen-Box($Frame) {
    $point=New-Object Drawing.Point([int]$Frame.Pet.x,[int]$Frame.Pet.y)
    $work=[Windows.Forms.Screen]::FromPoint($point).WorkingArea
    $source=[Windows.PresentationSource]::FromVisual($script:mainCard.window)
    $script:scale=if ($source) {$source.CompositionTarget.TransformToDevice.M11} else {1.0}
    return @{x=$work.X/$script:scale;y=$work.Y/$script:scale;w=$work.Width/$script:scale;h=$work.Height/$script:scale}
}
function Position-Cards($Frame) {
    $main=$script:mainCard.window
    $script:layoutFallback=$false
    # 각 카드의 투명 여백을 빼고 설정한 본체 간격을 한 번만 더한다.
    $rh=if ($script:resetVisible -and $script:resetCard.window.IsVisible) {$script:resetCard.border.ActualHeight+$script:config.noticeGap} else {0}
    $ch=if ($script:creditVisible -and $script:creditCard.window.IsVisible) {$script:creditCard.border.ActualHeight+$script:config.noticeGap} else {0}
    $side=if ($script:mode -eq 'below') {'below'} else {'above'}
    if ($Frame.Pet -and $script:mode -in @('above','below')) {
        $screen=Screen-Box $Frame
        $pet=@{x=$Frame.Pet.x/$script:scale;y=$Frame.Pet.y/$script:scale;w=$Frame.Pet.w/$script:scale;h=$Frame.Pet.h/$script:scale}
        $blockers=@($Frame.Blockers | ForEach-Object {@{x=$_.x/$script:scale;y=$_.y/$script:scale;w=$_.w/$script:scale;h=$_.h/$script:scale}})
        $bodyInsets=@{top=$script:mainCard.border.Margin.Top;bottom=$script:mainCard.border.Margin.Bottom}
        $place=Get-Placement $pet $blockers $screen $main.Width ($main.ActualHeight+$rh+$ch) $script:mode $bodyInsets $script:config
        if (-not $place) {Position-Fallback $pet $blockers $screen;return}
        $side=$place.side; $mx=$place.x; $my=if ($side -eq 'above') {$place.y+$rh+$ch} else {$place.y}
        # 드래그는 즉시 따라가고 크롬/설정에 따른 높이 변화만 짧게 보간한다.
        $drag=($script:lastPetX -ne $pet.x -or $script:lastPetY -ne $pet.y)
        Move-Card $script:mainCard $mx $my (-not $drag);$script:lastPetX=$pet.x;$script:lastPetY=$pet.y
    } else {
        $work=[Windows.SystemParameters]::WorkArea
        $mx=if (Test-Finite $script:config.x) {$script:config.x} elseif (-not [double]::IsNaN($main.Left)) {$main.Left} else {$work.Right-$main.Width-18}
        $my=if (Test-Finite $script:config.y) {$script:config.y} elseif (-not [double]::IsNaN($main.Top)) {$main.Top} else {$work.Top+40}
        $screen=[Windows.Forms.Screen]::FromPoint((New-Object Drawing.Point([int]$mx,[int]$my))).WorkingArea
        if($main.ActualHeight+$rh+$ch -gt $screen.Height){Position-Fallback $null @() @{x=$screen.Left;y=$screen.Top;w=$screen.Width;h=$screen.Height};return}
        $mx=[Math]::Max($screen.Left,[Math]::Min($screen.Right-$main.Width,$mx));$my=[Math]::Max($screen.Top+$rh+$ch,[Math]::Min($screen.Bottom-$main.ActualHeight,$my))
        Move-Card $script:mainCard $mx $my $false
        if ($my-$rh-$ch -lt $screen.Top) {$side='below'}
    }
    if ($side -eq 'above') { $cy=$my-$ch; $ry=$cy-$rh } else { $ry=$my+$script:mainCard.border.ActualHeight+$script:config.noticeGap; $cy=$ry+$rh }
    Move-Card $script:resetCard $mx $ry $true; Move-Card $script:creditCard $mx $cy $true
}
function Position-Fallback($Pet,$Blockers,$Screen){
    foreach($kind in @('main','reset','credit')){
        $card=Get-Variable -Name ($kind+'Card') -ValueOnly -Scope Script
        if($card.window.IsVisible -and $card.window.Width -gt $Screen.w){$card.forceWidth=$Screen.w;Fill-Card $card $card.lastLines $true}
    }
    $sizes=@{main=@{w=$script:mainCard.window.Width;h=$script:mainCard.window.ActualHeight}}
    foreach($kind in @('reset','credit')){$card=Get-Variable -Name ($kind+'Card') -ValueOnly -Scope Script;if($card.window.IsVisible){$sizes[$kind]=@{w=$card.window.Width;h=$card.window.ActualHeight}}}
    $layout=Get-FallbackLayout $Pet $Blockers $Screen $sizes $script:mode $script:config.noticeGap
    foreach($kind in @('main','reset','credit')){if($layout[$kind]){$card=Get-Variable -Name ($kind+'Card') -ValueOnly -Scope Script;Move-Card $card $layout[$kind].x $layout[$kind].y $true}}
    $script:layoutFallback=$true
}
function Render {
    if (-not $script:uiLoaded) { return }
    $now=Now; $frame=if ($FixturePath) {$script:fixtureFrame} else {[UsageScripts.Desktop]::MovedFrame()}
    $oldMode=$script:mode;$script:mode=Get-Lifecycle $script:config $script:alive ([bool]$frame.Pet) $now $script:life
    if ($script:mode -eq 'free' -and $oldMode -in @('above','below','waiting') -and -not [double]::IsNaN($script:mainCard.window.Left)) {$script:config.x=$script:mainCard.window.Left;$script:config.y=$script:mainCard.window.Top}
    if($script:settingsWindow -and $script:settingsWindow.IsVisible){Sync-PetAvailability}
    $show=$script:mode -notin @('idle','hidden','waiting')
    $view=Get-View $script:data $script:config $now $script:words
    $lines=if ($script:lastData -eq 0) {@($(if ($script:lastError) {T 'error'} else {T 'connecting'}))} else {$view.lines}
    if ($script:lastData -and $now-$script:lastData -gt 60) {$lines+=T 'stale'}
    Fill-Card $script:mainCard $lines $show
    if ($show -and ($script:config.tickets -or $script:config.expiry) -and $script:lastData) {
        $index=if ($lines[0] -match '%|5h|Window') {1} else {0}
        if ($index -lt $script:mainCard.stack.Children.Count) {$script:mainCard.stack.Children[$index].ToolTip=Ticket-Tooltip $view}
    }
    if (-not $script:config.resetNotice) {$script:resetVisible=$false}
    if (-not $script:config.creditNotice) {$script:creditVisible=$false}
    $key=Get-ReminderKey $script:announcement $now $script:config.resetMinutes
    $legacy=Get-LegacyReminderKey $script:announcement $now $script:config.resetMinutes
    if($key -ne $legacy -and $legacy -and $script:lastKey -eq $legacy){
        if($script:dismissedResetKey -eq $legacy){$script:dismissedResetKey=$key};$script:lastKey=$key
        Write-Json $stateFile @{lastKey=$key;dismissedKey=$script:dismissedResetKey}
    }
    $activeNotice=Test-NoticeActive $script:announcement $now
    $script:feedReason=Get-NoticeReason $script:announcement $script:lastFeed $now $script:config.resetNotice $show ($key -eq $script:dismissedResetKey)
    if ($script:feedReason -eq 'visible') {
        if ($key -ne $script:lastKey) {
            if (-not $script:resetVisible) {Play-Notice 'reset'}
            $script:resetVisible=$true;$script:lastKey=$key;$script:dismissedResetKey=''
            Write-Json $stateFile @{lastKey=$key;dismissedKey=''}
        } elseif ($key -ne $script:dismissedResetKey) {
            # 같은 구간의 재실행/연결 복구는 화면만 복원한다. 이미 낸 소리는 반복하지 않는다.
            $script:resetVisible=$true
        }
    } else {$script:resetVisible=$false}
    $title=Get-NoticeTitle $script:announcement $now $script:words
    if($script:resetVisible -and ($now-$script:lastFeed -ge 1800 -or $script:feedError)){$title+=' · '+(T 'feed_delayed')}
    Fill-Card $script:resetCard @($title, (T 'reset_disclaimer')) ($show -and $script:resetVisible)
    Fill-Card $script:creditCard @((T 'credit_started'), ((T 'balance')+' '+(Format-Credit $view.balance))) ($show -and $script:creditVisible)
    $cards=@($script:mainCard,$script:resetCard,$script:creditCard)
    $sharedWidth=(@($cards | Where-Object {$_.window.IsVisible} | ForEach-Object {$_.naturalWidth}) | Measure-Object -Maximum).Maximum
    foreach ($card in $cards) {
        if ($card.window.IsVisible -and $card.forceWidth -ne $sharedWidth) {$card.forceWidth=$sharedWidth;Fill-Card $card $card.lastLines $true}
    }
    if ($show) { Position-Cards $frame }
    Write-FeedDiagnostic
}
. "$PSScriptRoot\Settings.ps1"
function Sync-ReactionTimer {
    if ($script:timer) {$script:timer.Interval=[TimeSpan]::FromMilliseconds((Get-ReactionInterval $script:config $script:alive ([UsageScripts.Desktop]::PointerDown)))}
}

try {
    if(-not $FixturePath -and -not $Once){Initialize-FeedCache}
    if ($Once) {
        Start-Rpc;$rpc.Refresh();$watch=[Diagnostics.Stopwatch]::StartNew()
        while ($rpc.Busy -and $watch.Elapsed.TotalSeconds -lt 65) {Start-Sleep -Milliseconds 50}
        if ($rpc.Busy -or $rpc.Error -or -not $rpc.Result) {throw (T 'error')}
        $data=$rpc.Result|ConvertFrom-Json;$view=Get-View $data $config (Now) $words
        @{version=$defaults.version;lines=$view.lines;planPro=$view.pro;tickets=$view.tickets.count;source='account/rateLimits/read'}|ConvertTo-Json -Depth 8
        exit 0
    }
    # 루프는 WPF Dispatcher에만 들어가며 HTTP/RPC/UIA는 별도 worker에서 처리한다.
    Add-Type -AssemblyName WindowsBase
    if ($FixturePath) {
        $fixture=Read-Json $FixturePath;if (-not $fixture) {throw 'Invalid fixture'};$data=$fixture.usage;$announcement=Get-Scheduled $fixture.feed;$lastData=Now;$lastFeed=Now;$alive=$true
        # 화면 fixture의 시각을 현재 시각으로 옮긴다. 코어 테스트의 고정 시계는 별도 유지한다.
        $offset=(Now)-2000000000.0
        foreach ($bucket in (Get-Buckets $data)) {foreach ($kind in @('primary','secondary')) {if ($bucket.$kind) {$bucket.$kind.resetsAt+=$offset}}}
        foreach ($ticket in $data.rateLimitResetCredits.credits) {$ticket.expiresAt+=$offset}
        $fixtureFrame=New-Object UsageScripts.Frame;$fixtureFrame.Alive=$true
        if ($fixture.pet) {$fixtureFrame.Pet=New-Object UsageScripts.Box($fixture.pet.x,$fixture.pet.y,$fixture.pet.w,$fixture.pet.h)}
        Load-UI;Render
    }
    if ($Settings) {Show-Settings}
    if ($SelfTest) {
        if (-not $FixturePath -or -not $ReportPath) {throw 'SelfTest requires an isolated fixture/profile and report path'}
        $checks=0
        function Assert-UI($Ok,[string]$Message) {$script:checks++;if (-not $Ok) {throw $Message}}
        Show-Settings;$script:fields.usageDisplay.SelectedValue='remaining';$script:saveButton.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
        Assert-UI ((Read-Json $settingsFile).usageDisplay -eq 'remaining') 'settings persisted'
        Assert-UI $script:settingsWindow.IsVisible 'instant save keeps settings open'
        $config.balance=$true;Render;$with=$mainCard.window.ActualHeight;$config.balance=$false;Render
        Assert-UI ($mainCard.window.ActualHeight -lt $with) 'credit row changes measured height'
        $config.balance=$true;$config.resetSound=$false;$config.creditSound=$false
        $announcement.at=(Now)+122*60;$lastKey='';Render
        Assert-UI $resetCard.window.IsVisible 'reset shown'
        $resetCard.close.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)));Render
        Assert-UI (-not $resetCard.window.IsVisible) 'reset dismissed'
        $announcement.at=(Now)+119*60;Render
        $expectedWithin=$words.notice_after.Replace('{value}',(Get-Forecast $announcement (Now) $words))
        Assert-UI ($resetCard.window.IsVisible -and $resetCard.lastLines[0].Contains($expectedWithin)) 'reset interval reappeared with localized within wording'
        $creditVisible=$true;Render;Assert-UI $creditCard.window.IsVisible 'credit warning shown'
        $creditCard.close.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)));Assert-UI (-not $creditCard.window.IsVisible) 'credit warning dismissed'
        $config.placement='hidden';Render;Assert-UI (-not $mainCard.window.IsVisible) 'hidden mode'
        $config.placement='above';$alive=$false;Render;Assert-UI (-not $mainCard.window.IsVisible -and $config.placement -eq 'above') 'Codex exit preserves placement'
        $alive=$true;Render;Assert-UI $mainCard.window.IsVisible 'Codex restart restores panel'
        Assert-UI ($mainCard.window.Topmost -and $mainCard.window.AllowsTransparency) 'native transparent topmost window'
        $report.uiChecks=$checks
        $windowChecks=0
        function Assert-Window($Ok,[string]$Message) {$script:windowChecks++;if (-not $Ok) {throw $Message}}
        # 실제 HWND를 확인한다. 설정창은 일반 창으로 유지하고 세 패널만 전환 목록에서 제외한다.
        foreach ($card in @($mainCard,$resetCard,$creditCard)) {
            $handle=(New-Object Windows.Interop.WindowInteropHelper($card.window)).Handle
            $style=[UsageScripts.WindowChrome]::ExtendedStyle($handle)
            Assert-Window (($style -band 0x80) -ne 0) ($card.kind+' is a tool window')
            Assert-Window (($style -band 0x40000) -eq 0) ($card.kind+' does not force a taskbar entry')
            Assert-Window (($style -band 0x80000) -ne 0) ($card.kind+' preserves layered transparency')
            Assert-Window (($style -band 0x8) -ne 0) ($card.kind+' preserves topmost placement')
            Assert-Window (($style -band 0x8000000) -eq 0) ($card.kind+' remains interactive')
            $card.window.Hide();$card.window.Show()
            Assert-Window (([UsageScripts.WindowChrome]::ExtendedStyle($handle) -band 0x80) -ne 0) ($card.kind+' stays excluded after hide/show')
        }
        $settingsHandle=(New-Object Windows.Interop.WindowInteropHelper($settingsWindow)).Handle
        Assert-Window $settingsWindow.ShowInTaskbar 'settings keeps its taskbar entry'
        Assert-Window (([UsageScripts.WindowChrome]::ExtendedStyle($settingsHandle) -band 0x80) -eq 0) 'settings remains a normal switchable window'
        $report.windowChecks=$windowChecks
        $taskbarChecks=0
        function Assert-Taskbar($Ok,[string]$Message) {$script:taskbarChecks++;if (-not $Ok) {throw $Message}}
        # WPF 속성뿐 아니라 Windows가 보관하는 실제 창의 Shell 속성을 읽어 검증한다.
        Assert-Taskbar ([UsageScripts.TaskbarIdentity]::CurrentProcessId() -ceq 'DailyOddBuilds.CodexUsageMonitor') 'dedicated process app ID'
        Assert-Taskbar ($settingsWindow.Title -ceq 'Codex Usage Monitor') 'settings title'
        Assert-Taskbar ([UsageScripts.TaskbarIdentity]::ReadWindowProperty($settingsHandle,5) -ceq 'DailyOddBuilds.CodexUsageMonitor') 'dedicated taskbar app ID'
        Assert-Taskbar ([UsageScripts.TaskbarIdentity]::ReadWindowProperty($settingsHandle,4) -ceq 'Codex Usage Monitor') 'taskbar display name'
        $taskbarIcon=Join-Path $profile 'taskbar\gp-chan.ico';$taskbarLink=Join-Path $profile 'taskbar\Codex Usage Monitor.lnk'
        Assert-Taskbar ([UsageScripts.TaskbarIdentity]::ReadWindowProperty($settingsHandle,3) -ceq ($taskbarIcon+',0')) 'taskbar character icon resource'
        Assert-Taskbar ($settingsWindow.Icon.UriSource.LocalPath -ceq (Join-Path $root 'assets\gp-chan.ico')) 'window character icon'
        $relaunch=[UsageScripts.TaskbarIdentity]::ReadWindowProperty($settingsHandle,2)
        Assert-Taskbar ($relaunch -ceq (Quote-ProcessArgument $taskbarLink) -and (Test-Path -LiteralPath $taskbarLink)) 'taskbar relaunch uses its dedicated shortcut'
        Render
        $trayChecks=0
        function Assert-Tray($Ok,[string]$Message) {$script:trayChecks++;if (-not $Ok) {throw $Message}}
        # 실제 NotifyIcon을 끄고 다시 만든다. 트레이 없이도 설정창 접근과 패널 표시는 유지한다.
        $fields.trayIcon.IsChecked=$true;Save-Fields
        Assert-Tray ([bool]($tray -and $tray.Visible)) 'tray enabled'
        $fields.trayIcon.IsChecked=$false;Save-Fields
        Assert-Tray (-not (Read-Json $settingsFile).trayIcon) 'hidden tray preference persisted'
        Assert-Tray ($null -eq $tray) 'hidden tray icon and resources disposed'
        Assert-Tray $mainCard.window.IsVisible 'panel remains visible without tray'
        Assert-Tray $settingsWindow.IsVisible 'settings remains open without tray'
        $settingsWindow.Close();Show-Settings
        Assert-Tray ($settingsWindow.IsVisible -and -not $fields.trayIcon.IsChecked) 'settings reopens with hidden tray'
        $reopenedHandle=(New-Object Windows.Interop.WindowInteropHelper($settingsWindow)).Handle
        Assert-Taskbar ([UsageScripts.TaskbarIdentity]::ReadWindowProperty($reopenedHandle,4) -ceq 'Codex Usage Monitor') 'taskbar name survives window recreation'
        Assert-Taskbar ([UsageScripts.TaskbarIdentity]::ReadWindowProperty($reopenedHandle,3) -ceq ($taskbarIcon+',0')) 'taskbar icon survives window recreation'
        $report.taskbarChecks=$taskbarChecks
        $fields.trayIcon.IsChecked=$true;Save-Fields
        Assert-Tray ([bool]($tray -and $tray.Visible)) 'tray restored through settings'
        $savedTray=$tray;Save-Fields
        Assert-Tray ([object]::ReferenceEquals($savedTray,$tray)) 'saving does not duplicate tray icon'
        $fields.trayIcon.IsChecked=$false;Save-Fields
        Assert-Tray ($null -eq $tray -and -not (Read-Json $settingsFile).trayIcon) 'tray can be hidden again'
        $report.trayChecks=$trayChecks
        function Capture-UI($Visual,[string]$Name,[double]$Scale=1) {
            # 토글/이동 애니메이션의 마지막 프레임까지 자기 Dispatcher를 진행한다.
            $captureFrame=New-Object Windows.Threading.DispatcherFrame;$captureTimer=New-Object Windows.Threading.DispatcherTimer;$captureTimer.Interval=[TimeSpan]::FromMilliseconds(180)
            $action={$captureTimer.Stop();$captureFrame.Continue=$false}.GetNewClosure();$captureTimer.Add_Tick($action);$captureTimer.Start();[Windows.Threading.Dispatcher]::PushFrame($captureFrame)
            $Visual.UpdateLayout();$bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap([int][Math]::Ceiling($Visual.ActualWidth*$Scale),[int][Math]::Ceiling($Visual.ActualHeight*$Scale),(96*$Scale),(96*$Scale),[Windows.Media.PixelFormats]::Pbgra32);$bitmap.Render($Visual)
            $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder;$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap));$output=[IO.File]::Create((Join-Path (Split-Path $ReportPath -Parent) ($Name+'.png')));try {$encoder.Save($output)} finally {$output.Dispose()}
        }
        # 실제 WPF 측정으로 연결/오류/적은 데이터/확장 상태의 최소 높이를 검사한다.
        $heightChecks=0;$heightCases=@()
        function Assert-Height($Ok,[string]$Message) {$script:heightChecks++;if (-not $Ok) {throw $Message}}
        function Check-MinimumHeight([string]$Name) {
            $border=$script:mainCard.border;$stack=$script:mainCard.stack
            Assert-Height ([Math]::Abs($border.ActualHeight-$script:uiSpec.panel.mainMinHeight) -lt 0.1) ($Name+' body minimum height')
            $point=$stack.TransformToAncestor($border).Transform((New-Object Windows.Point(0,0)))
            $top=$point.Y;$bottom=$border.ActualHeight-$top-$stack.ActualHeight
            Assert-Height ([Math]::Abs($top-$bottom) -lt 0.1) ($Name+' vertically centered content')
            $script:heightCases+=@{name=$Name;bodyHeight=$border.ActualHeight;windowHeight=$script:mainCard.window.ActualHeight;top=$top;bottom=$bottom}
            Capture-UI $script:mainCard.window ('minimum-height-'+$Name) 2
        }
        $heightSaved=@{config=($config|ConvertTo-Json -Depth 15|ConvertFrom-Json);lastData=$lastData;lastError=$script:lastError;resetVisible=$resetVisible;creditVisible=$creditVisible}
        try {
            $config.resetNotice=$false;$config.creditNotice=$false
            $script:lastData=0;$script:lastError=$null;Render;Check-MinimumHeight 'connecting'
            $script:lastError='path';Render;Check-MinimumHeight 'error'
            $script:lastData=$heightSaved.lastData;$script:lastError=$heightSaved.lastError
            $config.short=$false;$config.weekly=$true;$config.tickets=$false;$config.expiry=$false;$config.balance=$false
            Render;Check-MinimumHeight 'one-row'
            $config.tickets=$true;$config.expiry=$true;Render;Check-MinimumHeight 'two-rows'
            $config.balance=$true;Render
            Assert-Height ($mainCard.border.ActualHeight -gt $uiSpec.panel.mainMinHeight) 'three rows can grow beyond minimum'
            Capture-UI $mainCard.window 'minimum-height-three-rows' 2
            $config.weekly=$false;$config.tickets=$false;$config.expiry=$false;$config.balance=$false
            Render;Check-MinimumHeight 'no-data'
            foreach ($language in @('en','zh','ja')) {
                $config.language=$language;$script:words=$allWords.$language
                Render;Check-MinimumHeight $language
            }
            Fill-Card $mainCard @('Usage 27%','Reset in 2d','Tickets 3','Credits 62,500','Connection status') $true
            Assert-Height ($mainCard.border.ActualHeight -gt 90) 'additional rows expand without clipping'
            Fill-Card $creditCard @('Credit usage started','Credits 62,500') $true
            Assert-Height ($creditCard.border.MinHeight -eq 0) 'notice height is independent of usage minimum'
            $report.minimumHeightChecks=$heightChecks;$report.minimumHeightCases=$heightCases
        } finally {
            $script:config=$heightSaved.config;$script:words=$allWords.($config.language)
            $script:lastData=$heightSaved.lastData;$script:lastError=$heightSaved.lastError
            $script:resetVisible=$heightSaved.resetVisible;$script:creditVisible=$heightSaved.creditVisible
            Render
        }
        $creditVisible=$true;Render
        foreach ($g in @('main','reset','credit')) {Capture-UI ((Get-Variable ($g+'Card')).Value.window) $g}
        foreach ($page in @('settings','style','creator')) {$script:settingsNav[$page].RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)));Capture-UI $script:settingsRoot $page}
        $report.geometry=@{mainWidth=$mainCard.window.ActualWidth;mainHeight=$mainCard.window.ActualHeight;settingsWidth=$settingsRoot.ActualWidth;settingsHeight=$settingsRoot.ActualHeight;sidebar=154;fontPrimary=12;fontSecondary=11.5;noticeGap=10}
        $report.lines=(Get-View $data $config (Now) $words).lines
        $report.noticeLines=@{reset=$resetCard.lastLines;credit=$creditCard.lastLines}
        $report.textMeasurements=@($mainCard.stack.Children | ForEach-Object {$oldWidth=$_.Width;$_.Width=[double]::NaN;$_.Measure((New-Object Windows.Size([double]::PositiveInfinity,[double]::PositiveInfinity)));$size=$_.DesiredSize.Width;$_.Width=$oldWidth;$size})
        $visualChecks=0
        function Assert-Visual($Ok,[string]$Message) {$script:visualChecks++;if (-not $Ok) {throw $Message}}
        Assert-Visual ([Math]::Abs($settingsRoot.ActualWidth-840) -lt 1) 'reference settings width'
        Assert-Visual ([Math]::Abs($settingsRoot.ActualHeight-720) -lt 1) 'reference settings height'
        Assert-Visual ($script:stylePercent.main.Text -eq '15%') ('transparency percentage: '+$script:stylePercent.main.Text+' / '+$config.styles.main.opacity)
        Assert-Visual ($script:previews.main.card.stack.Children.Count -eq 3) 'preview shares real three-row renderer'
        Assert-Visual ($mainCard.window.Width -eq $resetCard.window.Width -and $mainCard.window.Width -eq $creditCard.window.Width) 'shared capsule widths'
        foreach ($side in @('above','below')) {
            $config.placement=$side;Render
            $gap=if ($side -eq 'above') {$mainCard.targetY+16-($creditCard.targetY+$creditCard.window.ActualHeight-4)} else {$resetCard.targetY+16-($mainCard.targetY+$mainCard.window.ActualHeight-4)}
            Assert-Visual ([Math]::Abs($gap-10) -lt 0.01) ('actual card gap '+$side)
        }
        $config.placement='above'
        foreach ($language in @('en','zh','ja','ko')) {
            $script:fields.language.SelectedValue=$language
            Assert-Visual ((Read-Json $settingsFile).language -eq $language -and $settingsWindow.IsVisible) ('live language switch '+$language+' / '+$config.language+' / '+$script:fields.language.SelectedValue)
            $script:settingsNav.settings.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
            Capture-UI $script:settingsRoot ('settings-'+$language)
        }
        $plan=$data.rateLimits.planType;$data.rateLimits.planType='pro';Sync-Fields;Render
        Assert-Visual (-not $script:fields.short.IsEnabled -and -not $script:fields.shortReset.IsEnabled -and $script:proHint.Visibility -eq 'Visible') 'Pro overlay and disabled 5h controls'
        Capture-UI $script:settingsRoot 'settings-pro';$data.rateLimits.planType=$plan;Sync-Fields;Render
        Assert-Visual $script:fields.short.IsEnabled '5h controls restore after plan change'
        $report.visualChecks=$visualChecks
        $availabilityChecks=0
        function Assert-Availability($Ok,[string]$Message) {$script:availabilityChecks++;if (-not $Ok) {throw $Message}}
        $savedPet=$fixtureFrame.Pet;$savedAlive=$alive;$savedPlacement=$config.placement;$savedSettingsWindow=$settingsWindow
        try {
            $script:fixtureFrame.Pet=$null;Sync-PetAvailability
            Assert-Availability (-not $positionButtons.above.IsEnabled -and -not $positionButtons.below.IsEnabled) 'Pet absent disables attached positions'
            $script:fixtureFrame.Pet=$savedPet;Sync-PetAvailability
            Assert-Availability ($positionButtons.above.IsEnabled -and $positionButtons.below.IsEnabled) 'Pet returns without reopening settings'
            $script:alive=$false;Sync-PetAvailability
            Assert-Availability (-not $positionButtons.above.IsEnabled -and -not $positionButtons.below.IsEnabled) 'app closed ignores stale Pet frame'
            $script:alive=$true;Sync-PetAvailability
            Assert-Availability ($positionButtons.above.IsEnabled -and $positionButtons.below.IsEnabled) 'app returns restores attached controls'
            Assert-Availability ($config.placement -eq $savedPlacement -and $settingsWindow -eq $savedSettingsWindow -and $settingsWindow.IsVisible) 'availability keeps preference and the same open window'
        } finally {$script:fixtureFrame.Pet=$savedPet;$script:alive=$savedAlive;Sync-PetAvailability}
        $report.availabilityChecks=$availabilityChecks
        $placementChecks=0;$placementCases=@()
        function Assert-Placement($Ok,[string]$Message) {$script:placementChecks++;if (-not $Ok) {throw $Message}}
        $placementSaved=@{config=($config|ConvertTo-Json -Depth 15|ConvertFrom-Json);frame=$fixtureFrame;resetVisible=$resetVisible;creditVisible=$creditVisible;lastKey=$lastKey;dismissedKey=$dismissedResetKey}
        try {
            # 실제 Border 치수로 한/세 줄 및 알림 조합을 검사한다. DPI별 픽셀 간격도 기록한다.
            $testFrame=New-Object UsageScripts.Frame;$testFrame.Alive=$true
            $testFrame.Pet=New-Object UsageScripts.Box(650,650,150,240)
            $testFrame.Blockers=@((New-Object UsageScripts.Box(500,500,500,90)),(New-Object UsageScripts.Box(600,910,250,60)))
            $script:fixtureFrame=$testFrame
            foreach ($side in @('above','below')) {
                foreach ($rows in @('compact','full')) {
                    $config.weekly=$true;$config.tickets=$rows -eq 'full';$config.expiry=$rows -eq 'full';$config.balance=$rows -eq 'full';$config.placement=$side
                    foreach ($notices in @('none','reset','credit','both')) {
                        $script:resetVisible=$notices -in @('reset','both');$script:creditVisible=$notices -in @('credit','both')
                        $script:lastKey=Get-ReminderKey $announcement (Now) $config.resetMinutes
                        $script:dismissedResetKey=if($script:resetVisible){''}else{$script:lastKey};Render
                        $borderTop=$mainCard.targetY+$mainCard.border.Margin.Top
                        $borderBottom=$mainCard.targetY+$mainCard.window.ActualHeight-$mainCard.border.Margin.Bottom
                        $edge=if ($side -eq 'above') {500/$script:scale} else {970/$script:scale}
                        $gap=if ($side -eq 'above') {$edge-$borderBottom} else {$borderTop-$edge}
                        $expectedGap=if ($side -eq 'above') {6} else {12}
                        Assert-Placement ($mainCard.window.IsVisible -and [Math]::Abs($gap-$expectedGap) -lt 0.01) ("visible border gap $side/$rows/$notices")
                        $script:placementCases+=@{side=$side;rows=$rows;notices=$notices;gapDIP=$gap;gapPixels=$gap*$script:scale;scale=$script:scale}
                    }
                }
            }
            $report.placementChecks=$placementChecks;$report.placementCases=$placementCases
        } finally {
            $script:config=$placementSaved.config;$script:fixtureFrame=$placementSaved.frame
            $script:resetVisible=$placementSaved.resetVisible;$script:creditVisible=$placementSaved.creditVisible;$script:lastKey=$placementSaved.lastKey;$script:dismissedResetKey=$placementSaved.dismissedKey
            Render
        }
        $designChecks=0;$designSaved=$config|ConvertTo-Json -Depth 15|ConvertFrom-Json
        function Assert-Design($Ok,[string]$Message) {$script:designChecks++;if (-not $Ok) {throw $Message}}
        try {
            $script:settingsNav.style.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
            Assert-Design (-not $advancedSettings.IsExpanded) 'advanced settings start collapsed'
            Assert-Design ($fields.speedPreset.SelectedValue -eq 'default') 'current timing is the default preset'
            Assert-Design ($responseWarning.Text -eq '시스템 자원 사용률이 상승할 수 있습니다.') 'requested resource warning'
            foreach ($key in @('gapAbove','gapBelow','noticeGap','dragMs','idleMs','chromeMs','motionMs')) {
                $bounds=if ($uiSpec.timing.limits.$key) {$uiSpec.timing.limits.$key} else {$uiSpec.spacing}
                Assert-Design ($fields[$key].Minimum -eq $bounds.min -and $fields[$key].Maximum -eq $bounds.max) ($key+' slider bounds')
            }
            $fields.gapAbove.Value=14;$fields.gapBelow.Value=20;$fields.noticeGap.Value=18
            $saved=Read-Json $settingsFile
            Assert-Design ($saved.gapAbove -eq 14 -and $saved.gapBelow -eq 20 -and $saved.noticeGap -eq 18) 'spacing saved immediately'
            foreach ($side in @('above','below')) {
                $config.placement=$side;Render
                $edge=if ($side -eq 'above') {$fixtureFrame.Pet.y/$script:scale} else {($fixtureFrame.Pet.y+$fixtureFrame.Pet.h)/$script:scale}
                $gap=if ($side -eq 'above') {$edge-($mainCard.targetY+$mainCard.window.ActualHeight-$mainCard.border.Margin.Bottom)} else {$mainCard.targetY+$mainCard.border.Margin.Top-$edge}
                Assert-Design ([Math]::Abs($gap-$config.('gap'+$(if($side -eq 'above'){'Above'}else{'Below'}))) -lt 0.01) ('live custom Pet gap '+$side)
                $noticeGap=if ($side -eq 'above') {$mainCard.targetY+16-($creditCard.targetY+$creditCard.window.ActualHeight-4)} else {$resetCard.targetY+16-($mainCard.targetY+$mainCard.window.ActualHeight-4)}
                Assert-Design ([Math]::Abs($noticeGap-18) -lt 0.01) ('live custom notice gap '+$side)
            }
            $advancedSettings.IsExpanded=$true
            Assert-Design $advancedSettings.IsExpanded 'advanced section expands in the same window'
            foreach ($name in @('fast','default','relaxed')) {
                $fields.speedPreset.SelectedValue=$name
                foreach ($key in @('dragMs','idleMs','chromeMs','motionMs')) {Assert-Design ($config.$key -eq $uiSpec.timing.presets.$name.$key) ($name+' applies '+$key)}
                Assert-Design ((Get-SpeedPreset (Read-Json $settingsFile) $uiSpec.timing.presets) -eq $name) ($name+' persisted')
            }
            $fields.dragMs.Value=33
            Assert-Design ($fields.speedPreset.SelectedValue -eq 'custom' -and (Read-Json $settingsFile).dragMs -eq 33) 'manual timing is persisted as custom'
            $script:timer=New-Object Windows.Threading.DispatcherTimer;Sync-ReactionTimer
            $expectedInterval=Get-ReactionInterval $config $alive ([UsageScripts.Desktop]::PointerDown)
            Assert-Design ($timer.Interval.TotalMilliseconds -eq $expectedInterval) 'live timer uses configured timing'
            $fields.motionMs.Value=80;Move-Card $creditCard ($creditCard.targetX+30) $creditCard.targetY $true
            Assert-Design ($creditCard.motionDurationMs -eq 80) 'movement uses configured animation duration'
            $fields.speedPreset.SelectedValue='default'
            $script:settingsPages.style.scroll.ScrollToEnd();Capture-UI $settingsRoot 'style-advanced'
            $advancedSettings.IsExpanded=$false;$script:settingsPages.style.scroll.ScrollToEnd();Capture-UI $settingsRoot 'style-spacing'
            foreach ($language in @('en','zh','ja','ko')) {
                $fields.language.SelectedValue=$language
                Assert-Design ($responseWarning.Text -eq $allWords.$language.response_warning -and $fields.speedPreset.SelectedValue -eq 'default') ('localized advanced controls '+$language)
                $script:settingsNav.style.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
                $advancedSettings.IsExpanded=$true;$script:settingsPages.style.scroll.ScrollToEnd();Capture-UI $settingsRoot ('style-advanced-'+$language)
            }
            $report.designChecks=$designChecks
        } finally {
            $script:timer=$null;$script:config=$designSaved;Save-Config;Build-SettingsContent;Render
        }
        $script:mainCard.window.Content.Children[1].Visibility='Visible';Capture-UI $mainCard.window 'main-hover'
        $script:resetCard.window.Content.Children[1].Visibility='Visible';Capture-UI $resetCard.window 'reset-hover'
        $script:settingsNav.style.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)));Capture-UI $script:settingsRoot 'style'
        $settingsWindow.Close()
        if ($ReportPath) {
            $target=New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$mainCard.window.ActualWidth,[int]$mainCard.window.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32);$target.Render($mainCard.window)
            $png=New-Object Windows.Media.Imaging.PngBitmapEncoder;$png.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($target));$stream=[IO.File]::Create([IO.Path]::ChangeExtension($ReportPath,'.png'));try {$png.Save($stream)} finally {$stream.Dispose()}
        }
    }
    $timer=New-Object Windows.Threading.DispatcherTimer;$timer.Interval=[TimeSpan]::FromSeconds(2)
    $timer.Add_Tick({
        try {
            $now=Now
            Sync-ReactionTimer
            if ($script:alive -and $now -lt $script:nextLogicTick) {
                if ($script:uiLoaded -and $script:mainCard.window.IsVisible -and -not $FixturePath) {$fast=[UsageScripts.Desktop]::ChangedFrame();if ($fast) {Position-Cards $fast}}
                return
            }
            $script:nextLogicTick=$now+0.25
            if ($MeasureAfterSeconds -gt 0 -and -not $script:measuring -and $now-$script:loopStart -ge $MeasureAfterSeconds) {
                $script:measuring=$true;$script:loopStart=$now;$script:loopCpu=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalSeconds;$script:loopUiCPU=[UsageScripts.Desktop]::ThreadCPUSeconds();$script:scanCpuStart=[UsageScripts.Desktop]::ScanCPUSeconds
            }
            foreach ($file in @([IO.Directory]::GetFiles($commandFolder,'*.json') | ForEach-Object {Get-Item -LiteralPath $_} | Sort-Object LastWriteTimeUtc | Select-Object -First 16)) {
                $request=Read-Json $file.FullName;Remove-Item -LiteralPath $file.FullName -ErrorAction SilentlyContinue
                if ($now-([DateTimeOffset]$file.LastWriteTimeUtc).ToUnixTimeSeconds() -lt 60) {
                    switch ($request.command) {'stop' {$script:quit=$true};'settings' {Show-Settings};'toggle' {Toggle-Monitor};'refresh' {$script:nextUsage=0;$script:nextFeed=0};'update' {Check-ScriptUpdate $true}}
                }
            }
            if ($SmokeSeconds -gt 0 -and $now-$started -ge $SmokeSeconds) {$script:quit=$true}
            if ($script:quit) {$timer.Stop();$frameLoop.Continue=$false;return}
            if (-not $FixturePath -and $now -ge $script:nextPresence) {
                $present=[UsageScripts.Desktop]::Alive();if ($ForceIdle) {$present=$false};$script:nextPresence=$now+$(if ($present) {1} else {2})
                if ($script:alive -and -not $present) {if ($script:rpc) {$script:rpc.Dispose();$script:rpc=$null};$script:feed.Cancel();Stop-UpdateCheck;$script:nextFeed=0;$script:nextUsage=0;$script:creditState.previous=$null}
                $script:alive=$present
            }
            Sync-ReactionTimer
            if ($script:alive -and -not $FixturePath) {
                Load-UI
                if($now -ge $script:nextUpdate){Check-ScriptUpdate}
                if ($now -ge $script:nextScan) {[UsageScripts.Desktop]::Refresh();$script:nextScan=$now+$script:config.chromeMs/1000.0}
                if (-not $script:rpc) {try {Start-Rpc} catch {$script:lastError='path'}}
                if ($script:rpc -and -not $script:rpc.Busy) {
                    if ($script:rpc.Result) {
                        $script:data=$script:rpc.Result|ConvertFrom-Json;$script:rpc.Result=$null;$script:lastData=$now;$script:report.usageRead=$true;$script:lastError=$null
                        if ($script:settingsWindow) {$isPro=Test-Pro $script:data;$script:fields.short.IsEnabled=-not $isPro;$script:fields.shortReset.IsEnabled=-not $isPro -and [bool]$script:fields.short.IsChecked;$script:proHint.Visibility=if ($isPro) {'Visible'} else {'Collapsed'}}
                        if (Test-CreditEvent $script:creditState $script:data $script:config.creditStep) {if ($script:config.creditNotice -and $script:config.placement -ne 'hidden') {$script:creditVisible=$true;Play-Notice 'credit'}}
                    }
                    if ($script:rpc.Error) {$script:lastError=$script:rpc.Error}
                    if ($now -ge $script:nextUsage -or $script:rpc.Dirty) {$script:rpc.Refresh();$script:nextUsage=$now+$script:config.pollSeconds}
                }
                if ($script:config.resetNotice -and -not $script:feed.Busy) {
                    Receive-Feed $now
                    if ($now -ge $script:nextFeed) {$script:feed.Refresh();$script:nextFeed=$now+[Math]::Max(60,$script:feed.RetrySeconds)}
                }
            }
            if ($script:uiLoaded) {
                if ($script:settingsWindow -and $script:settingsWindow.IsVisible) {Sync-PetAvailability}
                # 새 텍스트는 초마다만 렌더링; 이동 좌표는 50ms마다 갱신한다.
                if ($now -ge $script:nextRender) {Render;if($script:settingsWindow -and $script:settingsWindow.IsVisible){Sync-UpdateStatus};$script:nextRender=$now+1}
                elseif ($script:mainCard.window.IsVisible) {
                    $moving=if ($FixturePath) {$script:fixtureFrame} else {[UsageScripts.Desktop]::MovedFrame()}
                    if ($moving.Pet -and ($script:lastMoveX -ne $moving.Pet.x -or $script:lastMoveY -ne $moving.Pet.y -or $script:lastRevision -ne $moving.Revision)) {
                        Position-Cards $moving;$script:lastMoveX=$moving.Pet.x;$script:lastMoveY=$moving.Pet.y;$script:lastRevision=$moving.Revision
                    }
                }
                if ([UsageScripts.Desktop]::Current.Pet) {$script:report.petDetected=$true}
            }
        } catch {$script:lastError='runtime';$script:debugLine=$_.InvocationInfo.ScriptLineNumber;$script:debugType=$_.Exception.GetType().Name}
        finally {Write-Diagnostic}
    })
    if(-not $Once){Write-Json (Join-Path $profile 'instance.json') @{pid=$PID;version=$defaults.version;ready=$true;root=$root}}
    $frameLoop=New-Object Windows.Threading.DispatcherFrame;$loopStart=Now;$loopCpu=[Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalSeconds;$loopUiCPU=[UsageScripts.Desktop]::ThreadCPUSeconds();$timer.Start();[Windows.Threading.Dispatcher]::PushFrame($frameLoop)
    $report.passed=($FixturePath -or $report.usageRead -or -not $alive) -and $script:lastError -ne 'runtime'
    $report.mode=$mode;$report.mainVisible=if ($uiLoaded) {$mainCard.window.IsVisible} else {$false};$report.error=$script:lastError;$report.debugLine=$script:debugLine;$report.debugType=$script:debugType
    $report.workingMiB=[Math]::Round([Diagnostics.Process]::GetCurrentProcess().WorkingSet64/1MB,1)
    $report.loopCPUSeconds=[Math]::Round([Diagnostics.Process]::GetCurrentProcess().TotalProcessorTime.TotalSeconds-$loopCpu,3);$report.loopSeconds=[Math]::Round((Now)-$loopStart,1)
    $report.scanCPUSeconds=[Math]::Round([UsageScripts.Desktop]::ScanCPUSeconds-$script:scanCpuStart,3);$report.uiCPUSeconds=[Math]::Round([UsageScripts.Desktop]::ThreadCPUSeconds()-$loopUiCPU,3);$report.warmupExcludedSeconds=$MeasureAfterSeconds
} finally {
    Stop-UpdateCheck
    if ($rpc) {$rpc.Dispose()};$report.ownedServerStopped=$true
    $feed.Cancel()
    Close-Tray
    if ($settingsWindow) {$settingsWindow.Close()}
    if ($uiLoaded) {foreach ($card in @($mainCard,$resetCard,$creditCard)) {$card.window.Close()}}
    if ($ReportPath) {Write-Json $ReportPath $report}
    if (-not $Once) {$instance=Read-Json (Join-Path $profile 'instance.json');if ($instance.pid -eq $PID) {Remove-Item -LiteralPath (Join-Path $profile 'instance.json') -ErrorAction SilentlyContinue}}
    if ($owns) {$mutex.ReleaseMutex()};$mutex.Dispose()
}
