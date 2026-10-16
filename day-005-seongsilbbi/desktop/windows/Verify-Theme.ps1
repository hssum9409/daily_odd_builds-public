param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$env:WORKLOG_DISABLE_UPDATE_CHECK='1'
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('worklog-theme-'+[Guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'compile-profile'
. (Join-Path $PSScriptRoot 'Runtime.ps1') -LoadOnly
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$app=New-Object Windows.Application
$app.ShutdownMode='OnExplicitShutdown'
$flags=[Reflection.BindingFlags]'Instance,NonPublic,DeclaredOnly'
$checks=New-Object 'Collections.Generic.List[string]'
$window=$null
function Field($name){$window.GetType().GetField($name,$flags).GetValue($window)}
function Call($name,$arguments=@()){$window.GetType().GetMethod($name,$flags).Invoke($window,$arguments)}
function Pump([int]$milliseconds=220){
 $frame=New-Object Windows.Threading.DispatcherFrame
 $timer=New-Object Windows.Threading.DispatcherTimer
 $timer.Interval=[TimeSpan]::FromMilliseconds($milliseconds)
 $timer.Add_Tick({$frame.Continue=$false;$timer.Stop()}.GetNewClosure())
 $timer.Start();[Windows.Threading.Dispatcher]::PushFrame($frame)
}
function Assert($value,[string]$name){if(-not$value){throw $name};$checks.Add($name)}
function Glyph($text){$face=New-Object Windows.Media.Typeface($text.FontFamily,$text.FontStyle,$text.FontWeight,$text.FontStretch);$result=$null;if(-not$face.TryGetGlyphTypeface([ref]$result)){throw 'Font fallback was used'};return $result}
function Close-Case {
 if($script:window){$script:window.GetType().GetField('exiting',$flags).SetValue($script:window,$true);$script:window.Close();$script:window=$null}
}
function New-Case([string]$name,$saved=$null){
 Close-Case
 $profile=Join-Path $OutputDirectory $name
 $null=New-Item -ItemType Directory -Path (Join-Path $profile 'commands') -Force
 $script:client=New-Object WorklogScripts.Client($appRoot,$profile,$false)
 if($saved){$script:client.Store.Save('panel',$saved)}
 $script:window=New-Object WorklogScripts.Panel($script:client,$appRoot,$profile)
 $script:window.Show();Pump
 (Field 'tick').Stop()
 $null=Call 'SetHovered' @($true);Pump
}
function Paint([string]$state){
 $now=$client.Now;$date=[WorklogScripts.Client]::DateKey($now,'Asia/Seoul')
 $work=@{id='work';kind='work';start=$now-12258000;end=$null;deletedAt=$null;title=''}
 $rest=@{id='rest';kind='break';start=$now-726000;end=$null;deletedAt=$null;title=''}
 $segments=@();$segmentId=$null
 if($state-eq'working'){$segments=@($work);$segmentId='work'}
 if($state-eq'resting'){$work.start=$now-12984000;$work.end=$rest.start;$segments=@($work,$rest);$segmentId='rest'}
 $day=@{date=$date;segments=$segments;clockedOutAt=$null}
 $data=@{state=@{status=$(if($state-eq'resting'){'break'}elseif($state-eq'working'){'working'}else{'idle'});revision=0;timeZone='Asia/Seoul';dayId=$date;segmentId=$segmentId};days=@($day);activeDay=$day}
 $client.Snapshot=[WorklogScripts.Json]::Read([WorklogScripts.Json]::Write($data));$null=Call 'Render';$window.UpdateLayout()
 # Timeline width is measured after layout, then painted at the settled size.
 $null=Call 'Render';$window.UpdateLayout()
}
function Capture([string]$name,[Windows.Window]$target=$window,[int]$scale=1){
 $bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap([int][Math]::Ceiling(($target.ActualWidth*$scale)),[int][Math]::Ceiling(($target.ActualHeight*$scale)),(96*$scale),(96*$scale),[Windows.Media.PixelFormats]::Pbgra32)
 $bitmap.Render($target);$encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder
 $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
 $file=[IO.File]::Create((Join-Path $OutputDirectory ($name+'.png')))
 try{$encoder.Save($file)}finally{$file.Dispose()};if($scale-eq1){Capture ($name+'-detail') $target 3}
}
function Descendants($parent){foreach($child in [Windows.LogicalTreeHelper]::GetChildren($parent)){if($child-is[Windows.DependencyObject]){$child;Descendants $child}}}
function Capture-DesignDetails([string]$name){$scroll=Descendants (Field 'preferences')|Where-Object{$_-is[Windows.Controls.ScrollViewer]-and$_.IsVisible}|Select-Object -First 1;$scroll.ScrollToBottom();Pump;Capture $name (Field 'preferences')}
function Select-Theme([string]$name){$null=Call 'Settings';(Field 'qaTheme').Invoke($name);Pump;$window.UpdateLayout()}
$report=@{passed=$false;runtime='Windows PowerShell 5.1 / WPF';networkUsed=$false;interaction='Native WPF windows and controls, routed programmatic selection; synthetic local records; no OS pointer automation';output=$OutputDirectory;checks=$checks}
try {
 New-Case 'fresh'
 Assert ((Field 'theme')-eq'cream' -and (Field 'color')-eq'#F5F1E8') 'fresh install defaults to cream'
 Assert ((Field 'firstStart')-and$client.Session-eq$null) 'signed out widget shows start greeting'
 (Field 'welcome').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)));Pump
 Assert ((Field 'preferences').IsVisible-and(Field 'settingsSelection')-eq'login') 'signed out start prioritizes login'
 Capture 'settings-login' (Field 'preferences')
 (Field 'settingsPage').Invoke('design');Pump;Capture 'settings-design' (Field 'preferences')
 Assert ((Field 'settingsSelection')-eq'design') 'design tab is available without login';Capture-DesignDetails 'settings-design-controls'
 (Field 'settingsPage').Invoke('creator');Pump;Capture 'settings-creator' (Field 'preferences')
 Assert ((Field 'settingsSelection')-eq'creator') 'creator tab is available without login'
 (Field 'preferences').Close();Pump
 Paint 'greeting';Capture 'theme-cream-greeting'
 Assert ((Field 'firstStart')-and(Field 'card').Child-eq(Field 'welcome')) 'whole-card greeting remains the first-start action'
 $korean=Glyph (Field 'welcomeTitle')
 Assert ($korean.FontUri.AbsoluteUri.IndexOf('NanumSquareRoundEB.ttf',[StringComparison]::OrdinalIgnoreCase)-ge0-and@(('안녕하세요업무시작'.ToCharArray())|Where-Object{-not$korean.CharacterToGlyphMap.ContainsKey([int]$_)}).Count-eq0) 'bundled rounded Korean font covers greeting and start labels'
 Paint 'working';Capture 'theme-cream-working';$numerals=Glyph (Field 'clock')
 Assert ($numerals.FontUri.AbsoluteUri.IndexOf('Nunito-ExtraBold.ttf',[StringComparison]::OrdinalIgnoreCase)-ge0) 'work clock uses bundled extra-bold rounded numerals'
 Paint 'resting';Capture 'theme-cream-resting'
 $clock=Field 'clock';$toggle=Field 'toggle'
 Assert ($clock.ActualWidth+$clock.TransformToAncestor((Field 'card')).Transform((New-Object Windows.Point(0,0))).X -le $toggle.TransformToAncestor((Field 'card')).Transform((New-Object Windows.Point(0,0))).X) 'rest clocks fit without overlapping the toggle'
 $face=New-Object Windows.Media.Typeface($clock.FontFamily,$clock.FontStyle,$clock.FontWeight,$clock.FontStretch);$glyph=$null
 Assert ($face.TryGetGlyphTypeface([ref]$glyph)-and$glyph.FontUri.AbsoluteUri.IndexOf('Nunito-Bold.ttf',[StringComparison]::OrdinalIgnoreCase)-ge0) 'bundled rounded font actually loads'
 Assert ((Field 'toggle').Content.GetType().Name-eq'ToggleGlyph') 'pause and resume use drawn shapes'
 Assert ((Field 'workBars')-eq1-and(Field 'restBars')-eq1-and(Field 'progress')-eq1) 'ratio timeline stays full and contains work and rest'
 $client.Snapshot['state']['dailyGoalMs']=28800000;$null=Call 'Render'
 Assert ([Math]::Abs((Field 'progress')-12258000/28800000)-lt.001) 'goal timeline counts work only'
 Select-Theme 'dark'
 Assert ((Field 'theme')-eq'dark'-and(Field 'color')-eq'#292C29') 'settings control applies charcoal dark theme'
 foreach($state in @('greeting','working','resting')){Paint $state;Capture ('theme-dark-'+$state)}
 $null=Call 'OpenSettings' @('design');Pump;Capture 'settings-design-dark' (Field 'preferences');Capture-DesignDetails 'settings-design-controls-dark';(Field 'preferences').Close();Pump
 $stored=$client.Store.Read('panel')
 Assert ($stored.theme-eq'dark'-and$stored.opacityIdle-eq.45-and$stored.opacityHover-eq.95) 'theme selection preserves both opacity preferences'
 $null=Call 'SetHovered' @($false);Pump
 Assert ([Math]::Abs((Field 'surface').Opacity-.45)-lt.002) 'idle opacity is applied to the whole widget'
 $null=Call 'SetHovered' @($true);Pump
 Assert ([Math]::Abs((Field 'surface').Opacity-.95)-lt.002) 'hover opacity is applied to the whole widget'
 New-Case 'restore' $stored
 Assert ((Field 'theme')-eq'dark'-and(Field 'color')-eq'#292C29') 'dark theme restores in a new native window'
 $null=Call 'Settings';(Field 'qaCustomize').Invoke();Pump
 $custom=$client.Store.Read('panel')
 Assert ($custom.theme-eq'custom'-and$custom.color-eq'#DDE8DC') 'editing a preset creates a persistent custom palette'
 New-Case 'custom-restore' $custom
 Assert ((Field 'theme')-eq'custom'-and(Field 'color')-eq'#DDE8DC') 'custom palette restores'
 $null=Call 'Settings';(Field 'qaDefaults').Invoke();Pump
 Assert ((Field 'theme')-eq'cream'-and(Field 'color')-eq'#F5F1E8') 'reset returns to cream'
 New-Case 'legacy-default' @{color='#FF202020';text='#FFF8F8F8';opacityIdle=.3;opacity=.8}
 Assert ((Field 'theme')-eq'cream'-and(Field 'idleAlpha')-eq.3-and(Field 'hoverAlpha')-eq.8) 'old untouched ARGB defaults migrate while preserving opacity'
 New-Case 'legacy-custom' @{color='#FFCBD8E2';text='#FF102030';autoText=$false}
 Assert ((Field 'theme')-eq'custom'-and(Field 'color')-eq'#CBD8E2'-and(Field 'ink')-eq'#102030') 'old custom ARGB colors are preserved'
 $report.passed=$true
} catch {$report.error=$_.Exception.Message;throw}
finally {Close-Case;$app.Shutdown();$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $OutputDirectory 'theme-verification.json') -Encoding UTF8}
$report|ConvertTo-Json -Depth 6
