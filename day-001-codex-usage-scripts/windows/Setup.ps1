# 설치 화면만 담당한다. 설치 후 모니터는 PowerShell/WPF로 실행한다.
param([switch]$SelfTest,[string]$ReportPath='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
$root=Split-Path $PSScriptRoot -Parent
$strings=Get-Content -LiteralPath (Join-Path $root 'strings.json') -Raw -Encoding UTF8|ConvertFrom-Json
$language=[Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName
if($language -notin @('ko','en','zh','ja')){$language='ko'}
$w=New-Object Windows.Window;$w.Title='Codex Usage Monitor Scripts';$w.Width=700;$w.Height=650;$w.WindowStartupLocation='CenterScreen';$w.ResizeMode='NoResize';$w.Background='#101617';$w.Foreground='#EDF4F1';$w.FontFamily='Malgun Gothic'
$w.Icon=New-Object Windows.Media.Imaging.BitmapImage([Uri](Join-Path $root 'assets\gp-chan-face.png'))
$stack=New-Object Windows.Controls.StackPanel;$stack.Margin=28;$w.Content=$stack
function Text([string]$Value,[double]$Size=13){$t=New-Object Windows.Controls.TextBlock;$t.Text=$Value;$t.FontSize=$Size;$t.TextWrapping='Wrap';$t.Margin='0,0,0,12';$null=$stack.Children.Add($t);return $t}
$null=Text 'Codex Usage Monitor Scripts' 25
$label=Text '';$combo=New-Object Windows.Controls.ComboBox;$combo.DisplayMemberPath='name';$combo.SelectedValuePath='value';$combo.Margin='0,0,0,15'
foreach($entry in @(@('ko','한국어'),@('en','English'),@('zh','中文'),@('ja','日本語'))){$null=$combo.Items.Add([pscustomobject]@{value=$entry[0];name=$entry[1]})}
$combo.SelectedValue=$language;$null=$stack.Children.Add($combo)
$license=New-Object Windows.Controls.TextBox;$license.IsReadOnly=$true;$license.TextWrapping='Wrap';$license.AcceptsReturn=$true;$license.Height=230;$license.VerticalScrollBarVisibility='Auto';$license.Background='#1c2628';$license.Foreground='#edf4f1';$license.Padding=12;$license.Margin='0,0,0,12';$null=$stack.Children.Add($license)
$agree=New-Object Windows.Controls.CheckBox;$agree.Margin='0,0,0,13';$agree.Foreground='#EDF4F1';$null=$stack.Children.Add($agree)
$startup=New-Object Windows.Controls.CheckBox;$startup.Margin='0,0,0,9';$startup.Foreground='#EDF4F1';$null=$stack.Children.Add($startup)
$help=Text '' 12;$help.Foreground='#99aeaa'
$button=New-Object Windows.Controls.Button;$button.Padding='20,9';$button.HorizontalAlignment='Right';$button.Background='#a5e4ce';$button.Foreground='#101617';$button.IsEnabled=$false;$null=$stack.Children.Add($button)
function Refresh-Language {
    $script:language=$combo.SelectedValue;$words=$strings.$language
    $label.Text=$words.language;$agree.Content=$words.install_agree;$startup.Content=$words.startup_register;$help.Text=$words.install_startup_help;$button.Content=$words.install_accept
    $path=if($language -eq 'en'){Join-Path $root 'LICENSE'}else{Join-Path $root "docs\licenses\MIT.$language.txt"}
    $license.Text=Get-Content -LiteralPath $path -Raw -Encoding UTF8
}
$combo.Add_SelectionChanged({Refresh-Language});$agree.Add_Click({$button.IsEnabled=[bool]$agree.IsChecked})
$button.Add_Click({$w.DialogResult=$true;$w.Close()});Refresh-Language
if($SelfTest){
    if(-not $ReportPath){throw 'ReportPath is required for UI QA.'}
    $folder=Split-Path ([IO.Path]::GetFullPath($ReportPath)) -Parent;$null=New-Item -ItemType Directory -Path $folder -Force
    $checks=0;$w.Show()
    foreach($lang in @('ko','en','zh','ja')){
        $combo.SelectedValue=$lang;Refresh-Language;$w.UpdateLayout()
        $null=$w.Dispatcher.Invoke([action]{},[Windows.Threading.DispatcherPriority]::Render)
        foreach($ok in @($license.Text.Contains('MIT License'),(-not $button.IsEnabled),($help.ActualHeight -gt 20),($button.TranslatePoint([Windows.Point]::new(0,$button.ActualHeight),$stack).Y -le $stack.ActualHeight),($help.TranslatePoint([Windows.Point]::new(0,$help.ActualHeight),$stack).Y -le $button.TranslatePoint([Windows.Point]::new(0,0),$stack).Y))){$checks++;if(-not $ok){throw "Installer UI clipped or incorrect: $lang"}}
        $agree.IsChecked=$true;$agree.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Primitives.ButtonBase]::ClickEvent));$checks++;if(-not $button.IsEnabled){throw 'License acceptance does not enable install.'}
        $agree.IsChecked=$false;$agree.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Primitives.ButtonBase]::ClickEvent))
        $bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$w.ActualWidth,[int]$w.ActualHeight,96,96,[Windows.Media.PixelFormats]::Pbgra32);$bitmap.Render($w)
        $encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder;$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap));$stream=[IO.File]::Create((Join-Path $folder "installer-$lang.png"));try{$encoder.Save($stream)}finally{$stream.Dispose()}
    }
    $w.Close();@{passed=$true;checks=$checks;languages=4;version=(Get-Content (Join-Path $root 'defaults.json') -Raw -Encoding UTF8|ConvertFrom-Json).version}|ConvertTo-Json|Set-Content -LiteralPath $ReportPath -Encoding UTF8
    Write-Output "Installer UI QA: $checks checks";exit 0
}
if($w.ShowDialog()) {
    $args=@('-NoLogo','-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'windows\Install.ps1'),'-Launch','-Language',$language)
    if($startup.IsChecked){$args+='-Startup'}
    & powershell.exe @args
    if($LASTEXITCODE){[Windows.MessageBox]::Show($strings.$language.update_install,'Codex Usage Monitor Scripts');exit $LASTEXITCODE}
}
