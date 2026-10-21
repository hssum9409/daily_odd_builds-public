"""Package bytes and POSIX installer regression checks; not macOS UI evidence."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('desktop_packager', ROOT / 'tools/package-desktop.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class DesktopPackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sandbox = tempfile.TemporaryDirectory(prefix='bbi-package-regression-')
        cls.work = Path(cls.sandbox.name)
        packager.OUT = cls.work / 'packages'
        with redirect_stdout(io.StringIO()):
            packager.main()
        cls.artifacts = json.loads((packager.OUT / 'release-manifest.json').read_text(encoding='utf-8'))['artifacts']

    @classmethod
    def tearDownClass(cls):
        cls.sandbox.cleanup()

    def test_all_archives_have_lf_manifests_and_valid_payload_hashes(self):
        for artifact in self.artifacts:
            archive = packager.OUT / artifact['name']
            self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), artifact['sha256'])
            with zipfile.ZipFile(archive) as z:
                prefix = 'WorklogScripts/' if '-update' in artifact['name'] else ''
                manifest = z.read(prefix + 'payload.sha256')
                self.assertNotIn(b'\r', manifest, artifact['name'])
                self.assertTrue(manifest.endswith(b'\n'))
                names = []
                for line in manifest.decode('ascii').splitlines():
                    digest, relative = line.split('  ', 1)
                    names.append(relative)
                    self.assertEqual(hashlib.sha256(z.read(prefix + relative)).hexdigest(), digest, relative)
                self.assertEqual(len(names), len(set(names)))
                self.assertEqual(set(z.namelist()), {prefix + n for n in names + ['payload.sha256']})
                for entry in z.infolist():
                    if entry.filename.endswith('.command'):
                        self.assertNotIn(b'\r', z.read(entry))
                        self.assertEqual((entry.external_attr >> 16) & 0o777, 0o755)
        self.assertNotIn(b'\r', (packager.OUT / 'SHA256SUMS.txt').read_bytes())

    def test_posix_install_copy_update_and_reject_unsafe_packages(self):
        shell = shutil.which('sh')
        if not shell and os.name == 'nt':
            git_shell = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/bin/bash.exe'
            if git_shell.is_file():
                shell = str(git_shell)
        if not shell:
            self.skipTest('POSIX shell unavailable; run Diagnose.command on a Mac')
        archive = packager.OUT / f'WorklogScripts-{packager.VERSION}-macos-preview.zip'
        source = self.work / 'WorklogScripts preview 한글 (1)'
        with zipfile.ZipFile(archive) as z:
            z.extractall(source)
        installer = source / 'desktop/macos/install.command'
        # Git for Windows has sha256sum rather than macOS's /usr/bin/shasum.
        # Substitute only the hashing command in this isolated fixture and
        # update its declared digest. No AppKit/Keychain checks are simulated.
        if os.name == 'nt':
            installer.write_bytes(installer.read_bytes().replace(b'/usr/bin/shasum -a 256', b'/usr/bin/sha256sum'))
            lines = (source / 'payload.sha256').read_bytes().decode('ascii').splitlines()
            lines = [hashlib.sha256(installer.read_bytes()).hexdigest() + '  desktop/macos/install.command' if line.endswith('  desktop/macos/install.command') else line for line in lines]
            (source / 'payload.sha256').write_bytes(('\n'.join(lines) + '\n').encode('ascii'))
        base = self.work / 'install space 한글'
        self.assertTrue(base.resolve().is_relative_to(self.work.resolve()))
        env = {**os.environ, 'WORKLOG_SCRIPTS_INSTALL_BASE': base.as_posix(), 'WORKLOG_SCRIPTS_HOME': (self.work / 'profile').as_posix()}

        def run(*args):
            return subprocess.run([shell, installer.as_posix(), *args, '--isolated'], env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)

        installed = base / 'app'
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((installed / 'installed.txt').is_file())
        original = (source / 'payload.sha256').read_bytes()
        (source / 'payload.sha256').write_bytes(original.replace(b'\n', b'\r\n'))
        result = run('--update')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((installed / 'payload.sha256').read_bytes(), original.replace(b'\n', b'\r\n'))
        self.assertEqual((installed / 'desktop/macos/Runtime.js').read_bytes(), (source / 'desktop/macos/Runtime.js').read_bytes())
        before = (installed / 'desktop/macos/Runtime.js').read_bytes()
        runtime = source / 'desktop/macos/Runtime.js'
        runtime.write_bytes(before + b'\n// corrupt fixture\n')
        result = run('--update')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Checksum mismatch', result.stderr)
        self.assertEqual((installed / 'desktop/macos/Runtime.js').read_bytes(), before)
        runtime.write_bytes(before)
        for invalid in ['../outside', '/outside', 'desktop/windows/Runtime.ps1', 'desktop/macos/bad name.js']:
            (source / 'payload.sha256').write_bytes(original + ('a' * 64 + '  ' + invalid + '\r\n').encode('ascii'))
            result = run('--update')
            self.assertNotEqual(result.returncode, 0, invalid)
            self.assertIn('Unsafe payload', result.stderr)
            self.assertEqual((installed / 'desktop/macos/Runtime.js').read_bytes(), before)
        result = run('--uninstall')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(installed.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
