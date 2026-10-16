param([switch]$Live,[switch]$LaunchPanel,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
$env:WORKLOG_DISABLE_UPDATE_CHECK='1'
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('worklog-verify-'+[Guid]::NewGuid().ToString('N'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory);$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'));$base=Join-Path $OutputDirectory 'install 한글 path';$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'profile';$target=Join-Path $base 'WorklogScripts'
$report=@{passed=$false;environment='Windows';runtime=$PSVersionTable.PSVersion.ToString();checks=@();live=[bool]$Live;output=$OutputDirectory}
try {
 & (Join-Path $PSScriptRoot 'Install.ps1') -Source $source -InstallBase $base -Isolated
 $report.checks+='install in Unicode and space path'
 $ps=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
 & $ps -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File (Join-Path $target 'desktop/windows/Runtime.ps1') -LoadOnly
 if($LASTEXITCODE-ne0){throw 'OS runtime compilation failed'};$report.checks+='PowerShell 5.1 / .NET Framework compilation'
 & $ps -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File (Join-Path $target 'desktop/windows/Verify-Theme.ps1') -OutputDirectory (Join-Path $OutputDirectory 'theme-checks') | Out-Null
 if($LASTEXITCODE-ne0){throw 'Native theme verification failed'};$report.checks+='native cream/dark/custom theme controls, persistence, migration and rounded font'
 & $ps -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File (Join-Path $target 'desktop/windows/Verify-Startup.ps1') -OutputDirectory (Join-Path $OutputDirectory 'startup-checks') | Out-Null
 if($LASTEXITCODE-ne0){throw 'Startup consent verification failed'};$report.checks+='native startup consent UI and persisted decisions; no OS startup registration changed'
 if($Live){$result=& $ps -NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -File (Join-Path $target 'desktop/windows/Runtime.ps1') -SelfTest;if($LASTEXITCODE-ne0){throw 'Live verification failed'};$parsed=$result|ConvertFrom-Json;if(-not$parsed.passed){throw 'Live result was not passed'};$report.liveResult=$parsed}
 & (Join-Path $target 'desktop/windows/Launch.ps1')
 $deadline=[DateTime]::UtcNow.AddSeconds(20);$statusPath=Join-Path $env:WORKLOG_SCRIPTS_HOME 'status.json'
 while(-not(Test-Path -LiteralPath $statusPath)-and[DateTime]::UtcNow-lt$deadline){Start-Sleep -Milliseconds 200}
 if(-not(Test-Path -LiteralPath $statusPath)){throw 'Panel did not become ready'}
 $status=Get-Content -LiteralPath $statusPath -Raw|ConvertFrom-Json;if(-not$status.toolWindow-or$status.appWindow){throw 'Alt+Tab styles incorrect'};$report.checks+='actual WPF launch and tool-window styles'
 & (Join-Path $PSScriptRoot 'Install.ps1') -Action Update -Source $source -InstallBase $base -Isolated
 $report.checks+='update and restarted heartbeat'
 # A damaged source must be rejected before touching the installed copy.
 $bad=Join-Path $OutputDirectory 'damaged';$null=New-Item -ItemType Directory -Path $bad;Copy-Item -LiteralPath (Join-Path $source 'payload.sha256') -Destination $bad
 $rejected=$false;try{&(Join-Path $PSScriptRoot 'Install.ps1') -Source $bad -InstallBase $base -Isolated}catch{$rejected=$true};if(-not$rejected-or-not(Test-Path -LiteralPath (Join-Path $target 'installed.json'))){throw 'Corrupt update was not safely rejected'};$report.checks+='corrupt package rejection preserves installed version'
 if(-not$LaunchPanel){&(Join-Path $target 'desktop/windows/Control.ps1') -Action stop;&(Join-Path $target 'desktop/windows/Install.ps1') -Action Uninstall -InstallBase $base -Isolated;if(Test-Path -LiteralPath $target){throw 'Uninstall left application files'};$report.checks+='stop and uninstall preserve profile'}
 $report.passed=$true
}catch{$report.error=$_.Exception.Message;throw}finally{$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $OutputDirectory 'verification.json') -Encoding UTF8}
$report|ConvertTo-Json -Depth 8
