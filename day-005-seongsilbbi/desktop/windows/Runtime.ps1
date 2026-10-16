param([switch]$Emulator,[switch]$SelfTest,[switch]$LoadOnly,[switch]$FixtureLogin)
$ErrorActionPreference='Stop'
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$profile=if($env:WORKLOG_SCRIPTS_HOME){[IO.Path]::GetFullPath($env:WORKLOG_SCRIPTS_HOME)}else{Join-Path $env:LOCALAPPDATA ('DailyOddBuilds/Worklog/'+$(if($Emulator){'emulator'}else{'production'}))}
$null=New-Item -ItemType Directory -Path (Join-Path $profile 'commands') -Force
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Xaml,System.Windows.Forms,System.Drawing,System.Net.Http,System.Security,System.Web.Extensions
$names=@('System','System.Core','System.Net.Http','System.Security','System.Web.Extensions','System.Xaml','WindowsBase','PresentationCore','PresentationFramework','System.Windows.Forms','System.Drawing')
$references=@([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object {$_.GetName().Name -in $names} | ForEach-Object {$_.Location} | Sort-Object -Unique)
Add-Type -Path (Join-Path $PSScriptRoot 'Client.cs'),(Join-Path $PSScriptRoot 'Panel.cs'),(Join-Path $PSScriptRoot 'Settings.cs'),(Join-Path $PSScriptRoot 'Startup.cs') -ReferencedAssemblies $references
if($LoadOnly){return}
$client=New-Object WorklogScripts.Client($appRoot,$profile,[bool]$Emulator)
if($FixtureLogin){if($env:WORKLOG_QA_EMAIL -notmatch '^qa-[a-f0-9-]{36}@worklog\.test$'){throw 'An explicit disposable QA fixture is required.'};try{$null=$client.Login($env:WORKLOG_QA_EMAIL,$env:WORKLOG_QA_PASSWORD).GetAwaiter().GetResult();'Disposable QA session prepared.'}finally{$client.Dispose()};exit}
if($SelfTest){
 try {
  if($env:WORKLOG_QA_EMAIL -notmatch '^qa-[a-f0-9-]{36}@worklog\.test$'){throw 'An explicit disposable QA fixture is required.'}
  $null=$client.Login($env:WORKLOG_QA_EMAIL,$env:WORKLOG_QA_PASSWORD).GetAwaiter().GetResult()
  $session=$client.Session;$session['expiresAt']=0;$client.Store.Save('session',$session)
  $null=$client.Restore().GetAwaiter().GetResult()
  $baseline=[WorklogScripts.Json]::Number([WorklogScripts.Json]::Map($client.Snapshot,'state'),'revision')
  $observer=New-Object WorklogScripts.Client($appRoot,($profile+'-observer'),[bool]$Emulator)
  $null=$observer.Login($env:WORKLOG_QA_EMAIL,$env:WORKLOG_QA_PASSWORD).GetAwaiter().GetResult()
  foreach($action in @('clockIn','pause','resume','clockOut','clockIn','pause','resume','clockOut')){$null=$client.Command($action,$null).GetAwaiter().GetResult();Start-Sleep -Milliseconds 40}
  $deadline=[DateTime]::UtcNow.AddSeconds(25)
  while([WorklogScripts.Json]::Number([WorklogScripts.Json]::Map($observer.Snapshot,'state'),'revision') -ne ($baseline+8) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200}
  if([WorklogScripts.Json]::Number([WorklogScripts.Json]::Map($observer.Snapshot,'state'),'revision') -ne ($baseline+8)){throw 'Cross-client SSE synchronization failed.'}
  if([WorklogScripts.Json]::Text([WorklogScripts.Json]::Map($client.Snapshot,'state'),'status') -ne 'off'){throw 'Final state was not off.'}
  $client.Logout();$observer.Logout();$observer.Dispose()
  [WorklogScripts.Json]::Write(@{passed=$true;environment=$(if($Emulator){'emulator'}else{'production'});runtime='Windows PowerShell 5.1 / .NET Framework';checks=@('login','DPAPI restore','token refresh','eight transitions','cross-client SSE')})
 } finally {$client.Dispose()}
 exit
}
$sha=[Security.Cryptography.SHA256]::Create();$identity=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($profile.ToLowerInvariant())))).Replace('-','')
$mutex=New-Object Threading.Mutex($false,('Local\WorklogScripts-'+$identity))
if(-not $mutex.WaitOne(0)) {& (Join-Path $PSScriptRoot 'Control.ps1') -Action show;exit}
try {
 $application=New-Object Windows.Application;$application.ShutdownMode='OnExplicitShutdown'
 $window=New-Object WorklogScripts.Panel($client,$appRoot,$profile)
 $window.Show();$null=$application.Run()
} catch { [IO.File]::WriteAllText((Join-Path $profile 'startup-error.txt'),'Worklog could not start. Run Diagnose.cmd for the stage and error type.');throw }
finally{$client.Dispose();$mutex.ReleaseMutex();$mutex.Dispose()}
