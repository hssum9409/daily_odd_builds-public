#!/bin/sh
set -eu
exec "$(dirname -- "$0")/install.command" "$@"
