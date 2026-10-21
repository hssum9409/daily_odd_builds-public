function Send-DesktopCommand([string]$Command) {
  if ($Command -notin @('connect','sync','pause','resume','update','web','startup-enable','startup-disable','stop')) {return}
  $name=if ($Command -eq 'stop') {'stop'} else {$Command+'.request'}
  [IO.File]::WriteAllText((Join-Path $script:trayRoot $name),$Command,[Text.UTF8Encoding]::new($false))
}
function Initialize-TokenScaleTray([string]$InstallPath,[string]$DataPath) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $script:trayRoot=$InstallPath;$script:trayData=$DataPath
  $all=Get-Content -LiteralPath (Join-Path $InstallPath 'desktop-strings.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  $language=[Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName
  if ($language -notin @('ko','ja','zh')) {$language='en'}
  $script:trayWords=$all.$language
  $script:tray=New-Object Windows.Forms.NotifyIcon
  $script:tray.Icon=[Drawing.SystemIcons]::Information
  $script:tray.Text='Token Scale';$script:tray.Visible=$true
  $script:trayMenu=New-Object Windows.Forms.ContextMenuStrip
  $script:trayItems=@{}
  foreach ($key in @('daemon','status','lastSync','connect','sync','pause','web','update','startup-enable','startup-disable','quit')) {
    $item=New-Object Windows.Forms.ToolStripMenuItem
    $item.Text=if ($key -eq 'daemon') {'Token Scale - '+$script:trayWords.daemon} else {$key}
    $item.Enabled=$key -notin @('daemon','status','lastSync')
    if ($key -eq 'quit') {$item.Tag='stop'} else {$item.Tag=$key}
    if ($item.Enabled) {$item.Add_Click({param($sender,$eventArgs) Send-DesktopCommand ([string]$sender.Tag)})}
    $script:trayItems[$key]=$item
    $script:trayMenu.Items.Add($item) | Out-Null
  }
  $script:tray.ContextMenuStrip=$script:trayMenu
  $script:tray.Add_DoubleClick({Send-DesktopCommand 'web'})
  $script:trayRefresh=[DateTime]::MinValue
  Update-TokenScaleTray -Force
  [IO.File]::WriteAllText((Join-Path $DataPath 'desktop-ui.json'),('{"pid":'+$PID+',"kind":"windows-tray","ready":true}'))
}
function Update-TokenScaleTray([switch]$Force) {
  if (-not $script:tray) {return}
  [Windows.Forms.Application]::DoEvents()
  if (-not $Force -and ([DateTime]::UtcNow-$script:trayRefresh).TotalSeconds -lt 2) {return}
  $script:trayRefresh=[DateTime]::UtcNow
  $status=$null
  try {$status=Get-Content -LiteralPath (Join-Path $script:trayData 'daemon-status.json') -Encoding UTF8 -Raw | ConvertFrom-Json} catch {}
  $phase=if ($status -and $status.phase -in @('starting','running','syncing','paused','connection-needed','error','stopped')) {$status.phase} else {'starting'}
  $label=$script:trayWords.$phase
  $script:trayItems.status.Text=$label
  if ($status.lastEvent -match '^[a-z0-9-]{1,80}$' -and $phase -eq 'error') {$script:trayItems.status.Text+=' ('+$status.lastEvent+')'}
  $script:tray.Text=('Token Scale: '+$label).Substring(0,[Math]::Min(63,('Token Scale: '+$label).Length))
  $script:tray.Icon=if ($phase -eq 'error') {[Drawing.SystemIcons]::Error} elseif ($phase -eq 'connection-needed') {[Drawing.SystemIcons]::Warning} else {[Drawing.SystemIcons]::Information}
  $last=$script:trayWords.never
  if ($status.lastSync) {try {$last=([DateTimeOffset]::Parse($status.lastSync)).ToLocalTime().ToString('g')} catch {}}
  $script:trayItems.lastSync.Text=$script:trayWords.lastSync+': '+$last
  foreach ($key in @('connect','sync','web','update','startup-enable','startup-disable','quit')) {$script:trayItems[$key].Text=$script:trayWords.$key}
  $pause=if ($status.autoSync -eq $false) {'resume'} else {'pause'}
  $script:trayItems.pause.Text=$script:trayWords.$pause;$script:trayItems.pause.Tag=$pause
}
function Close-TokenScaleTray {
  if ($script:tray) {$script:tray.Visible=$false;$script:tray.Dispose();$script:tray=$null}
  if ($script:trayMenu) {$script:trayMenu.Dispose();$script:trayMenu=$null}
  if ($script:trayData) {Remove-Item -LiteralPath (Join-Path $script:trayData 'desktop-ui.json') -ErrorAction SilentlyContinue}
}
