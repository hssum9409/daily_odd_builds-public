# Codex의 모양 설정만 읽는다. 원본 설정을 쓰거나 인증 관련 항목을 보관하지 않는다.
function Get-TomlAppearanceString([string]$Value) {
    $value=$Value.Trim()
    if($value -match '^"(?:[^"\\]|\\.)*"\s*(?:#.*)?$') {
        $match=[regex]::Match($value,'^"(?:[^"\\]|\\.)*"')
        return ($match.Value|ConvertFrom-Json)
    }
    if($value -match "^'([^']*)'\s*(?:#.*)?$"){return $Matches[1]}
    throw 'Invalid appearance string'
}
function Read-CodexAppearance([string]$Path) {
    if(-not [IO.File]::Exists($Path)){return @{mode='system';size=14;dark=@{};light=@{}}}
    $file=Get-Item -LiteralPath $Path
    if($file.Length -gt 2MB){throw 'Appearance file is too large'}
    $result=@{mode='system';size=14;dark=@{};light=@{}};$section='';$inline='';$target=''
    foreach($line in [IO.File]::ReadLines($Path)){
        $trim=$line.Trim()
        if($trim -match '^\[([^\]]+)\]\s*(?:#.*)?$'){$section=$Matches[1];continue}
        if($section -eq 'desktop' -and $trim -match '^appearanceTheme\s*=\s*(.*)$'){$result.mode=Get-TomlAppearanceString $Matches[1];continue}
        if($section -eq 'desktop' -and $trim -match '^sansFontSize\s*=\s*([0-9.]+)\s*(?:#.*)?$'){$result.size=[double]::Parse($Matches[1],[Globalization.CultureInfo]::InvariantCulture);continue}
        if($section -eq 'desktop' -and $trim -match '^appearance(Dark|Light)ChromeTheme\s*=\s*(.*)$'){
            $target=$Matches[1].ToLowerInvariant();$inline=$Matches[2]
            if($inline.StartsWith('"') -or $inline.StartsWith("'")){
                $object=(Get-TomlAppearanceString $inline)|ConvertFrom-Json
                foreach($key in @('surface','ink','accent')){if($object.$key){$result[$target][$key]=[string]$object.$key}}
                if($object.fonts.ui){$result[$target].font=[string]$object.fonts.ui};$inline='';continue
            }
        }elseif($inline){$inline+=' '+$trim}
        if($inline){
            if($inline.Length -gt 16384){throw 'Appearance table is too large'}
            # 색상과 글꼴만 허용한다. 코드 실행/환경변수 확장은 수행하지 않는다.
            foreach($m in [regex]::Matches($inline,'(?:^|[,{\s])(surface|ink|accent|ui)\s*=\s*("(?:[^"\\]|\\.)*"|''[^'']*'')')){
                $key=if($m.Groups[1].Value -eq 'ui'){'font'}else{$m.Groups[1].Value}
                $result[$target][$key]=Get-TomlAppearanceString $m.Groups[2].Value
            }
            if($trim.EndsWith('}')){$inline=''};continue
        }
        if($section -match '^desktop\.appearance(Dark|Light)ChromeTheme(\.fonts)?$'){
            $target=$Matches[1].ToLowerInvariant();$fonts=[bool]$Matches[2]
            if($trim -match '^(surface|ink|accent|ui)\s*=\s*(.*)$'){
                $key=$Matches[1];$value=Get-TomlAppearanceString $Matches[2]
                if($fonts -and $key -eq 'ui'){$result[$target].font=$value}elseif(-not $fonts -and $key -ne 'ui'){$result[$target][$key]=$value}
            }
        }
    }
    if($inline){throw 'Incomplete appearance table'}
    return $result
}
function Resolve-CodexAppearance($Settings,[bool]$SystemDark=$true) {
    $dark=if($Settings.mode -in @('dark','light')){$Settings.mode -eq 'dark'}else{$SystemDark}
    $theme=if($dark){$Settings.dark}else{$Settings.light}
    $surface=if($theme.surface -match '^#[a-fA-F0-9]{6}$'){$theme.surface}elseif($dark){'#181818'}else{'#ffffff'}
    $ink=if($theme.ink -match '^#[a-fA-F0-9]{6}$'){$theme.ink}elseif($dark){'#ececec'}else{'#202020'}
    $font=if($theme.font -is [string] -and $theme.font.Length -le 200){$theme.font}else{'Segoe UI, Malgun Gothic'}
    $size=if(Test-Finite $Settings.size){[Math]::Max(11,[Math]::Min(22,$Settings.size))}else{14}
    $muted=Blend-Color $surface $ink 0.64
    $accent=if($theme.accent -match '^#[a-fA-F0-9]{6}$'){$theme.accent}elseif($dark){'#A5E4CE'}else{'#22836F'}
    return @{surface=$surface;ink=$ink;muted=$muted;border=(Blend-Color $surface $ink 0.12);font=$font;size=$size;dark=$dark;accent=$accent}
}
function Blend-Color([string]$A,[string]$B,[double]$Amount) {
    $channels=foreach($offset in @(1,3,5)){
        $from=[Convert]::ToInt32($A.Substring($offset,2),16);$to=[Convert]::ToInt32($B.Substring($offset,2),16)
        [int][Math]::Round($from*(1-$Amount)+$to*$Amount)
    }
    return '#{0:X2}{1:X2}{2:X2}' -f $channels[0],$channels[1],$channels[2]
}
function Update-CodexAppearance {
    $now=Now;if($now -lt $script:nextAppearance){return $false};$script:nextAppearance=$now+1
    $path=if($env:CODEX_HOME){Join-Path $env:CODEX_HOME 'config.toml'}else{Join-Path $env:USERPROFILE '.codex/config.toml'}
    if($script:appearanceTestPath){$path=$script:appearanceTestPath}
    try{
        $file=Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
        $signature=if($file){$file.LastWriteTimeUtc.Ticks.ToString()+':'+$file.Length}else{'absent'}
        if($signature -ne $script:appearanceSignature -or -not $script:appearanceSettings){
            $script:appearanceSettings=Read-CodexAppearance $path;$script:appearanceSignature=$signature
        }
        $systemDark=$true
        $system=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction SilentlyContinue
        if($null -ne $system.AppsUseLightTheme){$systemDark=-not [bool]$system.AppsUseLightTheme}
        $appearance=Resolve-CodexAppearance $script:appearanceSettings $systemDark
        $key=$appearance|ConvertTo-Json -Compress
        $changed=$key -cne $script:appearanceKey;$script:appearanceKey=$key;$script:codexAppearance=$appearance
        return $changed
    }catch{
        # 원자적 파일 교체나 편집 중인 반쪽 설정은 직전 정상 테마를 유지한다.
        if(-not $script:codexAppearance){$script:codexAppearance=Resolve-CodexAppearance @{mode='system';size=14;dark=@{};light=@{}}}
        return $false
    }
}
