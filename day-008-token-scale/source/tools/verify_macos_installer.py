"""Exercise an extracted Mac package's real verifier, not macOS installation/UI.

On Windows only /usr/bin/shasum -a 256 is replaced by sha256sum in a temporary
fixture and its manifest entry is rehashed. All installation tests stop before
architecture checks or mutations; no macOS execution is claimed.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    args = parser.parse_args()
    bash = shutil.which('bash') or 'C:/Program Files/Git/bin/bash.exe'

    def posix(path):
        if os.name == 'nt':
            return subprocess.check_output([bash, '-c', 'cygpath -u "$1"', 'probe', str(path)], text=True).strip()
        return str(path)

    with tempfile.TemporaryDirectory(prefix='token-scale-package-') as temporary:
        base = Path(temporary)
        source = base / 'download 한글 (1)'
        with tarfile.open(args.archive) as archive:
            members = archive.getmembers()
            assert len(members) == len({m.name for m in members})
            for member in members:
                path = PurePosixPath(member.name)
                assert member.isfile() and path.parts[0] == 'Token-Scale' and '..' not in path.parts and not path.is_absolute()
                target = source / Path(*path.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
        source /= 'Token-Scale'
        original = (source / 'SHA256SUMS.txt').read_bytes()
        assert b'\r' not in original and original.endswith(b'\n'), 'Release manifest must use LF'
        for line in original.decode().splitlines():
            digest, name = line.split('  ', 1)
            assert hashlib.sha256((source / name).read_bytes()).hexdigest() == digest, name
        script = source / 'install.command'
        assert b'\r' not in script.read_bytes()
        if os.name == 'nt':
            script.write_bytes(script.read_bytes().replace(b'/usr/bin/shasum -a 256', b'/usr/bin/sha256sum'))

        def manifest(package):
            return ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(package).as_posix()}\n'
                           for p in sorted(package.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS.txt').encode()

        (source / 'SHA256SUMS.txt').write_bytes(manifest(source))
        home = base / 'user home'
        home.mkdir()
        # Existing install sentinel must survive every test unchanged.
        sentinel = home / 'Library/Application Support/Token Scale/current.txt'
        sentinel.parent.mkdir(parents=True)
        sentinel.write_bytes(b'existing-install')
        passed, skipped = [], []

        def case(name, change, expected=True, consent=False):
            package = base / name / 'download 한글 (1)' / 'Token-Scale'
            shutil.copytree(source, package)
            change(package)
            result = subprocess.run([bash, str(package / 'install.command'), '--consent' if consent else '--verify-package'],
                                    env={**os.environ, 'HOME': posix(home)}, capture_output=True, text=True, timeout=25)
            assert (result.returncode == 0) == expected, (name, result.returncode, result.stdout, result.stderr)
            assert sentinel.read_bytes() == b'existing-install'
            assert not (home / '.config').exists() and not (home / 'Applications').exists()
            passed.append(name)
            return package, result

        def rewrite(package, function):
            path = package / 'SHA256SUMS.txt'
            path.write_bytes(function(path.read_bytes()))

        case('lf', lambda p: None)
        case('crlf', lambda p: rewrite(p, lambda b: b.replace(b'\n', b'\r\n')))
        case('mixed-lines', lambda p: rewrite(p, lambda b: b.replace(b'\n', b'\r\n', 1)))
        case('no-final-newline', lambda p: rewrite(p, lambda b: b.rstrip(b'\n')))
        case('tampered-payload', lambda p: (p / 'LICENSE').write_bytes(b'changed'), False)
        case('missing-payload', lambda p: (p / 'LICENSE').unlink(), False)
        case('incomplete-manifest', lambda p: rewrite(p, lambda b: b'\n'.join(b.split(b'\n')[1:])), False)
        case('duplicate', lambda p: rewrite(p, lambda b: b + b.splitlines()[0] + b'\n'), False)
        case('malformed-hash', lambda p: rewrite(p, lambda b: b'Z' + b[1:]), False)
        for name, path in [('traversal', '../outside'), ('absolute', '/etc/passwd'),
                           ('shell-syntax', '$(touch escaped)'), ('backslash', '..\\outside')]:
            case(name, lambda p, path=path: rewrite(p, lambda b: b + b'0'*64 + b'  ' + path.encode() + b'\n'), False)

        # Failure must be diagnosed before the running installation is touched.
        _, result = case('gui-failure-log', lambda p: (p / 'LICENSE').write_bytes(b'changed'), False, consent=True)
        log = home / 'Library/Logs/Token Scale/install.log'
        assert 'phase=verify-package' in log.read_text() and 'checksum mismatch' in log.read_text()
        assert result.stdout == '' and result.stderr == ''

        outside = base / 'outside.txt'
        outside.write_bytes((source / 'LICENSE').read_bytes())
        try:
            probe = base / 'link-probe'
            probe.symlink_to(outside)
            probe.unlink()
        except OSError as error:
            skipped.append({'symlinks': type(error).__name__})
        else:
            def link_file(package):
                (package / 'LICENSE').unlink()
                (package / 'LICENSE').symlink_to(outside)
            case('linked-file', link_file, False)

            def link_parent(package):
                target = package / 'Install Token Scale.app/Contents'
                moved = base / 'outside-contents'
                shutil.move(target, moved)
                target.symlink_to(moved, target_is_directory=True)
            case('linked-parent', link_parent, False)

        print(json.dumps({'archive': args.archive.name, 'checks': len(passed), 'passed': passed,
                          'skipped': skipped, 'hashToolSubstituted': os.name == 'nt',
                          'macOSInstallProof': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
