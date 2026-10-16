# 기존 EXE의 크기, 색, 글꼴, 카드와 간격을 그대로 사용한다. 이미지는 캐릭터에만 쓴다.
function Save-Fields {
    if ($script:buildingSettings) {return}
    $old=$script:config.placement;$oldChrome=$script:config.chromeMs
    foreach ($key in $script:fields.Keys) {
        if ($key -in @('startupEnabled','speedPreset')) {continue}
        $field=$script:fields[$key]
        if ($field -is [Windows.Controls.CheckBox]) {$script:config.$key=[bool]$field.IsChecked}
        elseif ($field -is [Windows.Controls.ComboBox]) {$script:config.$key=$field.SelectedItem.value}
        elseif ($field -is [Windows.Controls.TextBox]) {$script:config.$key=$field.Text}
        elseif ($field -is [Windows.Controls.Slider]) {$script:config.$key=$field.Value}
    }
    foreach ($group in @('main','reset','credit')) {
        foreach ($key in @('color','text')) {$value=$script:styleFields["$group.$key"].Text;if ($value -match '^#[0-9a-fA-F]{6}$') {$script:config.styles.$group.$key=$value}}
        $script:config.styles.$group.opacity=$script:styleFields["$group.opacity"].Value
        $script:config.styles.$group.autoText=[bool]$script:styleAuto[$group].IsChecked
        $script:styleFields["$group.text"].IsEnabled=-not $script:config.styles.$group.autoText
    }
    if ($script:config.placement -in @('above','below')) {$script:config.attachedPlacement=$script:config.placement}
    if ($old -ne 'free' -and $script:config.placement -eq 'free' -and $script:mainCard.window.IsVisible) {$script:config.x=$script:mainCard.window.Left;$script:config.y=$script:mainCard.window.Top}
    $script:config=Get-Normalized $script:config $defaults;Save-Config
    $script:words=$allWords.($script:config.language)
    if ($oldChrome -ne $script:config.chromeMs) {$script:nextScan=0}
    Sync-Fields;Sync-Tray;Sync-SpeedPreset;Sync-RangeLabels;Sync-ReactionTimer;Render;Update-StylePreviews
}
function Sync-SpeedPreset {
    if (-not $script:fields.speedPreset) {return}
    $script:syncingSpeedPreset=$true
    try {$script:fields.speedPreset.SelectedValue=Get-SpeedPreset $script:config $script:uiSpec.timing.presets} finally {$script:syncingSpeedPreset=$false}
}
function Set-SpeedPreset([string]$Name) {
    if ($Name -eq 'custom') {Sync-SpeedPreset;return}
    $preset=$script:uiSpec.timing.presets.$Name
    if (-not $preset) {return}
    # 네 값을 한 번에 변경하고 저장한다. 중간 단계의 반복 저장/재배치를 막는다.
    $script:buildingSettings=$true
    try {foreach ($key in @('dragMs','idleMs','chromeMs','motionMs')) {$script:fields[$key].Value=$preset.$key}}
    finally {$script:buildingSettings=$false}
    Save-Fields
}
function Sync-RangeLabels {
    foreach ($key in $script:rangeLabels.Keys) {$script:rangeLabels[$key].Text=([int]$script:fields[$key].Value).ToString()+$script:fields[$key].Tag.unit}
}
function Sync-UpdateStatus {
    if(-not $script:updateStatus){return}
    $cache=Read-Json (Join-Path $profile 'updates.json');$status=$cache.status
    $key=if(-not $script:alive){'sleeping'}elseif($status -eq 'installed'){'update_latest'}elseif($status -eq 'applying'){'update_downloading'}elseif($status -eq 'recovery_required'){'update_failed'}elseif($status -and $allWords.ko.$status){$status}else{'update_idle'}
    $script:updateStatus.Text=T $key
}
function Sync-PetAvailability {
    if (-not $script:positionButtons) {return}
    # 감지 완료·숨김·재등장을 열린 설정창에 반영한다. 표시 선호값과 설정 파일은 바꾸지 않는다.
    $frame=if ($FixturePath) {$script:fixtureFrame} else {[UsageScripts.Desktop]::MovedFrame()}
    $available=[bool]$script:alive -and [bool]$frame.Pet
    foreach ($key in @('above','below')) {
        $button=$script:positionButtons[$key]
        if ($button -and $button.IsEnabled -ne $available) {$button.IsEnabled=$available}
    }
}
function Sync-Fields {
    foreach ($pair in @(@('short','shortReset'),@('weekly','weeklyReset'),@('tickets','expiry'),@('resetNotice','resetSound'),@('creditNotice','creditSound'))) {
        $script:fields[$pair[1]].IsEnabled=[bool]$script:fields[$pair[0]].IsChecked
        if (-not $script:fields[$pair[0]].IsChecked) {$script:fields[$pair[1]].IsChecked=$false}
    }
    $pro=Test-Pro $script:data;$script:fields.short.IsEnabled=-not $pro
    if ($pro) {$script:fields.shortReset.IsEnabled=$false};$script:proHint.Visibility=if ($pro) {'Visible'} else {'Collapsed'}
    Sync-PetAvailability
    foreach ($key in $script:positionButtons.Keys) {$b=$script:positionButtons[$key];$b.Background=Brush $(if ($script:config.placement -eq $key) {'#a5e4ce'} else {'#233236'});$b.Foreground=Brush $(if ($script:config.placement -eq $key) {'#101617'} else {'#edf4f1'})}
}
function UI-Text([string]$Text,[double]$Size=11.5,[string]$Color='#edf4f1',[bool]$Bold=$false) {
    $v=Label $Text $Size;$v.Margin=0;$v.Foreground=Brush $Color;if ($Bold) {$v.FontWeight='SemiBold'};return $v
}
function UI-Section($Parent,[string]$Title) {
    $border=New-Object Windows.Controls.Border;$border.Background=Brush '#1c2628';$border.BorderBrush=Brush '#2b393c';$border.BorderThickness=1;$border.Padding='16,13';$border.Margin='0,0,0,12'
    $stack=New-Object Windows.Controls.StackPanel;$border.Child=$stack
    $heading=UI-Text $Title 11 '#a5e4ce' $true;$heading.Margin='0,0,0,7';$null=$stack.Children.Add($heading);$null=$Parent.Children.Add($border);return $stack
}
function UI-Pair($Parent,[double]$Gap=6) {
    $grid=New-Object Windows.Controls.Grid
    foreach ($i in 0..1) {$column=New-Object Windows.Controls.ColumnDefinition;$column.Width='*';$grid.ColumnDefinitions.Add($column)}
    $left=New-Object Windows.Controls.StackPanel;$right=New-Object Windows.Controls.StackPanel;$left.Margin=New-Object Windows.Thickness(0,0,$Gap,0);$right.Margin=New-Object Windows.Thickness($Gap,0,0,0);[Windows.Controls.Grid]::SetColumn($right,1)
    $null=$grid.Children.Add($left);$null=$grid.Children.Add($right);$null=$Parent.Children.Add($grid);return @($left,$right)
}
function UI-Check($Parent,[string]$Key,[string]$Title) {
    $c=New-Object Windows.Controls.CheckBox;$c.Content=UI-Text $Title;$c.IsChecked=[bool]$script:config.$Key;$script:fields[$Key]=$c;$null=$Parent.Children.Add($c)
    $c.Add_Click({Save-Fields});return $c
}
function UI-Choice($Parent,[string]$Key,[string]$Title,$Values,$Labels) {
    $dock=New-Object Windows.Controls.DockPanel;$dock.Margin='0,6,0,5'
    $combo=New-Object Windows.Controls.ComboBox;$combo.Width=120;$combo.DisplayMemberPath='label';$combo.SelectedValuePath='value'
    for ($i=0;$i -lt $Values.Count;$i++) {$null=$combo.Items.Add([pscustomobject]@{value=$Values[$i];label=$Labels[$i]})}
    $combo.SelectedValue=$script:config.$Key;$script:fields[$Key]=$combo;[Windows.Controls.DockPanel]::SetDock($combo,'Right');$null=$dock.Children.Add($combo)
    $label=UI-Text $Title 11.5 '#99aeaa';$label.VerticalAlignment='Center';$null=$dock.Children.Add($label);$null=$Parent.Children.Add($dock)
    $combo.Add_SelectionChanged({param($sender,$event);if (-not $script:buildingSettings -and -not $script:syncingSpeedPreset) {if ($sender -eq $script:fields.speedPreset) {Set-SpeedPreset $sender.SelectedItem.value;return};$languageChange=$sender -eq $script:fields.language;Save-Fields;if ($languageChange) {Update-SettingsLanguage}}});return $combo
}
function UI-Range($Parent,[string]$Key,[string]$Title,[double]$Minimum,[double]$Maximum,[double]$Step=1,[string]$Unit='') {
    $row=New-Object Windows.Controls.DockPanel;$row.Margin='0,9,0,3'
    $value=UI-Text '' 11 '#a5e4ce';[Windows.Controls.DockPanel]::SetDock($value,'Right');$null=$row.Children.Add($value)
    $null=$row.Children.Add((UI-Text $Title 11.5 '#99aeaa'));$null=$Parent.Children.Add($row)
    $slider=New-Object Windows.Controls.Slider;$slider.Minimum=$Minimum;$slider.Maximum=$Maximum;$slider.Value=$script:config.$Key
    $slider.TickFrequency=$Step;$slider.IsSnapToTickEnabled=$true;$slider.Margin='0,2,0,5';$slider.Tag=@{key=$Key;unit=$Unit}
    $script:fields[$Key]=$slider;$script:rangeLabels[$Key]=$value;$value.Text=([int]$slider.Value).ToString()+$Unit
    $slider.Add_ValueChanged({if (-not $script:buildingSettings) {Save-Fields}});$null=$Parent.Children.Add($slider)
    return $slider
}
function UI-Rule($Parent) {$line=New-Object Windows.Controls.Border;$line.Height=1;$line.Background=Brush '#2b393c';$line.Margin='0,10';$null=$Parent.Children.Add($line)}
function Set-SettingsPage([string]$Name) {
    foreach ($key in $script:settingsPages.Keys) {
        $script:settingsPages[$key].scroll.Visibility=if ($key -eq $Name) {'Visible'} else {'Collapsed'}
        $script:settingsNav[$key].Background=Brush $(if ($key -eq $Name) {'#2b393c'} else {'#151d1f'})
        $script:settingsNav[$key].Foreground=Brush $(if ($key -eq $Name) {'#a5e4ce'} else {'#99aeaa'})
    }
    $script:settingsPage=$Name
}
function Set-Position([string]$Key) {
    if ($Key -eq 'free' -and $script:mainCard.window.IsVisible) {$script:config.x=$script:mainCard.window.Left;$script:config.y=$script:mainCard.window.Top}
    $script:config.placement=$Key;if ($Key -in @('above','below')) {$script:config.attachedPlacement=$Key}
    Save-Config;Sync-Fields;Render
}
function UI-Link($Parent,[string]$Text,[string]$Url,[double]$Size=11.5) {
    $label=UI-Text $Text $Size '#a5e4ce';$label.Cursor='Hand';$label.TextDecorations=[Windows.TextDecorations]::Underline
    $action={Start-Process $Url}.GetNewClosure();$label.Add_MouseLeftButtonUp($action);$null=$Parent.Children.Add($label)
}
function Update-SettingsLanguage {
    # 동일한 창에서 내용만 바꾼다. 위치·탭·크기와 활성 창은 유지한다.
    $selected=$script:settingsPage;Build-SettingsContent;$script:settingsNav[$selected].RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
}
function Update-StylePreviews {
    if (-not $script:previews) {return}
    foreach ($g in @('main','credit','reset')) {
        $preview=$script:previews[$g];$style=$script:config.styles.$g
        Fill-Card $preview.card $preview.lines $true $true
        $script:stylePercent[$g].Text=([Math]::Round((1.0-$style.opacity)*100)).ToString()+'%'
    }
}
function Build-SettingsContent {
    if ($script:previews) {foreach ($entry in $script:previews.Values) {$entry.card.window.Close()}}
    $script:buildingSettings=$true;$script:fields=@{};$script:styleFields=@{};$script:styleAuto=@{};$script:stylePercent=@{};$script:settingsNav=@{};$script:positionButtons=@{};$script:previews=@{};$script:rangeLabels=@{}
    $w=$script:settingsWindow;$w.FontFamily=New-Object Windows.Media.FontFamily(@{ko='Malgun Gothic';en='Segoe UI';zh='Microsoft YaHei';ja='Meiryo'}[$script:config.language])
    $root=New-Object Windows.Controls.Grid;$root.Background=Brush '#101617'
    $sideColumn=New-Object Windows.Controls.ColumnDefinition;$sideColumn.Width=154;$root.ColumnDefinitions.Add($sideColumn);$root.ColumnDefinitions.Add((New-Object Windows.Controls.ColumnDefinition))
    $side=New-Object Windows.Controls.DockPanel;$side.Background=Brush '#151d1f';$null=$root.Children.Add($side)
    $art=New-Object Windows.Controls.Image;$art.Source=New-Object Windows.Media.Imaging.BitmapImage([Uri](Join-Path $script:root 'assets\gp-chan-monitor.png'));$art.Width=120;$art.Height=180;$art.Stretch='Uniform';$art.Margin='0,22,0,24';[Windows.Controls.DockPanel]::SetDock($art,'Top');$null=$side.Children.Add($art)
    $bottom=New-Object Windows.Controls.StackPanel;$bottom.Margin='22,0,22,20';[Windows.Controls.DockPanel]::SetDock($bottom,'Bottom')
    foreach ($row in @(@('refresh',{$script:nextUsage=0;$script:nextFeed=0}),@('quit',{$script:quit=$true}))) {$b=Button (T $row[0]) $row[1];$b.Margin='0,0,0,8';$b.Height=36;$null=$bottom.Children.Add($b)}
    $version=UI-Text ("DAY 001`nv"+$script:defaults.version) 10 '#99aeaa';$version.Margin='2,12,0,0';$null=$bottom.Children.Add($version);$null=$side.Children.Add($bottom)
    $nav=New-Object Windows.Controls.StackPanel;$null=$side.Children.Add($nav)
    $main=New-Object Windows.Controls.DockPanel;$main.Margin='28,26,28,14';[Windows.Controls.Grid]::SetColumn($main,1);$null=$root.Children.Add($main)
    $heading=UI-Text (T 'appearance') 23 '#edf4f1' $true;$heading.Margin='0,0,0,24';[Windows.Controls.DockPanel]::SetDock($heading,'Top');$null=$main.Children.Add($heading)
    $footer=New-Object Windows.Controls.StackPanel;$footer.Margin='0,8,0,0';$null=$footer.Children.Add((UI-Text (T 'saved') 10 '#99aeaa'))
    $status=UI-Text $(if ($script:alive) {T 'source_note'} else {T 'waiting'}) 10 '#99aeaa';$status.Margin='0,5,0,0';$null=$footer.Children.Add($status);[Windows.Controls.DockPanel]::SetDock($footer,'Bottom');$null=$main.Children.Add($footer)
    $pageHost=New-Object Windows.Controls.Grid;$null=$main.Children.Add($pageHost);$pages=@{}
    foreach ($name in @('settings','style','creator')) {
        $scroll=New-Object Windows.Controls.ScrollViewer;$scroll.VerticalScrollBarVisibility='Auto';$scroll.HorizontalScrollBarVisibility='Disabled';$scroll.PanningMode='VerticalOnly';$scroll.Visibility='Collapsed'
        $stack=New-Object Windows.Controls.StackPanel;$stack.Margin=0;$scroll.Content=$stack;$pages[$name]=@{scroll=$scroll;stack=$stack};$null=$pageHost.Children.Add($scroll)
        $b=Button (T $name) {}; $b.Margin='12,3';$b.Padding='20,13';$b.HorizontalContentAlignment='Left';$b.FontSize=13;$b.Background=Brush '#151d1f';$b.Foreground=Brush '#99aeaa'
        $action={Set-SettingsPage $name}.GetNewClosure();$b.Add_Click($action);$script:settingsNav[$name]=$b;$null=$nav.Children.Add($b)
    }
    $general=$pages.settings.stack;$position=UI-Section $general (T 'position')
    foreach ($row in @(@('above','below'),@('free','hidden'))) {
        $pair=UI-Pair $position
        for ($i=0;$i -lt 2;$i++) {
            $key=$row[$i];$action={Set-Position $key}.GetNewClosure()
            $b=Button (T $key) $action;$b.Margin='0,3';$script:positionButtons[$key]=$b;$null=$pair[$i].Children.Add($b)
        }
    }
    $hint=UI-Text (T 'position_hint') 10 '#99aeaa';$hint.Margin='0,9,0,0';$null=$position.Children.Add($hint)
    $usage=UI-Section $general (T 'data');$null=UI-Choice $usage 'usageDisplay' (T 'usage_group') @('used','remaining') @((T 'displayUsed'),(T 'displayRemaining'))
    $pair=UI-Pair $usage
    for ($i=0;$i -lt 2;$i++) {
        $group=if ($i -eq 0) {'short'} else {'weekly'}
        $border=New-Object Windows.Controls.Border;$border.BorderBrush=Brush '#2b393c';$border.BorderThickness=1;$border.Padding='12,9';$grid=New-Object Windows.Controls.Grid;$border.Child=$grid
        $stack=New-Object Windows.Controls.StackPanel;$null=$grid.Children.Add($stack);$title=UI-Text (T "${group}_group") 11 '#a5e4ce' $true;$title.Margin='0,0,0,4';$null=$stack.Children.Add($title)
        $null=UI-Check $stack $group (T 'usage_data');$null=UI-Check $stack "${group}Reset" (T "${group}_reset");$null=$pair[$i].Children.Add($border)
        if ($i -eq 0) {$overlay=New-Object Windows.Controls.Border;$overlay.Background=Brush '#1c2628';$overlay.Padding=12;$script:proHint=$overlay;$overlay.Child=UI-Text (T 'pro_short_hint') 11.5 '#99aeaa';$overlay.Child.TextAlignment='Center';$overlay.Child.VerticalAlignment='Center';$null=$grid.Children.Add($overlay)}
    }
    UI-Rule $usage;$null=$usage.Children.Add((UI-Text (T 'reset_group') 11 '#99aeaa' $true))
    $pair=UI-Pair $usage 12;$null=UI-Check $pair[0] 'tickets' (T 'ticket_count');$null=UI-Check $pair[1] 'expiry' (T 'nearest_expiry')
    $pair=UI-Pair $usage 12;$null=UI-Check $pair[0] 'resetNotice' (T 'resetNotice');$null=UI-Check $pair[1] 'resetSound' (T 'announcement_sound')
    $intervalLabels=@((T 'interval_minutes').Replace('{n}','10'),(T 'interval_minutes').Replace('{n}','30'),(T 'interval_hours').Replace('{n}','1'),(T 'interval_hours').Replace('{n}','2'))
    $null=UI-Choice $usage 'resetMinutes' (T 'reset_interval_minutes') @(10,30,60,120) $intervalLabels
    $null=$usage.Children.Add((UI-Text (T 'reset_interval_hint') 9.5 '#99aeaa'));$null=$usage.Children.Add((UI-Text (T 'reset_provider') 9.5 '#99aeaa'))
    UI-Rule $usage;$pair=UI-Pair $usage 12;$null=UI-Check $pair[0] 'balance' (T 'credit_data');$null=UI-Check $pair[1] 'creditNotice' (T 'credit_warning');$null=UI-Check $pair[1] 'creditSound' (T 'credit_sound')
    $creditLabels=@('1,000','3,000','5,000','10,000' | ForEach-Object {(T 'interval_credits').Replace('{n}',$_)})
    $null=UI-Choice $usage 'creditStep' (T 'credit_interval') @(1000,3000,5000,10000) $creditLabels
    $startup=UI-Section $general (T 'startup_group')
    $script:config | Add-Member -NotePropertyName startupEnabled -NotePropertyValue ([bool](Get-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue)) -Force
    $c=UI-Check $startup 'startupEnabled' (T 'startup_register');$c.Add_Click({Set-Startup ([bool]$this.IsChecked)})
    $null=UI-Check $startup 'startupPromptDismissed' (T 'startup_never');$null=$startup.Children.Add((UI-Text (T 'startupHint') 10 '#99aeaa'))
    UI-Rule $startup
    $null=UI-Check $startup 'trayIcon' (T 'tray_icon')
    $null=$startup.Children.Add((UI-Text (T 'tray_icon_hint') 10 '#99aeaa'))
    $regional=UI-Section $general (T 'regional');$null=UI-Choice $regional 'language' (T 'language') @('ko','en','zh','ja') @('한국어','English','中文','日本語')
    $zones=@('system','UTC','Asia/Seoul','Asia/Tokyo','Asia/Shanghai','America/Los_Angeles','America/New_York','Europe/London','Europe/Berlin');$null=UI-Choice $regional 'timezone' (T 'timezone') $zones $zones
    $null=$regional.Children.Add((UI-Text (T 'region_hint') 10 '#99aeaa'))
    $connection=UI-Section $general (T 'rpc_path');$path=New-Object Windows.Controls.TextBox;$path.Text=$script:config.codexPath;$script:fields.codexPath=$path;$null=$connection.Children.Add($path);$save=Button (T 'save') {Save-Fields;if ($script:rpc) {$script:rpc.Dispose();$script:rpc=$null};$script:nextUsage=0};$save.Margin='0,8,0,0';$save.HorizontalAlignment='Left';$null=$connection.Children.Add($save);$script:saveButton=$save
    $update=UI-Section $general (T 'update_group');$null=UI-Check $update 'autoUpdate' (T 'auto_update')
    $null=$update.Children.Add((UI-Text (T 'update_policy') 10 '#99aeaa'))
    $check=Button (T 'update_check') {Check-ScriptUpdate $true};$check.HorizontalAlignment='Left';$null=$update.Children.Add($check)
    $script:updateStatus=UI-Text (T 'update_idle') 10 '#99aeaa';$script:updateStatus.Margin='0,8,0,0';$null=$update.Children.Add($script:updateStatus);Sync-UpdateStatus
    $style=UI-Section $pages.style.stack (T 'panel_style')
    foreach ($g in @('main','credit','reset')) {
        if ($g -ne 'main') {UI-Rule $style};$title=UI-Text (T "style_$g") 12 '#edf4f1' $true;$title.Margin='0,0,0,8';$null=$style.Children.Add($title);$pair=UI-Pair $style
        $colors=UI-Pair $pair[0] 4;$column=0
        foreach ($key in @('color','text')) {
            $cell=$colors[$column];$column++
            $null=$cell.Children.Add((UI-Text (T $(if ($key -eq 'color') {'background_color'} else {'text_color'})) 10.5 '#99aeaa'))
            $row=New-Object Windows.Controls.DockPanel;$row.Margin='0,5,0,5'
            $swatch=Button '' {};$swatch.Width=22;$swatch.MinHeight=24;$swatch.Height=24;$swatch.Padding=0;$swatch.Margin='0,0,5,0';$swatch.Background=Brush $script:config.styles.$g.$key
            $swatch.Tag="$g.$key";$swatch.Add_Click({$parts=$this.Tag.Split('.');$picker=New-Object Windows.Forms.ColorDialog;$picker.Color=[Drawing.ColorTranslator]::FromHtml($script:config.styles.($parts[0]).($parts[1]));if ($picker.ShowDialog() -eq 'OK') {$script:styleFields[$this.Tag].Text=('#{0:X2}{1:X2}{2:X2}' -f $picker.Color.R,$picker.Color.G,$picker.Color.B);Save-Fields;$this.Background=Brush $script:styleFields[$this.Tag].Text};$picker.Dispose()})
            [Windows.Controls.DockPanel]::SetDock($swatch,'Left');$null=$row.Children.Add($swatch)
            $input=New-Object Windows.Controls.TextBox;$input.FontSize=10.5;$input.Padding='4,5';$input.Text=$script:config.styles.$g.$key;$script:styleFields["$g.$key"]=$input;$input.Add_LostFocus({$this.BorderBrush=Brush $(if ($this.Text -match '^#[0-9a-fA-F]{6}$') {'#2b393c'} else {'#efb0a9'});Save-Fields});$null=$row.Children.Add($input);$null=$cell.Children.Add($row)
        }
        $auto=New-Object Windows.Controls.CheckBox;$auto.Content=UI-Text (T 'auto_contrast') 10.5;$auto.Height=28;$auto.IsChecked=[bool]$script:config.styles.$g.autoText;$auto.Add_Click({Save-Fields});$script:styleAuto[$g]=$auto;$null=$pair[0].Children.Add($auto);$script:styleFields["$g.text"].IsEnabled=-not $auto.IsChecked
        $alpha=New-Object Windows.Controls.DockPanel;$percent=UI-Text '' 11 '#a5e4ce';[Windows.Controls.DockPanel]::SetDock($percent,'Right');$null=$alpha.Children.Add($percent);$null=$alpha.Children.Add((UI-Text (T 'background_transparency') 11.5 '#99aeaa'));$script:stylePercent[$g]=$percent;$null=$pair[0].Children.Add($alpha)
        $slider=New-Object Windows.Controls.Slider;$slider.Minimum=0.1;$slider.Maximum=1;$slider.Value=$script:config.styles.$g.opacity;$slider.IsDirectionReversed=$true;$slider.TickFrequency=0.01;$slider.IsSnapToTickEnabled=$true;$slider.Margin='0,5,0,6';$script:styleFields["$g.opacity"]=$slider;$slider.Add_ValueChanged({Save-Fields});$null=$pair[0].Children.Add($slider)
        $ends=UI-Pair $pair[0];$null=$ends[0].Children.Add((UI-Text (T 'opaque') 10 '#99aeaa'));$end=UI-Text (T 'transparent') 10 '#99aeaa';$end.HorizontalAlignment='Right';$null=$ends[1].Children.Add($end)
        $lines=if ($g -eq 'main') {@(((T 'week')+' 27% ('+(T 'reset')+' 5d 18:53) '+(T 'used')),((T 'tickets')+' 3 · '+(T 'expires')+' 14d 12h'),((T 'balance')+' 62,500'))} elseif ($g -eq 'credit') {@((T 'credit_started'),((T 'balance')+' 62,500'))} else {@(((T 'reset_stored')+' '+(T 'notice_reset')+' · '+(T 'notice_after').Replace('{value}','2h 30m')+' '+(T 'estimated')),(T 'reset_disclaimer'))}
        $card=Card $g;$rectangle=New-Object Windows.Shapes.Rectangle;$rectangle.Height=104;$rectangle.Fill=New-Object Windows.Media.VisualBrush($card.window.Content);$rectangle.Fill.Stretch='Uniform';$rectangle.VerticalAlignment='Center'
        $preview=New-Object Windows.Controls.Border;$preview.Background=Brush '#101617';$preview.Child=$rectangle;$script:previews[$g]=@{card=$card;lines=$lines};$null=$pair[1].Children.Add($preview)
    }
    $null=$style.Children.Add((UI-Text (T 'style_hint') 11.5 '#99aeaa'))
    $spacing=UI-Section $pages.style.stack (T 'spacing_group')
    foreach ($key in @('gapAbove','gapBelow','noticeGap')) {$null=UI-Range $spacing $key (T $key) $uiSpec.spacing.min $uiSpec.spacing.max}
    $null=$spacing.Children.Add((UI-Text (T 'spacing_hint') 10 '#99aeaa'))
    $advanced=New-Object Windows.Controls.Expander;$advanced.Header=T 'advanced_settings';$advanced.Style=$w.Resources['AdvancedExpander'];$advanced.IsExpanded=$false
    $advancedBody=New-Object Windows.Controls.StackPanel;$advanced.Content=$advancedBody;$script:advancedSettings=$advanced;$null=$pages.style.stack.Children.Add($advanced)
    $null=UI-Choice $advancedBody 'speedPreset' (T 'response_preset') @('fast','default','relaxed','custom') @((T 'speed_fast'),(T 'speed_default'),(T 'speed_relaxed'),(T 'speed_custom'))
    foreach ($key in @('dragMs','idleMs','chromeMs','motionMs')) {$limits=$uiSpec.timing.limits.$key;$null=UI-Range $advancedBody $key (T $key) $limits.min $limits.max $limits.step ' ms'}
    $null=$advancedBody.Children.Add((UI-Text (T 'response_hint') 10 '#99aeaa'))
    $script:responseWarning=UI-Text (T 'response_warning') 11 '#f3cc86';$script:responseWarning.Margin='0,10,0,0';$null=$advancedBody.Children.Add($script:responseWarning)
    Sync-SpeedPreset
    $about=UI-Section $pages.creator.stack (T 'creator');UI-Link $about 'hssum9409' 'https://github.com/hssum9409' 24
    $info=New-Object Windows.Controls.TextBlock;$info.FontSize=13;$info.Foreground=Brush '#99aeaa';$info.TextWrapping='Wrap';$info.Margin='0,16,0,20'
    $pattern='(github|GitHub|这里|こちら|here|여기)'
    foreach ($part in [regex]::Split((T 'creator_info'),$pattern)) {
        $run=New-Object Windows.Documents.Run($part)
        if ($part -match ('^'+$pattern+'$')) {$link=New-Object Windows.Documents.Hyperlink($run);$url=if ($part -match 'github|GitHub') {'https://github.com/hssum9409/daily_odd_builds-public/issues'} else {'https://daily-odd-builds-portal.web.app'};$link.NavigateUri=[Uri]$url;$link.Foreground=Brush '#a5e4ce';$link.Add_RequestNavigate({Start-Process $_.Uri.AbsoluteUri});$null=$info.Inlines.Add($link)} else {$null=$info.Inlines.Add($run)}
    }
    $null=$about.Children.Add($info);$null=$about.Children.Add((UI-Text ("Day 001 · Codex Usage Monitor Scripts`nv"+$script:defaults.version) 11 '#a5e4ce'))
    $note=UI-Text (T 'source_note') 11 '#99aeaa';$note.Margin='0,16,0,8';$null=$about.Children.Add($note);$null=$about.Children.Add((UI-Text (T 'reset_provider') 10 '#99aeaa'));UI-Link $about 'Data from Codex Resets ↗' 'https://codex-resets.com/'
    $w.Content=$root;$script:settingsRoot=$root;$script:settingsPages=$pages;$script:buildingSettings=$false;Sync-Fields;Update-StylePreviews
    $script:settingsNav.settings.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Primitives.ButtonBase]::ClickEvent)))
}
function Show-Settings {
    Load-UI
    if (-not $script:settingsWindow) {
        $w=New-Object Windows.Window;$w.Title='Codex Usage Monitor';$w.Background=Brush '#101617';$w.Foreground=Brush '#edf4f1';$w.WindowStartupLocation='CenterScreen'
        $w.Resources= [Windows.Markup.XamlReader]::Parse([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Theme.xaml')))
        $w.Icon=New-Object Windows.Media.Imaging.BitmapImage([Uri](Join-Path $script:root 'assets\gp-chan-face.png'))
        $w.Width=[Math]::Min(856,[Windows.SystemParameters]::WorkArea.Width-34);$w.Height=[Math]::Min(759,[Windows.SystemParameters]::WorkArea.Height-40);$w.MinWidth=[Math]::Min(776,$w.Width);$w.MinHeight=[Math]::Min(609,$w.Height)
        $script:settingsWindow=$w;$script:report.settingsOpened=$true;Build-SettingsContent
        $w.Add_Closed({if ($script:previews) {foreach ($entry in $script:previews.Values) {$entry.card.window.Close()}};$script:settingsWindow=$null;$script:settingsSized=$false;$script:previews=$null})
    }
    $w=$script:settingsWindow;$w.Show();$w.UpdateLayout();Sync-PetAvailability
    if (-not $script:settingsSized) {$w.Width+=([Math]::Min(840,[Windows.SystemParameters]::WorkArea.Width-50)-$script:settingsRoot.ActualWidth);$w.Height+=([Math]::Min(720,[Windows.SystemParameters]::WorkArea.Height-60)-$script:settingsRoot.ActualHeight);$script:settingsSized=$true;$w.UpdateLayout()}
    $w.Topmost=$true;$null=$w.Activate();$w.Topmost=$false
    $hwnd=(New-Object Windows.Interop.WindowInteropHelper($w)).Handle
    [UsageScripts.Desktop]::DarkTitleBar($hwnd);$null=[UsageScripts.Desktop]::SetForegroundWindow($hwnd)
}
