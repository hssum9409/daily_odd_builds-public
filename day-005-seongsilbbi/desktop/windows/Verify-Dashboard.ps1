param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
if($env:WORKLOG_QA_EMAIL-notmatch'^qa-[a-f0-9-]{36}@worklog\.test$'-or-not$env:WORKLOG_QA_PASSWORD){throw 'A disposable QA account is required.'}
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('worklog-dashboard-'+[Guid]::NewGuid().ToString('N'))}
$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'profile'
. (Join-Path $PSScriptRoot 'Runtime.ps1') -LoadOnly
$client=New-Object WorklogScripts.Client($appRoot,$env:WORKLOG_SCRIPTS_HOME,$false)
try {
 if($client.DashboardLink().GetAwaiter().GetResult()-ne$client.Dashboard){throw 'Signed-out dashboard changed'}
 $client.Login($env:WORKLOG_QA_EMAIL,$env:WORKLOG_QA_PASSWORD).GetAwaiter().GetResult()
 $client.Session['expiresAt']=0
 $url=$client.DashboardLink().GetAwaiter().GetResult()
 $parsed=[Uri]$url
 if($parsed.Fragment-notmatch'^#desktop-login=[A-Za-z0-9_-]{43}$'-or$parsed.Query){throw 'Dashboard link format mismatch'}
 # Private fixture consumed by a browser verifier; never print the capability.
 @{url=$url;uid=[WorklogScripts.Json]::Text($client.Session,'uid')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $OutputDirectory 'browser-fixture.json') -Encoding UTF8
 @{passed=$true;runtime='actual Windows PowerShell 5.1 client';signedOutUsesPlainURL=$true;signedInUsesSingleUseFragment=$true;expiredTokenRefreshed=$true;output=$OutputDirectory}|ConvertTo-Json
} finally {$client.Dispose()}
