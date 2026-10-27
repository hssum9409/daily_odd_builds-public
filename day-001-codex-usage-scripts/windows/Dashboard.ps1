# 창 부착 모드 전용 대시보드. Pet 패널과 알림 창의 기존 렌더러는 그대로 둔다.
function Dash-Text([string]$Text,[double]$Size=12,[bool]$Muted=$false){
    $label=New-Object Windows.Controls.TextBlock;$label.Text=$Text;$label.FontSize=$Size*[Math]::Max(0.8,[Math]::Min(1.5,$script:dashboardTheme.size/14));$label.TextWrapping='Wrap'
    $label.FontFamily=New-Object Windows.Media.FontFamily($script:dashboardTheme.font)
    $label.Foreground=Brush $(if($Muted){$script:dashboardTheme.muted}else{$script:dashboardTheme.ink});return $label
}
function Dash-Row($Parent,[string]$Label,[string]$Value){
    $row=New-Object Windows.Controls.DockPanel;$row.Margin='0,4'
    $valueLabel=Dash-Text $Value 12;$valueLabel.FontWeight='SemiBold';[Windows.Controls.DockPanel]::SetDock($valueLabel,'Right');$null=$row.Children.Add($valueLabel)
    $null=$row.Children.Add((Dash-Text $Label 11 $true));$row.Tag=@{value=$valueLabel};$null=$Parent.Children.Add($row);return $row
}
function Dash-IconButton([string]$Kind,[string]$Name,$Action){
    $button=Button '' $Action;$button.Width=28;$button.Height=28;$button.Padding=5;$button.Margin='2,0,0,0';$button.Background=[Windows.Media.Brushes]::Transparent;$button.BorderThickness=0;$button.ToolTip=$Name
    [Windows.Automation.AutomationProperties]::SetName($button,$Name)
    $icon=New-Object Windows.Controls.Grid;$icon.Width=16;$icon.Height=16
    $path=New-Object Windows.Shapes.Path;$path.Stroke=Brush $script:dashboardTheme.ink;$path.StrokeThickness=1.4;$path.StrokeLineJoin='Round';$path.Stretch='Uniform'
    $shape=if($Kind -eq 'settings'){'M 7,1 L 10,1 10.7,3 12,3.8 14,3.2 15.5,5.8 14,7.3 14,8.7 15.5,10.2 14,12.8 12,12.2 10.7,13 10,15 7,15 6.3,13 5,12.2 3,12.8 1.5,10.2 3,8.7 3,7.3 1.5,5.8 3,3.2 5,3.8 6.3,3 Z'}elseif($Kind -eq 'expand'){'M 3,11 L 8,6 13,11'}else{'M 3,6 L 8,11 13,6'}
    $path.Data=[Windows.Media.Geometry]::Parse($shape);$path.Margin=if($Kind -eq 'settings'){0}else{'2,4'};$null=$icon.Children.Add($path)
    if($Kind -eq 'settings'){$hole=New-Object Windows.Shapes.Ellipse;$hole.Width=5;$hole.Height=5;$hole.Stroke=$path.Stroke;$hole.StrokeThickness=1.4;$null=$icon.Children.Add($hole)}
    $button.Content=$icon;return $button
}
function Toggle-DashboardFold {
    $card=$script:mainCard;$fold=$card.dashboardFold
    if(-not $fold){return}
    $current=$fold.ActualHeight;$collapsed=-not [bool]$card.dashboardCollapsed
    if($script:dockGeometry.compact){$script:dockCompactExpanded=-not $collapsed}
    else{$script:config.dockCollapsed=$collapsed;Save-Config}
    $card.dashboardCollapsed=$collapsed
    $fold.BeginAnimation([Windows.FrameworkElement]::HeightProperty,$null)
    if($collapsed){$target=0.0}else{
        $fold.Height=[double]::NaN;$card.window.UpdateLayout();$target=$fold.ActualHeight
    }
    $fold.Height=$current;$fold.IsHitTestVisible=-not $collapsed
    $animation=New-Object Windows.Media.Animation.DoubleAnimation;$animation.From=$current;$animation.To=$target;$animation.Duration=[TimeSpan]::FromMilliseconds(180)
    $ease=New-Object Windows.Media.Animation.CubicEase;$ease.EasingMode='EaseInOut';$animation.EasingFunction=$ease
    $fold.BeginAnimation([Windows.FrameworkElement]::HeightProperty,$animation)
    $card.dashboardKey=$null;$card.foldingUntil=(Now)+0.22;$card.foldAnimationActive=$true
    $icon=Dash-IconButton $(if($collapsed){'expand'}else{'collapse'}) (T $(if($collapsed){'dashboard_expand'}else{'dashboard_collapse'})) {}
    $content=$icon.Content;$icon.Content=$null;$card.dashboardCollapse.Content=$content;$card.dashboardCollapse.ToolTip=$icon.ToolTip
    [Windows.Automation.AutomationProperties]::SetName($card.dashboardCollapse,[string]$icon.ToolTip)
}
function Dash-Gauge([string]$Title,$Window,[bool]$Reset){
    $stack=New-Object Windows.Controls.StackPanel;$stack.HorizontalAlignment='Center'
    $factor=[Math]::Max(0.8,[Math]::Min(1.5,$script:dashboardTheme.size/14))
    $ring=New-Object Windows.Controls.Grid;$ring.Width=84*$factor;$ring.Height=84*$factor;$ring.Margin='0,5,0,3'
    $base=New-Object Windows.Shapes.Ellipse;$base.Margin=6;$base.Stroke=Brush $script:dashboardTheme.border;$base.StrokeThickness=6;$null=$ring.Children.Add($base)
    $pending=$Window._resetPending -or ($script:usageHealth.lastSuccess -gt 0 -and (Test-Finite $Window.resetsAt) -and (Now) -ge $Window.resetsAt -and $script:usageHealth.lastSuccess -lt $Window.resetsAt)
    $valid=(Test-Finite $Window.usedPercent) -and -not $pending;$value=if($valid){[Math]::Max(0,[Math]::Min(100,$Window.usedPercent))}else{0}
    if($script:config.usageDisplay -eq 'remaining'){$value=100-$value}
        $arc=New-Object Windows.Shapes.Ellipse;$arc.Margin=6;$arc.StrokeThickness=6;$arc.Stroke=Brush $script:dashboardTheme.accent;$arc.StrokeDashCap='Round'
        $arc.RenderTransformOrigin=New-Object Windows.Point(0.5,0.5);$arc.RenderTransform=New-Object Windows.Media.RotateTransform(-90);$null=$ring.Children.Add($arc)
    $percent=Dash-Text $(if($valid){([Math]::Round($value,1)).ToString()+'%'}else{'—'}) 19;$percent.FontWeight='SemiBold';$percent.HorizontalAlignment='Center';$percent.VerticalAlignment='Center';$null=$ring.Children.Add($percent)
    $null=$stack.Children.Add($ring)
    $titleLabel=Dash-Text $Title 12;$titleLabel.HorizontalAlignment='Center';$null=$stack.Children.Add($titleLabel)
    $hint=$null
    if($Reset){$hint=Dash-Text '' 10 $true;$hint.HorizontalAlignment='Center';$null=$stack.Children.Add($hint)}
    $stack.Tag=@{arc=$arc;percent=$percent;reset=$hint};Update-DashGauge $stack $Window
    return $stack
}
function Update-DashGauge($Stack,$Window){
    $pending=$Window._resetPending -or ($script:usageHealth.lastSuccess -gt 0 -and (Test-Finite $Window.resetsAt) -and (Now) -ge $Window.resetsAt -and $script:usageHealth.lastSuccess -lt $Window.resetsAt)
    $valid=(Test-Finite $Window.usedPercent) -and -not $pending;$value=if($valid){[Math]::Max(0,[Math]::Min(100,$Window.usedPercent))}else{0}
    if($script:config.usageDisplay -eq 'remaining'){$value=100-$value}
    $Stack.Tag.percent.Text=if($valid){([Math]::Round($value,1)).ToString()+'%'}else{'—'}
    $arc=$Stack.Tag.arc;$arc.Visibility=if($valid -and $value -gt 0){'Visible'}else{'Collapsed'}
    $arc.StrokeDashArray=$null
    if($value -gt 0 -and $value -lt 100){$c=[Math]::PI*66/6;$arc.StrokeDashArray=New-Object Windows.Media.DoubleCollection;$arc.StrokeDashArray.Add($c*$value/100);$arc.StrokeDashArray.Add($c*(1-$value/100))}
    if($Stack.Tag.reset){$Stack.Tag.reset.Text=if($pending){T 'usage_reset_pending'}elseif(Test-Finite $Window.resetsAt){(T 'reset')+' '+(Get-Duration $Window.resetsAt (Now) $true)}else{'—'}}
}
function Dash-Compact([double]$Value){
    if($Value -ge 1000000){return ('{0:0.0}M' -f ($Value/1000000))}
    if($Value -ge 1000){return ('{0:0.0}K' -f ($Value/1000))};return [string]$Value
}
function Dash-Chart($Values,[string]$Color,[double]$Width=120){
    $canvas=New-Object Windows.Controls.Canvas;$canvas.Width=$Width;$canvas.Height=24;$canvas.Margin='0,6,0,0'
    $points=@($Values|Where-Object {Test-Finite $_}|Select-Object -Last 20)
    if(-not $points.Count){$hint=Dash-Text (T 'metric_unmeasured') 9 $true;$null=$canvas.Children.Add($hint);return $canvas}
    $max=[Math]::Max(1,($points|Measure-Object -Maximum).Maximum);$line=New-Object Windows.Shapes.Polyline;$line.Stroke=Brush $Color;$line.StrokeThickness=1.7
    for($i=0;$i -lt $points.Count;$i++){$x=if($points.Count -eq 1){$Width/2}else{$i*$Width/($points.Count-1)};$y=22-20*$points[$i]/$max;$line.Points.Add((New-Object Windows.Point($x,$y)))}
    if($points.Count -eq 1){$dot=New-Object Windows.Shapes.Ellipse;$dot.Width=4;$dot.Height=4;$dot.Fill=Brush $Color;[Windows.Controls.Canvas]::SetLeft($dot,($Width/2-2));[Windows.Controls.Canvas]::SetTop($dot,($y-2));$null=$canvas.Children.Add($dot)}else{$null=$canvas.Children.Add($line)}
    return $canvas
}
function Get-SessionCost($Snapshot){
    $prices=@($script:config.sessionInputPrice,$script:config.sessionCachedPrice,$script:config.sessionOutputPrice)
    if(-not $script:config.sessionPriceModel -or @($prices|Where-Object {-not (Test-Number $_) -or [double]$_ -lt 0}).Count){return @{valid=$false;values=@();total=0}}
    $values=@(foreach($point in $Snapshot.Points){if($point.Model -ceq $script:config.sessionPriceModel -and $null -eq $point.Speed){[Math]::Max(0,$point.Input-$point.Cached)*[double]$prices[0]/1e6+$point.Cached*[double]$prices[1]/1e6+$point.Output*[double]$prices[2]/1e6}})
    return @{valid=$values.Count -gt 0;values=$values;total=($values|Measure-Object -Sum).Sum}
}
function Dash-Metric($Parent,[int]$Index,[string]$Title,[string]$Value,$Values,[string]$Hint){
    $box=New-Object Windows.Controls.Border;$box.CornerRadius=8;$box.Background=Brush $script:dashboardTheme.surface;$box.Padding='10,8';$box.Margin='3';$box.ClipToBounds=$true
    $stack=New-Object Windows.Controls.StackPanel;$box.Child=$stack;$box.ToolTip=$Hint
    $null=$stack.Children.Add((Dash-Text $Title 10 $true));$amount=Dash-Text $Value 16;$amount.FontWeight='SemiBold';$amount.TextWrapping='NoWrap'
    $valueBox=New-Object Windows.Controls.Viewbox;$valueBox.Stretch='Uniform';$valueBox.StretchDirection='DownOnly';$valueBox.HorizontalAlignment='Left';$valueBox.Height=25;$valueBox.Margin='0,3,0,0';$valueBox.Child=$amount;$null=$stack.Children.Add($valueBox)
    $chartBox=New-Object Windows.Controls.Viewbox;$chartBox.Stretch='Fill';$chartBox.Height=30;$chartBox.Child=Dash-Chart $Values $script:dashboardTheme.accent 110;$null=$stack.Children.Add($chartBox)
    $box.Tag=@{amount=$amount;chart=$chartBox;chartKey=($Values|ConvertTo-Json -Compress)}
    $Parent.Tag.tiles[$Index]=$box
    $columns=$Parent.ColumnDefinitions.Count;[Windows.Controls.Grid]::SetColumn($box,($Index%$columns));[Windows.Controls.Grid]::SetRow($box,[int][Math]::Floor($Index/$columns));$null=$Parent.Children.Add($box)
}
function Dash-MetricGrid([int]$Count,[double]$PanelWidth){
    $grid=New-Object Windows.Controls.Grid;$columns=if($PanelWidth -lt 260){1}else{2}
    for($j=0;$j -lt $columns;$j++){$grid.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition))}
    for($j=0;$j -lt [Math]::Ceiling($Count/$columns);$j++){$grid.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition))}
    $grid.Tag=@{tiles=@{}};return $grid
}
function Dash-Notice($Parent,[string]$Kind,[string]$Title,[string]$Detail){
    $box=New-Object Windows.Controls.Border;$box.CornerRadius=8;$box.Padding=10;$box.Margin='0,8,0,0'
    $style=$script:config.styles.$Kind;$tint=$style.color;$box.Background=Brush (Blend-Color $script:dashboardTheme.surface $tint 0.22) $style.opacity
    $stack=New-Object Windows.Controls.StackPanel;$box.Child=$stack;$header=New-Object Windows.Controls.DockPanel
    $close=Button '×' {};$close.Padding='4,0';$close.Margin=0;$close.Foreground=Brush $script:dashboardTheme.muted;$close.Background=[Windows.Media.Brushes]::Transparent
    $action=if($Kind -eq 'reset'){{Dismiss-ResetNotice;Render}}else{{$script:creditVisible=$false;Render}};$close.Add_Click($action)
    [Windows.Controls.DockPanel]::SetDock($close,'Right');$null=$header.Children.Add($close);$titleLabel=Dash-Text $Title 11;$titleLabel.FontWeight='SemiBold';$titleLabel.Foreground=Brush $(if($style.autoText){$script:dashboardTheme.ink}else{$style.text});$null=$header.Children.Add($titleLabel);$null=$stack.Children.Add($header)
    $small=Dash-Text $Detail 10 $true;$small.Margin='0,5,0,0';$null=$stack.Children.Add($small)
    if($Kind -eq 'reset'){$source=Dash-Text (T 'via') 10 $true;$source.TextDecorations=[Windows.TextDecorations]::Underline;$source.Cursor='Hand';$source.Margin='0,4,0,0';$source.Add_MouseLeftButtonUp({if($script:announcement.url){Start-Process $script:announcement.url}else{Start-Process 'https://codex-resets.com/'}});$null=$stack.Children.Add($source)}
    $null=$Parent.Children.Add($box)
    $box.Tag=@{title=$titleLabel;detail=$small};return $box
}
function Get-DashMetric($Option,$Snapshot){
    $values=@();$hint=T 'metric_local_only';$value='—'
    switch($Option){
        sessionTokens{if($Snapshot.Valid){$value=Dash-Compact $Snapshot.Total};$values=@($Snapshot.Points|Where-Object {$null -eq $_.Speed}|ForEach-Object {$_.Input+$_.Output});$hint+=' · '+(T 'metric_tokens_hint')}
        sessionCache{if($Snapshot.Valid -and $Snapshot.Input -gt 0){$value=([Math]::Round(100*$Snapshot.Cached/$Snapshot.Input,1)).ToString()+'%'};$values=@($Snapshot.Points|Where-Object {$_.Input -gt 0 -and $null -eq $_.Speed}|ForEach-Object {100*$_.Cached/$_.Input})}
        sessionCost{$cost=Get-SessionCost $Snapshot;$value=if($cost.valid){'$'+('{0:0.000}' -f $cost.total)}else{T 'metric_price_missing'};$values=$cost.values;$hint=T 'metric_cost_hint'}
        sessionSpeed{$values=@($Snapshot.Points|Where-Object {$null -ne $_.Speed}|ForEach-Object {$_.Speed});if($values.Count){$value=('{0:0.0} t/s' -f $values[-1])};$hint=T 'metric_speed_hint'}
    }
    return @{value=$value;values=$values;hint=$hint}
}
function Get-DashSource($Snapshot){
    return T $(if($script:sessionFollowing){if($Snapshot){'metric_source_current'}else{'metric_source_waiting'}}elseif($Snapshot.Source -eq 'selected'){'metric_source_selected'}elseif($Snapshot.Source -eq 'launch'){'metric_source_launch'}else{'metric_source_recent'})
}
function Update-DashboardContent($Card,$Lines,$Snapshot,$Windows,[bool]$Collapsed){
    # 구조가 같으면 기존 버튼·행·타일을 유지한다. 차트 데이터가 바뀐 타일의 그림만 교체한다.
    $Card.dashboardTitle.Text=if($script:dockGeometry.compact){[regex]::Replace([regex]::Replace($Lines[0],'\s*\([^\)]*\)',''),'\s*(사용|남음|used|left)$','')}else{T 'dashboard_usage'}
    $i=0;foreach($entry in ($Windows|Select-Object -First 2)){Update-DashGauge $Card.dashboardGauges[$i] $entry.window;$i++}
    if($Card.dashboardFallback){$Card.dashboardFallback.Text=$Lines[0]}
    $view=Get-View $script:data $script:config (Now) $script:words
    if($Card.dashboardTicketRow){$value=if($null -ne $view.tickets.count){[string]$view.tickets.count}else{'—'};if($script:config.expiry){$value+=' · '+(T 'expires')+' '+(Get-Duration $view.tickets.expiry (Now) $true)};$Card.dashboardTicketRow.Tag.value.Text=$value;$Card.ticketLabel.ToolTip=Ticket-Tooltip $view}
    if($Card.dashboardCreditRow){$Card.dashboardCreditRow.Tag.value.Text=Format-Credit $view.balance}
    $i=0;foreach($option in $Card.dashboardOptions){
        $item=Get-DashMetric $option $Snapshot;$tile=$Card.dashboardTiles.Tag.tiles[$i];$tile.Tag.amount.Text=$item.value;$tile.ToolTip=$item.hint
        $chartKey=$item.values|ConvertTo-Json -Compress
        if($chartKey -cne $tile.Tag.chartKey){$tile.Tag.chart.Child=Dash-Chart $item.values $script:dashboardTheme.accent 110;$tile.Tag.chartKey=$chartKey};$i++
    }
    if($Card.dashboardSource){$Card.dashboardSource.Text=Get-DashSource $Snapshot}
    $Card.dashboardReset.Visibility=if($script:resetVisible){'Visible'}else{'Collapsed'}
    $Card.dashboardReset.Tag.title.Text=Get-NoticeTitle $script:announcement (Now) $script:words
    $Card.dashboardCredit.Visibility=if($script:creditVisible){'Visible'}else{'Collapsed'}
    $Card.dashboardCredit.Tag.detail.Text=(T 'balance')+' '+(Format-Credit $view.balance)
    $Card.dashboardNoticeCount=[int][bool]$script:resetVisible+[int][bool]$script:creditVisible
    $health=Get-UsagePresentation $script:data $script:usageHealth $script:config (Now) $script:words $script:lastError
    $Card.dashboardHealth.Text=$health.notes -join ' · ';$Card.dashboardHealth.Visibility=if($health.notes.Count){'Visible'}else{'Collapsed'}
    if($Card.foldAnimationActive){$Card.dashboardFold.BeginAnimation([Windows.FrameworkElement]::HeightProperty,$null);$Card.foldAnimationActive=$false}
    $Card.dashboardCollapsed=$Collapsed;$Card.dashboardFold.Height=if($Collapsed){0}else{[double]::NaN};$Card.dashboardFold.IsHitTestVisible=-not $Collapsed
    $Card.dashboardScroll.MaxHeight=[Math]::Max(60,[Math]::Min(460,$script:dockGeometry.maxBodyHeight-68))
    if(-not $Card.window.IsVisible){$Card.window.Opacity=0;$Card.window.Show()};$Card.window.UpdateLayout();Position-Dock;$Card.window.Opacity=1
}
function Fill-Dashboard($Card,[string[]]$Lines,[bool]$Visible){
    if(-not $Visible){$Card.window.Hide();return}
    if($Card.window.IsVisible -and (Now) -lt $Card.foldingUntil){return}
    $appearance=if($script:config.dockFollowTheme){$script:codexAppearance}else{$null}
    if(-not $appearance){$appearance=Resolve-CodexAppearance @{mode='dark';size=14;dark=@{surface=$script:config.styles.main.color;ink=(Get-StyleInk $script:config.styles.main 'main')};light=@{}}}
    $script:dashboardTheme=@{};foreach($key in $appearance.Keys){$script:dashboardTheme[$key]=$appearance[$key]}
    $snapshot=Get-DashboardSnapshot
    $collapsed=if($script:dockGeometry.compact){-not $script:dockCompactExpanded}else{[bool]$script:config.dockCollapsed}
    $metricsKey=[string]$snapshot.Thread+':'+$snapshot.Total+':'+$snapshot.Cached+':'+$snapshot.Source+':'+($snapshot.Points|ConvertTo-Json -Depth 3 -Compress)
    $key=($Lines -join "`n")+($script:dashboardTheme|ConvertTo-Json -Compress)+$metricsKey+$script:resetVisible+$script:creditVisible+([Math]::Floor((Now)/60))+($script:config|ConvertTo-Json -Depth 8 -Compress)+$script:dockGeometry.cardWidth+':'+$script:dockGeometry.maxBodyHeight+':'+$collapsed+':'+$script:dockGeometry.compact
    if($Card.dashboardKey -eq $key){if(-not $Card.window.IsVisible){$Card.window.Opacity=0;$Card.window.Show();$Card.window.UpdateLayout();Position-Dock;$Card.window.Opacity=1;$Card.unmask=$false};return}
    $windows=@()
    foreach($bucket in (Get-Buckets $script:data)){foreach($k in @('primary','secondary')){$window=$bucket.$k;if(-not $window){continue};$weekly=$window.windowDurationMins -ge 1440;if(($weekly -and $script:config.weekly) -or (-not $weekly -and $script:config.short -and -not (Test-Pro $script:data))){$windows+=@{window=$window;weekly=$weekly}}}}
    $structure=@{theme=$script:dashboardTheme;language=$script:config.language;width=$script:dockGeometry.cardWidth;compact=$script:dockGeometry.compact;options=@($script:config.short,$script:config.weekly,$script:config.shortReset,$script:config.weeklyReset,$script:config.tickets,$script:config.expiry,$script:config.balance,$script:config.sessionTokens,$script:config.sessionCache,$script:config.sessionCost,$script:config.sessionSpeed);windows=@($windows|Select-Object -First 2|ForEach-Object {$_.weekly});styles=$script:config.styles}|ConvertTo-Json -Depth 5 -Compress
    if($Card.dashboardStructure -ceq $structure -and [object]::ReferenceEquals($Card.dashboardRoot,$Card.border.Child)){Update-DashboardContent $Card $Lines $snapshot $windows $collapsed;$Card.dashboardKey=$key;return}
    # 내용·접힘·폭 변경은 측정과 하단 좌표 확정까지 투명하게 처리한다. 중간 높이는 화면에 내보내지 않는다.
    $w=$Card.window;$w.Opacity=0;$w.Width=$script:dockGeometry.cardWidth;$Card.naturalWidth=$w.Width;$Card.forceWidth=$w.Width
    $Card.border.Background=Brush (Blend-Color $appearance.surface $appearance.ink 0.07) $(if($script:config.dockFollowTheme){1}else{$script:config.styles.main.opacity});$Card.border.BorderBrush=Brush $appearance.border;$Card.border.Padding='12,10'
    $root=New-Object Windows.Controls.StackPanel;$Card.border.Child=$root
    $header=New-Object Windows.Controls.DockPanel
    $Card.dashboardCollapsed=$collapsed
    $collapse=Dash-IconButton $(if($collapsed){'expand'}else{'collapse'}) (T $(if($collapsed){'dashboard_expand'}else{'dashboard_collapse'})) {Toggle-DashboardFold}
    [Windows.Controls.DockPanel]::SetDock($collapse,'Right');$null=$header.Children.Add($collapse);$Card.dashboardCollapse=$collapse
    $settings=Dash-IconButton 'settings' (T 'settings') {Show-Settings}
    [Windows.Controls.DockPanel]::SetDock($settings,'Right');$null=$header.Children.Add($settings);$Card.dashboardSettings=$settings
    $heading=if($script:dockGeometry.compact){[regex]::Replace([regex]::Replace($Lines[0],'\s*\([^\)]*\)',''),'\s*(사용|남음|used|left)$','')}else{T 'dashboard_usage'}
    $title=Dash-Text $heading 13;$title.FontWeight='SemiBold';$title.VerticalAlignment='Center';$Card.dashboardTitle=$title;$null=$header.Children.Add($title);$null=$root.Children.Add($header)
    $fold=New-Object Windows.Controls.Border;$fold.ClipToBounds=$true;$Card.dashboardFold=$fold;$null=$root.Children.Add($fold)
    $scroll=New-Object Windows.Controls.ScrollViewer;$scroll.VerticalScrollBarVisibility='Auto';$scroll.HorizontalScrollBarVisibility='Disabled';$scroll.MaxHeight=[Math]::Max(60,[Math]::Min(460,$script:dockGeometry.maxBodyHeight-68))
    $body=New-Object Windows.Controls.StackPanel;$body.Margin='0,6,0,0';$scroll.Content=$body;$fold.Child=$scroll;$Card.dashboardScroll=$scroll
    if($collapsed){$fold.Height=0;$fold.IsHitTestVisible=$false}
    $dialGrid=New-Object Windows.Controls.Grid;$Card.dashboardGauges=@();$Card.dashboardFallback=$null;$Card.dashboardTicketRow=$null;$Card.dashboardCreditRow=$null;$Card.dashboardSource=$null
    $i=0;foreach($entry in ($windows|Select-Object -First 2)){
        $col=New-Object Windows.Controls.ColumnDefinition;$dialGrid.ColumnDefinitions.Add($col)
        $gauge=Dash-Gauge $(if($entry.weekly){T 'weekly'}else{'5h'}) $entry.window $(if($entry.weekly){$script:config.weeklyReset}else{$script:config.shortReset})
        $Card.dashboardGauges+=,$gauge
        $gaugeBox=New-Object Windows.Controls.Viewbox;$gaugeBox.Stretch='Uniform';$gaugeBox.StretchDirection='DownOnly';$gaugeBox.MaxHeight=150;$gaugeBox.Child=$gauge
        [Windows.Controls.Grid]::SetColumn($gaugeBox,$i);$null=$dialGrid.Children.Add($gaugeBox);$i++
    }
    if($i){$null=$body.Children.Add($dialGrid)}else{$Card.dashboardFallback=Dash-Text $Lines[0] 12 $true;$null=$body.Children.Add($Card.dashboardFallback)}
    $view=Get-View $script:data $script:config (Now) $script:words
    if($script:config.tickets -or $script:config.expiry){$ticket=New-Object Windows.Controls.StackPanel;$ticket.Margin='0,8,0,0';$value=if($null -ne $view.tickets.count){[string]$view.tickets.count}else{'—'};if($script:config.expiry){$value+=' · '+(T 'expires')+' '+(Get-Duration $view.tickets.expiry (Now) $true)};$Card.dashboardTicketRow=Dash-Row $ticket (T 'tickets') $value;$ticket.ToolTip=Ticket-Tooltip $view;$null=$body.Children.Add($ticket);$Card.ticketLabel=$ticket}
    if($script:config.balance){$Card.dashboardCreditRow=Dash-Row $body (T 'balance') (Format-Credit $view.balance)}
    $options=@('sessionTokens','sessionCache','sessionCost','sessionSpeed');$enabled=@($options|Where-Object {$script:config.$_})
    $Card.dashboardOptions=$enabled
    if($enabled.Count){
        $heading=Dash-Text (T 'dashboard_session') 11 $true;$heading.Margin='0,12,0,4';$null=$body.Children.Add($heading)
        $tiles=Dash-MetricGrid $enabled.Count $w.Width
        $Card.dashboardTiles=$tiles;$n=0
        foreach($option in $enabled){
            $item=Get-DashMetric $option $snapshot
            Dash-Metric $tiles $n (T $option) $item.value $item.values $item.hint;$n++
        };$null=$body.Children.Add($tiles)
        $sourceText=Dash-Text (Get-DashSource $snapshot) 9 $true;$sourceText.Margin='3,5,0,0';$Card.dashboardSource=$sourceText;$null=$body.Children.Add($sourceText)
    }
    $Card.dashboardNoticeCount=[int][bool]$script:resetVisible+[int][bool]$script:creditVisible
    $Card.dashboardReset=Dash-Notice $body 'reset' (Get-NoticeTitle $script:announcement (Now) $script:words) (T 'reset_disclaimer');$Card.dashboardReset.Visibility=if($script:resetVisible){'Visible'}else{'Collapsed'}
    $Card.dashboardCredit=Dash-Notice $body 'credit' (T 'credit_started') ((T 'balance')+' '+(Format-Credit $view.balance));$Card.dashboardCredit.Visibility=if($script:creditVisible){'Visible'}else{'Collapsed'}
    $health=Get-UsagePresentation $script:data $script:usageHealth $script:config (Now) $script:words $script:lastError
    $note=Dash-Text ($health.notes -join ' · ') 10 $true;$note.Margin='0,8,0,0';$note.Visibility=if($health.notes.Count){'Visible'}else{'Collapsed'};$Card.dashboardHealth=$note;$null=$body.Children.Add($note)
    $appearing=-not $w.IsVisible
    if($appearing){$w.Opacity=0;$w.Show()};$w.UpdateLayout();Position-Dock
    $w.Opacity=1;$Card.unmask=$false;$Card.dashboardKey=$key;$Card.dashboardStructure=$structure;$Card.dashboardRoot=$root
}
