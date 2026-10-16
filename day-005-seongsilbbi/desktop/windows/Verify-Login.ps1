param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
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
$report=@{passed=$false;environment='production Firebase, disposable QA account';interaction='Native WPF controls with routed Click events; no OS pointer automation';checks=$checks;output=$OutputDirectory}
try {
 $window.Show();Wait-Idle
 Assert ((Field 'firstStart')-and$client.Session-eq$null) 'signed-out native widget is the start greeting'
 Click 'welcome'
 Assert ((Field 'settingsSelection')-eq'login'-and(Field 'startAfterLogin')) 'start action selects login and preserves the requested start'
 (Field 'settingsPage').Invoke('creator');(Field 'settingsPage').Invoke('design');Click 'welcome'
 Assert ((Field 'settingsSelection')-eq'login') 'a repeated start returns from design to login'
 Login-Form $true
 Assert ($client.Session-eq$null-and(Field 'preferences').IsVisible-and(Field 'message')-ne'') 'failed login keeps the login form and shows feedback'
 Login-Form
 $state=[WorklogScripts.Json]::Map($client.Snapshot,'state')
 Assert ($client.Session-ne$null-and$state.status-eq'working'-and$state.revision-eq1) 'successful login carries the requested start to Firebase exactly once'
 Assert ((Field 'preferences')-eq$null-and-not(Field 'firstStart')) 'successful start returns to the tracking widget'
 $null=Call 'Logout';Click 'welcome';Login-Form
 $state=[WorklogScripts.Json]::Map($client.Snapshot,'state')
 Assert ($state.status-eq'working'-and$state.revision-eq1) 'login with an already active session does not duplicate clock-in'
 Click 'toggle'
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'break') 'drawn pause button reaches the break state'
 $clock=(Field 'clock').Text;Pump 650
 Assert ((Field 'clock').Text.Split('/')[0]-eq$clock.Split('/')[0]) 'work total stays frozen during the break'
 Click 'toggle'
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'working') 'drawn resume button returns to work'
 (Field 'finish').RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.MenuItem]::ClickEvent)));Wait-Idle
 Assert (([WorklogScripts.Json]::Map($client.Snapshot,'state')).status-eq'off') 'finish closes the active work session'
 $null=Call 'Logout';$null=Call 'Settings';Login-Form
 $state=[WorklogScripts.Json]::Map($client.Snapshot,'state')
 Assert ($state.status-eq'off'-and$state.revision-eq4) 'login opened from settings does not start work automatically'
 $client.Logout();$report.passed=$true
} catch {$report.error=$_.Exception.Message;throw}
finally {$window.GetType().GetField('exiting',$flags).SetValue($window,$true);$window.Close();$app.Shutdown();$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $OutputDirectory 'login-verification.json') -Encoding UTF8}
$report|ConvertTo-Json -Depth 6
