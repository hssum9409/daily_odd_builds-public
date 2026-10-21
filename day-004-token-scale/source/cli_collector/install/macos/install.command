#!/bin/bash
set -euo pipefail
umask 077
package="$(cd -- "$(dirname -- "$0")" && pwd -P)"
# The GUI has no terminal. Keep installer diagnostics local, separate from
# collector logs; this script never reads credentials or user statistics.
if [ "${1:-}" = '--consent' ]; then
  logs="$HOME/Library/Logs/Token Scale"
  [ ! -L "$logs" ] && [ ! -L "$logs/install.log" ] && [ ! -L "$logs/install.previous.log" ] || exit 1
  mkdir -p "$logs"; chmod 700 "$logs"
  if [ -f "$logs/install.log" ]; then mv -f "$logs/install.log" "$logs/install.previous.log"; fi
  exec > "$logs/install.log" 2>&1
fi
verify_package() {
  local line digest file actual cr seen required candidate matched
  local files=(Info.plist 'Install Token Scale.app/Contents/Info.plist'
    'Install Token Scale.app/Contents/MacOS/InstallTokenScale' InstallTokenScale
    LICENSE README.txt Setup.js THIRD_PARTY_LICENSES.txt TokenScaleOpen
    architecture.txt desktop-strings.json host.sh install.command manage.sh
    status-menu.js token-scale version.txt)
  if [ -e "$package/collector.dill" ] || [ -L "$package/collector.dill" ]; then
    files+=(collector.dill runtime-architecture.txt runtime-sha256.txt runtime-version.txt)
  fi
  [ -f "$package/SHA256SUMS.txt" ] && [ ! -L "$package/SHA256SUMS.txt" ] || { echo 'Invalid package: missing manifest' >&2; return 1; }
  cr=$(printf '\r'); seen=$'\n'
  while IFS= read -r line || [ -n "$line" ]; do
    # Accept historical Windows-built lists without changing any payload bytes.
    line=${line%"$cr"}
    digest=${line%%  *}; file=${line#*  }
    [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid package: malformed checksum' >&2; return 1; }
    matched=0
    for candidate in "${files[@]}"; do [ "$file" != "$candidate" ] || matched=1; done
    [ "$matched" = 1 ] || { echo 'Invalid package: unexpected payload path' >&2; return 1; }
    [[ "$seen" != *$'\n'"$file"$'\n'* ]] || { echo 'Invalid package: duplicate payload' >&2; return 1; }
    [ -f "$package/$file" ] && [ ! -L "$package/$file" ] || { echo 'Invalid package: missing or linked payload' >&2; return 1; }
    # A regular file can still escape through a linked parent directory.
    case "$file" in 'Install Token Scale.app/'*)
      [ ! -L "$package/Install Token Scale.app" ] && [ ! -L "$package/Install Token Scale.app/Contents" ] && [ ! -L "$package/Install Token Scale.app/Contents/MacOS" ] || { echo 'Invalid package: linked payload directory' >&2; return 1; } ;;
    esac
    actual="$(/usr/bin/shasum -a 256 < "$package/$file")"
    [ "${actual%% *}" = "$digest" ] || { echo 'Invalid package: checksum mismatch' >&2; return 1; }
    seen+="$file"$'\n'
  done < "$package/SHA256SUMS.txt"
  for required in "${files[@]}"; do
    [[ "$seen" = *$'\n'"$required"$'\n'* ]] || { echo 'Invalid package: incomplete manifest' >&2; return 1; }
  done
}
echo 'phase=verify-package'
verify_package
# Read-only diagnostic, including on other POSIX hosts. No installation or SDK download.
if [ "${1:-}" = '--verify-package' ]; then echo 'Package checksums OK'; exit 0; fi
echo 'phase=architecture'
version="$(cat "$package/version.txt")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
expected="$(cat "$package/architecture.txt")"
machine="$(uname -m)"
[ "$expected" = "$machine" ] || { echo "This package requires $expected; your Mac is $machine." >&2; exit 1; }
cd "$package"
echo 'Token Scale Is All You Need'
echo 'Installs for your user only. Reads local Codex statistics; OpenAI credentials stay local.'
echo 'Automatic statistics sync (four local slots/day) and GitHub updates will be enabled.'
echo 'Only the first connection opens a browser. Publication is controlled on the website.'
printf 'Install and enable login startup? [y/N] '
if [ "${1:-}" = '--consent' ]; then answer=y; else read -r answer; fi
[[ "$answer" = [yY] ]] || exit 0
echo 'phase=install'
root="$HOME/Library/Application Support/Token Scale"
home="$HOME/.config/token-scale"
app="$HOME/Applications/Token Scale.app"
startup=1
if [ -e "$app" ]; then [ ! -L "$app" ] && [ "$(cat "$app/Contents/Resources/product-id")" = 'DailyOddBuilds.TokenScale' ] || exit 1; fi
if [ -e "$root" ]; then
  [ -f "$HOME/Library/LaunchAgents/org.dailyoddbuilds.token-scale.plist" ] || startup=0
  [ ! -L "$root" ] && [ "$(cat "$root/product-id")" = 'DailyOddBuilds.TokenScale' ] || exit 1
  printf 'stop' > "$root/stop"
  for ((i=0;i<90;i++)); do [ ! -f "$root/host-active" ] && break; sleep 1; done
  [ ! -f "$root/host-active" ] || { echo 'Collector did not stop.' >&2; exit 1; }
  /bin/launchctl bootout "gui/$(id -u)/org.dailyoddbuilds.token-scale" 2>/dev/null || true
fi
mkdir -p "$root/versions/$version" "$home" "$HOME/Applications"
chmod 700 "$root" "$home"
if [ -f "$package/collector.dill" ]; then
  # Portable development installer; official runtime is pinned by SHA-256.
  # Native releases built on macOS do not need this download.
  sdk_version="$(cat "$package/runtime-version.txt")"
  sdk_arch="$(cat "$package/runtime-architecture.txt")"
  sdk_hash="$(cat "$package/runtime-sha256.txt")"
  [[ "$sdk_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$sdk_arch" = x64 || "$sdk_arch" = arm64 ]] || exit 1
  [[ "$sdk_hash" =~ ^[a-f0-9]{64}$ ]] || exit 1
  runtime_version="$("$root/runtime/dart-sdk/bin/dart" --version 2>/dev/null || true)"
  if [[ "$runtime_version" != "Dart SDK version: $sdk_version "* ]] || [ ! -f "$root/runtime/dart-sdk/bin/snapshots/dartdev_aot.dart.snapshot" ] || [ ! -f "$root/runtime/dart-sdk/lib/_internal/vm_platform_strong.dill" ]; then
    mkdir -p "$root/runtime"
    archive="$root/runtime/sdk.zip"
    /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --max-time 600 \
      "https://storage.googleapis.com/dart-archive/channels/stable/release/$sdk_version/sdk/dartsdk-macos-$sdk_arch-release.zip" -o "$archive"
    actual="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/cut -d ' ' -f 1)"
    [ "$actual" = "$sdk_hash" ] || { rm -f "$archive"; echo 'Runtime checksum mismatch' >&2; exit 1; }
    # -o repairs an interrupted extraction; the owned runtime is not in use.
    /usr/bin/unzip -oq "$archive" -d "$root/runtime"
    rm -f "$archive"
    runtime_version="$("$root/runtime/dart-sdk/bin/dart" --version)"
    [[ "$runtime_version" = "Dart SDK version: $sdk_version "* ]] || exit 1
  fi
  cp collector.dill "$root/versions/$version/collector.dill"
fi
cp token-scale "$root/versions/$version/token-scale"
cp host.sh manage.sh status-menu.js desktop-strings.json LICENSE THIRD_PARTY_LICENSES.txt README.txt "$root/"
chmod 700 "$root/versions/$version/token-scale" "$root/host.sh" "$root/manage.sh"
printf 'DailyOddBuilds.TokenScale' > "$root/product-id"
printf '%s' "$home" > "$root/data-home.txt"
printf '%s' "$version" > "$root/current.txt"
printf '%s' "$version" > "$root/previous.txt"
if [ ! -f "$home/preferences.json" ]; then printf '{"autoSync":true,"autoUpdate":true,"uploadConsent":true}' > "$home/preferences.json"; fi
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp TokenScaleOpen "$app/Contents/MacOS/TokenScaleOpen"
cp Info.plist "$app/Contents/Info.plist"
cp "$root/product-id" "$app/Contents/Resources/product-id"
chmod 700 "$app/Contents/MacOS/TokenScaleOpen"
# LaunchServices registration provides a visible Applications entry, with no UI.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
if [ "$startup" = 1 ]; then
  echo 'phase=startup-enable'
  "$root/manage.sh" startup-enable "$root"
else
  echo 'phase=manual-start'
  /usr/bin/open "$app" --args --start
fi
echo 'phase=installed'
echo 'Installed. Finish Google connection in the opened browser. No terminal or app window is needed afterwards.'
