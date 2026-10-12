#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
choice=$(/usr/bin/osascript -l JavaScript "$root/macos/Setup.js" "$root")
[ -n "$choice" ] || exit 0
language=$(printf '%s' "$choice" | sed -n 's/.*"language":"\(ko\|en\|zh\|ja\)".*/\1/p')
case "$language" in ko|en|zh|ja) ;; *) exit 1 ;; esac
set -- --launch "--language=$language"
if printf '%s' "$choice" | grep '"startup":true' >/dev/null; then set -- "$@" --startup; fi
exec /bin/sh "$root/macos/install.command" "$@"
