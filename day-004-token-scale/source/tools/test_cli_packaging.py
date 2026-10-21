"""Offline packaging regressions. No account, install, network or OS policy access."""
from pathlib import Path
import hashlib
import subprocess
import sys
import tempfile
import unittest

import build_cli


class PackagingTests(unittest.TestCase):
    def test_generated_manifest_uses_lf_even_on_windows(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            for name in ('payload.bin', 'file with spaces.txt'):
                (stage / name).write_bytes(b'actual payload\r\n\0')
            files = build_cli.package_files(stage, {'payload.bin', 'file with spaces.txt'})
            manifest = (stage / 'SHA256SUMS.txt').read_bytes()
            self.assertNotIn(b'\r', manifest)
            self.assertTrue(manifest.endswith(b'\n'))
            self.assertEqual(len(files), 3)
            for line in manifest.decode().splitlines():
                digest, name = line.split('  ', 1)
                self.assertEqual(hashlib.sha256((stage / name).read_bytes()).hexdigest(), digest)

    def test_release_manifest_uses_lf_even_on_windows(self):
        version = build_cli.VERSION
        names = ['token-scale-windows-x64.aot', 'token-scale-macos-x64', 'token-scale-macos-arm64',
                 f'Token-Scale-Install-Windows-x64-{version}.zip',
                 f'Token-Scale-macos-x64-{version}.tar.gz', f'Token-Scale-macos-arm64-{version}.tar.gz']
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            for name in names:
                (stage / name).write_bytes(b'fixture only')
            subprocess.run([sys.executable, str(Path(__file__).with_name('prepare_cli_release.py')),
                            '--directory', directory, '--version', version], check=True, capture_output=True)
            manifest = (stage / 'SHA256SUMS.txt').read_bytes()
            self.assertNotIn(b'\r', manifest)
            self.assertEqual(len(manifest.splitlines()), 6)
            self.assertTrue(manifest.endswith(b'\n'))


if __name__ == '__main__':
    unittest.main()
