param([ValidateSet('show','stop','refresh','status','settings','theme')][string]$Action='status',[ValidateSet('cream','dark')][string]$Theme,[switch]$Emulator)
$ErrorActionPreference='Stop'
if($Action-eq'theme'-and-not$Theme){throw 'Specify -Theme cream or -Theme dark.'}
$profile=if($env:WORKLOG_SCRIPTS_HOME){[IO.Path]::GetFullPath($env:WORKLOG_SCRIPTS_HOME)}else{Join-Path $env:LOCALAPPDATA ('DailyOddBuilds/Worklog/'+$(if($Emulator){'emulator'}else{'production'}))}
if($Action -eq 'status'){
 $p=Join-Path $profile 'status.json';if(Test-Path -LiteralPath $p){$s=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json;$s|Add-Member -NotePropertyName fresh -NotePropertyValue (([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$s.updatedAt)-lt 5000);$s|ConvertTo-Json}else{'{"ready":false,"running":false}'};exit
}
$instance=Join-Path $profile 'instance.json'
if(Test-Path -LiteralPath $instance){$owner=Get-Content -LiteralPath $instance -Raw|ConvertFrom-Json;if($owner.product-ne'WorklogScripts'){throw 'Unknown instance owner'};if(-not(Get-Process -Id $owner.pid -ErrorAction SilentlyContinue)){Remove-Item -LiteralPath $instance;Remove-Item -LiteralPath (Join-Path $profile 'status.json') -ErrorAction SilentlyContinue}}
if(-not(Test-Path -LiteralPath $instance)){if($Action -in @('show','settings','theme')){& (Join-Path $PSScriptRoot 'Launch.ps1') -Emulator:$Emulator;$deadline=[DateTime]::UtcNow.AddSeconds(15);while(-not(Test-Path -LiteralPath $instance)-and[DateTime]::UtcNow-lt$deadline){Start-Sleep -Milliseconds 100};if(-not(Test-Path -LiteralPath $instance)){throw 'Worklog did not become ready.'}}else{exit}}
$dir=Join-Path $profile 'commands';$null=New-Item -ItemType Directory -Path $dir -Force
$path=Join-Path $dir ([Guid]::NewGuid().ToString()+'.json')
@{action=$Action;theme=$Theme;createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json|Set-Content -LiteralPath ($path+'.tmp') -Encoding UTF8
Move-Item -LiteralPath ($path+'.tmp') -Destination $path
if($Action -eq 'stop'){$until=[DateTime]::UtcNow.AddSeconds(15);while(((Test-Path -LiteralPath $instance)-or(Get-Process -Id $owner.pid -ErrorAction SilentlyContinue)) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100};if((Test-Path -LiteralPath $instance)-or(Get-Process -Id $owner.pid -ErrorAction SilentlyContinue)){throw 'Worklog did not stop. Files were preserved.'}}
