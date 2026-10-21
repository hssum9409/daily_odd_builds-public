"""Prepare checksum asset for a reviewed public release; never uploads anything."""
from pathlib import Path
import argparse, hashlib, re

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--directory',type=Path,required=True)
    p.add_argument('--version',required=True)
    args=p.parse_args()
    assert re.fullmatch(r'(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})',args.version)
    # Native macOS assets must come from macOS CI; Windows bootstrap archives
    # are development packages and cannot substitute for native updater assets.
    names=['token-scale-windows-x64.aot','token-scale-macos-x64','token-scale-macos-arm64',
           f'Token-Scale-Install-Windows-x64-{args.version}.zip',
           f'Token-Scale-macos-x64-{args.version}.tar.gz',f'Token-Scale-macos-arm64-{args.version}.tar.gz']
    lines=[]
    for name in names:
        file=args.directory/name
        assert file.is_file() and not file.is_symlink(), f'Missing native release asset: {name}'
        lines.append(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {name}\n')
    (args.directory/'SHA256SUMS.txt').write_bytes(''.join(lines).encode('utf-8'))
    print(f'Prepared day004-cli-v{args.version}; no source or asset was uploaded.')

if __name__=='__main__':main()
