param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$env:WORKLOG_DISABLE_STARTUP_PROMPT='1'
$env:WORKLOG_DISABLE_UPDATE_CHECK='1'
if($env:WORKLOG_QA_EMAIL-notmatch'^qa-[a-f0-9-]{36}@worklog\.test$'-or-not$env:WORKLOG_QA_PASSWORD){throw 'A disposable QA account is required.'}
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('worklog-login-ui-'+[Guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'profile'
. (Join-Path $PSScriptRoot 'Runtime.ps1') -LoadOnly
$app=New-Object Windows.Application;$app.ShutdownMode='OnExplicitShutdown'
$client=New-Object WorklogScripts.Client($appRoot,$env:WORKLOG_SCRIPTS_HOME,$false)
$window=New-Object WorklogScripts.Panel($client,$appRoot,$env:WORKLOG_SCRIPTS_HOME)
$flags=[Reflection.BindingFlags]'Instance,NonPublic,DeclaredOnly'
$checks=New-Object 'Collections.Generic.List[string]'
function Field($name){$window.GetType().GetField($name,$flags).GetValue($window)}
function Call($name){$window.GetType().GetMethod($name,$flags).Invoke($window,@())}
function Pump([int]$milliseconds=100){$frame=New-Object Windows.Threading.DispatcherFrame;$timer=New-Object Windows.Threading.DispatcherTimer;$timer.Interval=[TimeSpan]::FromMilliseconds($milliseconds);$timer.Add_Tick({$frame.Continue=$false;$timer.Stop()}.GetNewClosure());$timer.Start();[Windows.Threading.Dispatcher]::PushFrame($frame)}
function Wait-Idle {$deadline=[DateTime]::UtcNow.AddSeconds(35);do{Pump}while((Field 'busy')-and[DateTime]::UtcNow-lt$deadline);if(Field 'busy'){throw 'Native UI request timed out'}}
function Assert($value,$name){if(-not$value){throw $name};$checks.Add($name)}
function Click($name){(Field $name).RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)));Wait-Idle}
function Login-Form([bool]$invalid=$false){(Field 'loginEmail').Text=$env:WORKLOG_QA_EMAIL;(Field 'loginPassword').Password=$(if($invalid){[Guid]::NewGuid().ToString()}else{$env:WORKLOG_QA_PASSWORD});Click 'loginSubmit'}
function Check-InputFocus {
 $dialog=Field 'preferences';$dialog.Activate()|Out-Null;Pump
 foreach($name in @('loginEmail','loginPassword')){
  $input=Field $name;$input.ApplyTemplate()|Out-Null
  [Windows.Input.Keyboard]::Focus($dialog)|Out-Null
  $hostPart=$input.Template.FindName('PART_ContentHost',$input)
  $mouse=New-Object Windows.Input.MouseButtonEventArgs([Windows.Input.Mouse]::PrimaryDevice,0,[Windows.Input.MouseButton]::Left)
  $mouse.RoutedEvent=[Windows.UIElement]::PreviewMouseDownEvent
  $hostPart.RaiseEvent($mouse)
  Assert $input.IsKeyboardFocused ($name+' receives keyboard focus from the template content mouse event')
  Pump 650
  Assert $input.IsKeyboardFocused ($name+' retains focus through a status refresh; active='+$dialog.IsActive+' focused='+[Windows.Input.Keyboard]::FocusedElement.GetType().Name)
 }
 [Windows.Input.Keyboard]::Focus((Field 'loginEmail'))|Out-Null
 (Field 'loginEmail').MoveFocus((New-Object Windows.Input.TraversalRequest([Windows.Input.FocusNavigationDirection]::Next)))|Out-Null
 Assert (Field 'loginPassword').IsKeyboardFocused 'Tab moves from email to password'
 (Field 'loginPassword').MoveFocus((New-Object Windows.Input.TraversalRequest([Windows.Input.FocusNavigationDirection]::Next)))|Out-Null
 Assert (Field 'loginSubmit').IsKeyboardFocused 'Tab moves from password to submit'
}
$report=@{passed=$false;environment='production Firebase, disposable QA account';interaction='Native WPF controls with routed Click events; no OS pointer automation';checks=$checks;output=$OutputDirectory}
try {
 $window.Show();Wait-Idle
 Assert ((Field 'firstStart')-and$client.Session-eq$null) 'signed-out native widget is the start greeting'
 Click 'welcome'
 Assert ((Field 'settingsSelection')-eq'login'-and(Field 'startAfterLogin')) 'start action selects login and preserves the requested start'
 Assert (Field 'loginEmail').IsKeyboardFocused 'first login automatically focuses the empty email field'
 Check-InputFocus
 (Field 'settingsPage').Invoke('creator');(Field 'settingsPage').Invoke('design');Click 'welcome'
 Assert ((Field 'settingsSelection')-eq'login') 'a repeated start returns from design to login'
 Login-Form $true
 Assert ($client.Session-eq$null-and(Field 'preferences').IsVisible-and(Field 'message')-ne'') 'failed login keeps the login form and shows feedback'
 Assert ($client.RememberedEmail-eq'') 'a failed login does not remember an unverified address'
 Login-Form
 $state=[WorklogScripts.Json]::Map($client.Snapshot,'state')
 Assert ($client.Session-ne$null-and$state.status-eq'working'-and$state.revision-eq1) ('successful login carries the requested start to Firebase exactly once; status='+$state.status+' revision='+$state.revision+' feedback='+(Field 'message'))
 Assert ((Field 'preferences').IsVisible-and-not(Field 'firstStart')) 'successful login starts tracking and keeps settings open'
 Assert (Field 'clockOut').IsVisible 'working widget exposes a separate clock-out button'
 (Field 'settingsPage').Invoke('design');Pump
 Assert ((Field 'preferences').IsVisible-and(Field 'settingsSelection')-eq'design') 'design remains accessible after login while tracking continues'
 $workBefore=[WorklogScripts.Json]::Number([WorklogScripts.Json]::Map($client.Snapshot,'state'),'revision');$hiddenClock=(Field 'clock').Text;Click 'hideWidget';Pump 1200
 Assert (-not$window.IsVisible-and([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'working') 'top-left X hides to tray without clocking out'
 Assert ((Field 'clock').Text-ne$hiddenClock) 'work clock keeps ticking while hidden in tray'
 $null=Call 'ShowPanel';Click 'openPreferences'
 Assert ((Field 'preferences').IsVisible-and([WorklogScripts.Json]::Map($client.Snapshot,'state')).revision-eq$workBefore) 'settings icon opens settings without changing the running timer'
 Assert ($client.RememberedEmail-eq$env:WORKLOG_QA_EMAIL) 'successful login remembers the email in DPAPI storage'
 $null=Call 'Logout';Click 'welcome';Login-Form
 $state=[WorklogScripts.Json]::Map($client.Snapshot,'state')
 Assert ($state.status-eq'working'-and$state.revision-eq1) 'login with an already active session does not duplicate clock-in'
 Click 'toggle'
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'break') 'drawn pause button reaches the break state'
 $clock=(Field 'clock').Text;Pump 650
 Assert ((Field 'clock').Text.Split('/')[0]-eq$clock.Split('/')[0]) 'work total stays frozen during the break'
 Click 'toggle'
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'working') 'drawn resume button returns to work'
 Click 'clockOut'
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'off') 'right-side clock-out button closes the active work session'
 Assert ((Field 'afterWork')-and(Field 'quitButton').IsVisible-and-not(Field 'clockOut').IsVisible) 'completed widget shows restart card and a separate tray-hide button'
 Assert ((Field 'greeting').Text-eq'다시 시작하시나요? 얼마든지요!') 'completed widget uses the requested restart greeting'
 $null=Call 'Logout';$null=Call 'Settings';Pump
 Assert ((Field 'loginEmail').Text-eq$env:WORKLOG_QA_EMAIL-and(Field 'loginPassword').Password-eq'') 'logout keeps the remembered email and leaves the password blank'
 Assert (Field 'loginPassword').IsKeyboardFocused 'remembered email automatically focuses the empty password field'
 Check-InputFocus
 Login-Form
 $state=[WorklogScripts.Json]::Map($client.Snapshot,'state')
 Assert ($state.status-eq'off'-and$state.revision-eq4) 'login opened from settings does not start work automatically'
 Click 'welcome'
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'working'-and-not(Field 'afterWork')) 'completed-day welcome restarts work without resetting the day'
 Click 'clockOut'
 (Field 'quitButton').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
 Assert (-not$window.IsVisible-and-not(Field 'exiting')) 'completed-day red X hides to tray without exiting'
 $client.Logout();$report.passed=$true
} catch {$report.error=$_.Exception.Message;throw}
finally {$window.GetType().GetField('exiting',$flags).SetValue($window,$true);$window.Close();$app.Shutdown();$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $OutputDirectory 'login-verification.json') -Encoding UTF8}
$report|ConvertTo-Json -Depth 6
