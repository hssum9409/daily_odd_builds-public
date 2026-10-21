"""POSIX/Git Bash launcher test; NOT macOS LaunchServices/AppKit/Gatekeeper QA."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
bash = shutil.which('bash') or r'C:/Program Files/Git/bin/bash.exe'
def posix(path):
    if os.name == 'nt':
        return subprocess.check_output([bash, '-c', 'cygpath -u "$1"', 'probe', str(path)], text=True).strip()
    return str(path)

with tempfile.TemporaryDirectory(prefix='token-scale-detach-') as temporary:
    home = Path(temporary) / 'user home'
    install = home / 'Library/Application Support/Token Scale'
    profile = home / '.config/token-scale'
    install.mkdir(parents=True); profile.mkdir(parents=True)
    (install / 'product-id').write_text('DailyOddBuilds.TokenScale')
    (install / 'data-home.txt').write_text(posix(profile))
    (home / 'launchctl-stub').write_text('#!/bin/sh\nexit 1\n', newline='\n')
    launcher = home / 'TokenScaleOpen'
    launcher.write_text((ROOT / 'cli_collector/install/macos/TokenScaleOpen').read_text().replace(
        '/bin/launchctl', '"$HOME/launchctl-stub"'), newline='\n')
    (install / 'host.sh').write_text('''#!/bin/bash
root="$(cd "$(dirname "$0")" && pwd -P)"
printf '%s' "$$" > "$root/test-pid"
if IFS= read -r line; then echo inherited-input > "$root/input"; else echo eof > "$root/input"; fi
for ((i=0;i<100;i++)); do
  [ -f "$root/test-stop" ] && break
  printf '%s' "$i" > "$root/heartbeat"
  echo 'must-not-escape-to-parent'
  sleep 0.1
done
touch "$root/test-exited"
''', newline='\n')
    for path in [home / 'launchctl-stub', launcher, install / 'host.sh']:
        path.chmod(0o700)
    env = {**os.environ, 'HOME': posix(home)}
    try:
        started = time.monotonic()
        result = subprocess.run([bash, str(launcher)], input='', capture_output=True, text=True, env=env, timeout=3)
        assert result.returncode == 0 and result.stdout == '' and result.stderr == '', result
        elapsed = time.monotonic() - started
        deadline = time.monotonic() + 3
        while not (install / 'heartbeat').exists() and time.monotonic() < deadline:
            time.sleep(.05)
        assert (install / 'input').read_text().strip() == 'eof'
        pid = (install / 'test-pid').read_text().strip()
        before = int((install / 'heartbeat').read_text())
        subprocess.run([bash, '-c', 'kill -HUP "$1"', 'probe', pid], check=True, env=env)
        time.sleep(.5)
        assert int((install / 'heartbeat').read_text()) > before
        assert (install / 'connect.request').read_text() == 'connect'
        print(json.dumps({'launcherReturnsSeconds': round(elapsed, 3), 'stdinEOF': True,
                          'noInheritedOutput': True, 'survivesParentAndHUP': True,
                          'environment': 'Git Bash' if os.name == 'nt' else 'POSIX', 'macOSProof': False}))
    finally:
        (install / 'test-stop').touch()
        deadline = time.monotonic() + 3
        while not (install / 'test-exited').exists() and time.monotonic() < deadline:
            time.sleep(.1)
