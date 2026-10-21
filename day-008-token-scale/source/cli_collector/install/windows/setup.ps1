$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$message='Install Token Scale for this Windows user?'+[Environment]::NewLine+[Environment]::NewLine+
  'Enables a tray daemon, login startup, 30-second local token checks, changed-only uploads and GitHub updates. '+
  'OpenAI credentials stay on this PC. Finish Google connection in the browser. Public rankings are opt-in on the website.'
if ([Windows.Forms.MessageBox]::Show($message,'Token Scale installation','YesNo','Question') -ne 'Yes') {exit 0}
$process=$null
try {
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=Join-Path $PSScriptRoot 'dartaotruntime.exe'
  $start.Arguments='"'+(Join-Path $PSScriptRoot 'token-scale.aot')+'" install --consent --payload-root "'+$PSScriptRoot+'"'
  $start.WorkingDirectory=$PSScriptRoot;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $process=[Diagnostics.Process]::Start($start)
  $output=$process.StandardOutput.ReadToEndAsync();$diagnostics=$process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {throw 'Installation failed'}
} catch {
  [Windows.Forms.MessageBox]::Show('Installation failed. No security setting was changed. Check the package checksum and Windows application control logs.','Token Scale','OK','Error') | Out-Null
  exit 1
} finally {if ($process) {$process.Dispose()}}
