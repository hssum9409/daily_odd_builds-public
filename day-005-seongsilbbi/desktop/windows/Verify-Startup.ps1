param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$env:WORKLOG_DISABLE_STARTUP_PROMPT='1'
if(-not$OutputDirectory){$OutputDirectory=Join-Path $env:TEMP ('bbi-startup-'+[Guid]::NewGuid().ToString('N'))}
$null=New-Item -ItemType Directory -Path $OutputDirectory -Force
$env:WORKLOG_SCRIPTS_HOME=Join-Path $OutputDirectory 'compile-profile'
. (Join-Path $PSScriptRoot 'Runtime.ps1') -LoadOnly
$appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$app=New-Object Windows.Application;$app.ShutdownMode='OnExplicitShutdown'
$report=@{passed=$false;checks=@();registration='injected callback; OS startup entries unchanged'}
function Assert($value,$name){if(-not$value){throw $name};$report.checks+=$name}
try{
 Assert ([WorklogScripts.StartupRegistration]::ShouldAsk('', $false)) 'first launch asks for consent'
 Assert ([WorklogScripts.StartupRegistration]::ShouldAsk('later', $false)) 'later asks on the next launch'
 Assert (-not[WorklogScripts.StartupRegistration]::ShouldAsk('never', $false)) 'never ask again suppresses the prompt'
 Assert (-not[WorklogScripts.StartupRegistration]::ShouldAsk('registered', $false)) 'completed registration is not silently re-enabled or asked again'
 Assert (-not[WorklogScripts.StartupRegistration]::ShouldAsk('', $true)) 'existing registration suppresses the prompt'
 $script:registrations=0
 foreach($choice in @('later','never','registered','close')){
  $profile=Join-Path $OutputDirectory $choice;$script:chosen=''
  $register=[Action]{$script:registrations++}
  $remember=[Action[string]]{param($value)$script:chosen=$value;[WorklogScripts.StartupRegistration]::Remember($profile,$value)}
  $window=[WorklogScripts.StartupRegistration]::CreatePrompt($appRoot,($choice-eq'never'),$register,$remember)
  $window.Show();$window.UpdateLayout()
  if($choice-in@('later','never')){
   $visual=$window.Content;$visual.UpdateLayout();$bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$visual.ActualWidth,[int]$visual.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32)
   $backdrop=New-Object Windows.Media.DrawingVisual;$drawing=$backdrop.RenderOpen();$drawing.DrawRectangle($window.Background,$null,(New-Object Windows.Rect(0,0,$visual.ActualWidth,$visual.ActualHeight)));$drawing.Close();$bitmap.Render($backdrop);$bitmap.Render($visual)
   $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder;$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap));$file=[IO.File]::Create((Join-Path $OutputDirectory ('startup-'+$choice+'.png')));try{$encoder.Save($file)}finally{$file.Dispose()}
  }
  if($choice-eq'close'){$window.Close()}else{
   $body=$window.Content.Children[0];$actions=$body.Children[$body.Children.Count-1]
   $button=$actions.Children|Where-Object {$_.Tag-eq$choice}
   $button.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)))
  }
  $expected=if($choice-eq'close'){'later'}else{$choice}
  $saved=Get-Content -LiteralPath (Join-Path $profile 'startup-settings.json') -Raw|ConvertFrom-Json
  Assert (-not$window.IsVisible-and$script:chosen-eq$expected-and$saved.choice-eq$expected) ("native consent control persists choice: "+$choice)
 }
 Assert ($script:registrations-eq1) 'registration runs only after the register button'
 $report.passed=$true
}catch{$report.error=$_.Exception.Message;throw}
finally{$app.Shutdown();$report|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $OutputDirectory 'startup-verification.json') -Encoding UTF8}
$report|ConvertTo-Json -Depth 5
