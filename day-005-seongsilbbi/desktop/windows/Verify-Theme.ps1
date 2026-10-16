param([string]$OutputDirectory,[switch]$Media)
$ErrorActionPreference='Stop'
$env:WORKLOG_DISABLE_STARTUP_PROMPT='1'
$env:WORKLOG_DISABLE_UPDATE_CHECK='1'
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('worklog-theme-'+[Guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'compile-profile'
. (Join-Path $PSScriptRoot 'Runtime.ps1') -LoadOnly
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class WorklogBrandingProbe {
 [DllImport("shell32.dll")]static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr appId);
 [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr wparam,IntPtr lparam);
 public static string AppId(){IntPtr p;Marshal.ThrowExceptionForHR(GetCurrentProcessExplicitAppUserModelID(out p));try{return Marshal.PtrToStringUni(p);}finally{Marshal.FreeCoTaskMem(p);}}
 public static bool WindowIcons(IntPtr window){return SendMessage(window,0x7f,new IntPtr(0),IntPtr.Zero)!=IntPtr.Zero&&SendMessage(window,0x7f,new IntPtr(1),IntPtr.Zero)!=IntPtr.Zero;}
}
'@
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
 if($state-eq'completed'){$work.end=$now;$segments=@($work)}
 if($state-eq'working'){$segments=@($work);$segmentId='work'}
 if($state-eq'resting'){$work.start=$now-12984000;$work.end=$rest.start;$segments=@($work,$rest);$segmentId='rest'}
 $day=@{date=$date;segments=$segments;clockedOutAt=$null}
 $data=@{state=@{status=$(if($state-eq'resting'){'break'}elseif($state-eq'working'){'working'}elseif($state-eq'completed'){'off'}else{'idle'});revision=0;timeZone='Asia/Seoul';dayId=$date;segmentId=$segmentId};days=@($day);activeDay=$day}
 $client.Snapshot=[WorklogScripts.Json]::Read([WorklogScripts.Json]::Write($data));$null=Call 'Render';$window.UpdateLayout()
 # Timeline width is measured after layout, then painted at the settled size.
 $null=Call 'Render';$window.UpdateLayout()
}
function Capture([string]$name,[Windows.Window]$target=$window,[int]$scale=1){
 if($Media-and$target-eq$window){$null=Call 'SetHovered' @($true);Pump;$surface=Field 'surface';$surface.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$surface.Opacity=Field 'hoverAlpha'}
 $visual=if($Media){$target.Content}else{$target};$visual.UpdateLayout()
 $bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap([int][Math]::Ceiling(($visual.ActualWidth*$scale)),[int][Math]::Ceiling(($visual.ActualHeight*$scale)),(96*$scale),(96*$scale),[Windows.Media.PixelFormats]::Pbgra32)
 if($Media){$backdrop=New-Object Windows.Media.DrawingVisual;$drawing=$backdrop.RenderOpen();$drawing.DrawRectangle($target.Background,$null,(New-Object Windows.Rect(0,0,$visual.ActualWidth,$visual.ActualHeight)));$drawing.Close();$bitmap.Render($backdrop)}
 $bitmap.Render($visual);$encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder
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
 Assert ($window.Title-eq'성실삐🤖'-and(Field 'preferences').Title-eq'성실삐🤖') 'widget and settings have the product title only'
 Assert ([WorklogBrandingProbe]::AppId()-eq'DailyOddBuilds.Seongsilbbi') 'taskbar process has its own application identity'
 Assert ([WorklogBrandingProbe]::WindowIcons((New-Object Windows.Interop.WindowInteropHelper((Field 'preferences'))).Handle)) 'settings HWND exposes both small and large application icons'
 Assert ($window.Icon-ne$null-and(Field 'tray').Icon-ne$null) 'widget and notification area use the robot icon'
 Capture 'settings-login' (Field 'preferences')
 (Field 'settingsPage').Invoke('design');Pump;Capture 'settings-design' (Field 'preferences')
 Assert ((Field 'settingsSelection')-eq'design') 'design tab is available without login';Capture-DesignDetails 'settings-design-controls'
 (Field 'settingsPage').Invoke('creator');Pump;Capture 'settings-creator' (Field 'preferences')
 Assert ((Field 'settingsSelection')-eq'creator') 'creator tab is available without login'
 (Field 'preferences').Close();Pump
 Paint 'greeting';Capture 'theme-cream-greeting'
 Assert ((Field 'firstStart')-and(Field 'card').Child-eq(Field 'idleBody')) 'whole-card greeting remains the first-start action'
 Assert (-not(Field 'quitButton').IsVisible) 'first start has no separate exit button'
 $korean=Glyph (Field 'welcomeTitle')
 Assert ($korean.FontUri.AbsoluteUri.IndexOf('NanumSquareRoundEB.ttf',[StringComparison]::OrdinalIgnoreCase)-ge0-and@(('안녕하세요업무시작'.ToCharArray())|Where-Object{-not$korean.CharacterToGlyphMap.ContainsKey([int]$_)}).Count-eq0) 'bundled rounded Korean font covers greeting and start labels'
 Paint 'working';Capture 'theme-cream-working';$numerals=Glyph (Field 'clock')
 $bounds=(Field 'hideWidget').TransformToAncestor($window).TransformBounds((New-Object Windows.Rect(0,0,(Field 'hideWidget').ActualWidth,(Field 'hideWidget').ActualHeight)))
 Assert ([Math]::Abs($bounds.Width-22)-lt.01-and[math]::Abs($bounds.Height-22)-lt.01-and(Field 'hideWidget').Content-eq'×'-and(Field 'openPreferences').Content-eq'···') 'original Day 1 HoverPill size and text are preserved'
 $pill=[Windows.Media.VisualTreeHelper]::GetChild((Field 'hideWidget'),0)
 Assert ($pill.Background.Color.ToString()-eq'#FFD7E2D4'-and(Field 'hideWidget').Foreground.Color.ToString()-eq'#FF355B3B') 'Day 1 chrome uses the cream widget palette'
 $header=Field 'headerTools';$surface=Field 'surface';$p=New-Object Windows.Point(0,0)
 Assert (-not$surface.IsAncestorOf($header)-and$header.Opacity-eq1) 'header contrast is independent of widget opacity'
 Assert ((Field 'clockOut').Content-eq'퇴근'-and(Field 'clockOut').ActualWidth-gt(Field 'clockOut').ActualHeight) 'clock-out is a readable text button'
 Assert ((Field 'clockOut').IsVisible-and(Field 'clockOut').TransformToAncestor((Field 'card')).Transform((New-Object Windows.Point(0,0))).X-gt(Field 'toggle').TransformToAncestor((Field 'card')).Transform((New-Object Windows.Point(0,0))).X) 'clock-out button sits to the right of play-pause'
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
 Paint 'completed';Capture 'theme-cream-completed'
 Assert ((Field 'quitButton').Background.Color.ToString()-eq'#FFC85D56'-and(Field 'quitButton').ToolTip-eq'트레이로 숨기기') 'completed-day X uses red background and tray-hide semantics'
 Assert ((Field 'afterWork')-and(Field 'quitButton').IsVisible-and(Field 'greeting').Text-eq'다시 시작하시나요? 얼마든지요!') 'completed day shows restart greeting and separate tray-hide button'
 Select-Theme 'dark'
 Assert ((Field 'theme')-eq'dark'-and(Field 'color')-eq'#292C29') 'settings control applies charcoal dark theme'
 foreach($state in @('greeting','working','resting','completed')){Paint $state;Capture ('theme-dark-'+$state)}
 $null=Call 'OpenSettings' @('design');Pump;Capture 'settings-design-dark' (Field 'preferences');Capture-DesignDetails 'settings-design-controls-dark';(Field 'preferences').Close();Pump
 $stored=$client.Store.Read('panel')
 Assert ($stored.theme-eq'dark'-and$stored.opacityIdle-eq.45-and$stored.opacityHover-eq.95) 'theme selection preserves both opacity preferences'
 $null=Call 'SetHovered' @($false);Pump
 Assert ([Math]::Abs((Field 'surface').Opacity-.45)-lt.002) 'idle opacity is applied to the widget body'
 $null=Call 'SetHovered' @($true);Pump
 Assert ([Math]::Abs((Field 'surface').Opacity-.95)-lt.002) 'hover opacity is applied to the widget body'
 $null=Call 'SetHovered' @($false);Pump
 Assert ((Field 'headerTools').Visibility-eq[Windows.Visibility]::Hidden) 'header tools stay hidden off hover'
 $null=Call 'SetHovered' @($true);Pump
 Assert ((Field 'headerTools').IsVisible-and(Field 'hideWidget').Content-eq'×') 'header tools remain legible in dark mode on hover'
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
