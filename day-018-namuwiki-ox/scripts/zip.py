"""Package only the generated extension with stdlib ZIP, then byte-verify it."""
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'dist'
name = sys.argv[1]
if Path(name).name != name or not name.startswith('gpichan-namuwiki-ox-') or not name.endswith('.zip'):
    raise ValueError('Invalid package name')
target = root / 'releases' / name
files = sorted(p for p in source.rglob('*') if p.is_file())
if not (source / 'manifest.json').is_file():
    raise ValueError('Missing built manifest')
original = root / 'extension'
original_files = sorted(p.relative_to(original).as_posix() for p in original.rglob('*') if p.is_file())
if original_files != sorted(p.relative_to(source).as_posix() for p in files):
    raise ValueError('dist/ file list does not match extension/')
for file in files:
    if file.read_bytes() != (original / file.relative_to(source)).read_bytes():
        raise ValueError(f'dist/ is stale: {file.relative_to(source)}')
with zipfile.ZipFile(target, 'w') as archive:
    for file in files:
        info = zipfile.ZipInfo(file.relative_to(source).as_posix(), (2000, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, file.read_bytes())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert sorted(archive.namelist()) == sorted(p.relative_to(source).as_posix() for p in files)
    for file in files:
        assert archive.read(file.relative_to(source).as_posix()) == file.read_bytes()
print(f'PASS: {len(files)} files; extension/, dist/ and ZIP all match')
