param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$env:WORKLOG_DISABLE_UPDATE_CHECK='1'
if($env:WORKLOG_QA_EMAIL-notmatch'^qa-[a-f0-9-]{36}@worklog\.test$'-or-not$env:WORKLOG_QA_PASSWORD){throw 'A disposable QA account is required.'}
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('worklog-session-'+[Guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'profile'
. (Join-Path $PSScriptRoot 'Runtime.ps1') -LoadOnly
$checks=New-Object 'Collections.Generic.List[string]'
$client=New-Object WorklogScripts.Client($appRoot,$env:WORKLOG_SCRIPTS_HOME,$false)
function Assert($value,$name){if(-not$value){throw $name};$checks.Add($name)}
function Start-Ready([bool]$signedIn){
 & (Join-Path $PSScriptRoot 'Launch.ps1')
 $deadline=[DateTime]::UtcNow.AddSeconds(35);$status=$null
 do {Start-Sleep -Milliseconds 150;try{$status=Get-Content -LiteralPath (Join-Path $env:WORKLOG_SCRIPTS_HOME 'status.json') -Raw|ConvertFrom-Json}catch{$status=$null}}while(($null-eq$status-or-not$status.ready-or$status.busy-or$status.signedIn-ne$signedIn-or($signedIn-and-not$status.status))-and[DateTime]::UtcNow-lt$deadline)
 Assert ($null-ne$status-and$status.ready-and-not$status.busy-and$status.signedIn-eq$signedIn-and(-not$signedIn-or!!$status.status)) ('actual app process starts '+$(if($signedIn){'signed in with a server snapshot'}else{'signed out'}))
 return $status
}
function Stop-App {& (Join-Path $PSScriptRoot 'Control.ps1') -Action stop}
$report=@{passed=$false;environment='production Firebase, disposable QA account';interaction='real detached Windows PowerShell app processes, private test profile';checks=$checks;output=$OutputDirectory}
try {
 $null=$client.Login($env:WORKLOG_QA_EMAIL,$env:WORKLOG_QA_PASSWORD).GetAwaiter().GetResult()
 Assert ($client.Store.Read('session')-ne$null) 'successful login persists an encrypted session'
 $saved=$client.Store.Read('session');$saved['expiresAt']=0;$client.Store.Save('session',$saved)
 $client.Dispose()
 $first=Start-Ready $true
 Assert (($client.Store.Read('session')).expiresAt-gt[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) 'expired ID token is refreshed after a new process restores the DPAPI session'
 Stop-App
 $second=Start-Ready $true
 Assert ($first.pid-ne$second.pid) 'login survives exit and restart in a different app process'
 Stop-App
 $account=$client.Store.Read('account')
 Assert ($account.email-eq$env:WORKLOG_QA_EMAIL-and$account.Count-eq1) 'remembered account contains only the last successful email'
 $bytes=[IO.File]::ReadAllBytes((Join-Path $env:WORKLOG_SCRIPTS_HOME 'account.bin'))
 Assert (-not[Text.Encoding]::UTF8.GetString($bytes).Contains($env:WORKLOG_QA_EMAIL)) 'the remembered email is encrypted on disk'
 $client=New-Object WorklogScripts.Client($appRoot,$env:WORKLOG_SCRIPTS_HOME,$false)
 $client.Logout();$client.Dispose()
 Assert (-not(Test-Path -LiteralPath (Join-Path $env:WORKLOG_SCRIPTS_HOME 'session.bin'))) 'logout removes the persistent session'
 Assert ($client.RememberedEmail-eq$env:WORKLOG_QA_EMAIL) 'logout preserves only the email for the next login'
 $null=Start-Ready $false
 Assert (-not(Test-Path -LiteralPath (Join-Path $env:WORKLOG_SCRIPTS_HOME 'session.bin'))) 'a process restarted after logout cannot restore authentication'
 $report.passed=$true
} catch {$report.error=$_.Exception.Message;throw}
finally {try{Stop-App}catch{};$client.Dispose();$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $OutputDirectory 'session-verification.json') -Encoding UTF8}
$report|ConvertTo-Json -Depth 6
