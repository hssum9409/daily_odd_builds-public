#!/bin/bash
set -u
umask 077
root="$(cd -- "$(dirname -- "$0")" && pwd -P)"
[ "$(cat "$root/product-id")" = 'DailyOddBuilds.TokenScale' ] || exit 1
home="$(cat "$root/data-home.txt")"
mkdir -p "$home"
lock="$root/host.lock"
if ! mkdir "$lock" 2>/dev/null; then
  [ ! -L "$lock" ] || exit 1
  previous_pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ "$previous_pid" =~ ^[0-9]+$ ]] && /bin/ps -p "$previous_pid" -o command= | /usr/bin/grep -F -- "$root/host.sh" >/dev/null; then
    printf 'connect' > "$root/connect.request"
    exit 0
  fi
  rm -f "$lock/pid"
  rmdir "$lock"
  mkdir "$lock"
fi
printf '%s' "$$" > "$lock/pid"
child=''; menu=''
log_event() {
  if [ -f "$home/host.log" ] && [ "$(/usr/bin/stat -f %z "$home/host.log" 2>/dev/null || echo 0)" -gt 65536 ]; then mv -f "$home/host.log" "$home/host.previous.log"; fi
  printf '%s %s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$home/host.log"
}
finish() {
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
  if [ -n "$menu" ] && kill -0 "$menu" 2>/dev/null; then kill "$menu" 2>/dev/null || true; wait "$menu" 2>/dev/null || true; fi
  rm -f "$home/desktop-ui.json"
  rm -f "$root/host-active" "$root/stop"
  rm -f "$lock/pid"
  rmdir "$lock"
}
trap finish EXIT
trap 'exit 0' TERM INT
# launchd provides singleton supervision; the CLI's OS file lock also prevents
# a second worker from a manual launch or another installation.
rm -f "$root/stop"
printf '%s' "$$" > "$root/host-active"
log_event 'host-started'
start_menu() {
  /usr/bin/osascript -l JavaScript "$root/status-menu.js" "$root" "$home" "$$" </dev/null >/dev/null 2>&1 &
  menu=$!
}
start_menu
valid_version() { [[ "$1" =~ ^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$ ]]; }
crashes=0
while [ ! -f "$root/stop" ]; do
  version="$(cat "$root/current.txt")"
  valid_version "$version" || exit 1
  token="$(/usr/bin/uuidgen | /usr/bin/tr -d '-' | /usr/bin/tr '[:upper:]' '[:lower:]')"
  ready="$root/ready"
  rm -f "$ready"
  "$root/versions/$version/token-scale" daemon --install-root "$root" --home "$home" --ready-file "$ready" --ready-token "$token" </dev/null >/dev/null 2>&1 &
  child=$!
  healthy=0
  for ((i=0;i<30;i++)); do
    kill -0 "$child" 2>/dev/null || break
    [ -f "$root/stop" ] && break
    if [ -f "$ready" ] && [ "$(cat "$ready")" = "$(printf '%s\n%s' "$version" "$token")" ]; then healthy=1; break; fi
    sleep 1
  done
  if [ "$healthy" = 0 ]; then
    kill "$child" 2>/dev/null || true
  else
    menu_retries=0
    while kill -0 "$child" 2>/dev/null && [ ! -f "$root/stop" ]; do
      if ! kill -0 "$menu" 2>/dev/null && [ "$menu_retries" -lt 3 ]; then
        wait "$menu" 2>/dev/null || true
        log_event 'menu-restarting';start_menu;menu_retries=$((menu_retries+1))
      fi
      sleep 1
    done
    if [ -f "$root/stop" ]; then kill "$child" 2>/dev/null || true; fi
  fi
  wait "$child"; code=$?; child=''
  [ -f "$root/stop" ] && break
  if [ "$healthy" = 0 ]; then
    log_event 'worker-readiness-failed'
    previous="$(cat "$root/previous.txt")"
    valid_version "$previous" && [ "$previous" != "$version" ] || exit 1
    printf '{"version":"%s"}' "$version" > "$root/blocked-update.json"
    printf '%s' "$previous" > "$root/current.txt.host.tmp"
    mv -f "$root/current.txt.host.tmp" "$root/current.txt"
  elif [ "$code" = 42 ]; then
    crashes=0
    continue
  else
    crashes=$((crashes+1))
    [ "$crashes" -le 3 ] || exit 1
    sleep 10
  fi
done
