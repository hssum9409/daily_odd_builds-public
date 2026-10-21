"""Build scoped collector installers; never reads sessions, stats or private keys."""
from pathlib import Path
import argparse, hashlib, json, os, platform, plistlib, re, shutil, subprocess, tarfile, zipfile
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.3.1'
SDK = '3.13.5'
SDK_HASH = {'x64': '15aaffcc5c6aebcf5e907f721671a9f03cdc5e0b95affa59a9d8291fb2972421',
            'arm64': '9dfe7d6f2558816c2a978aff6c80e8a4509c6cb726c0702a616c64d286f60e88'}

def run(args): subprocess.run([str(a) for a in args], cwd=ROOT, check=True)
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def package_files(stage, expected):
    actual={file.relative_to(stage).as_posix() for file in stage.rglob('*') if file.is_file() and file.name!='SHA256SUMS.txt'}
    assert actual==set(expected), f'Unexpected or missing staging files: {actual ^ set(expected)}'
    files=[stage/name for name in sorted(expected)]
    assert all(file.is_file() and not file.is_symlink() for file in files)
    # Windows text mode converts LF to CRLF, which Unix checksum readers may
    # interpret as a carriage return in the payload filename (Day 5 regression).
    (stage/'SHA256SUMS.txt').write_bytes(''.join(f'{sha(file)}  {file.relative_to(stage).as_posix()}\n' for file in files).encode('utf-8'))
    return [*files,stage/'SHA256SUMS.txt']
def notices():
    config=ROOT/'.dart_tool/package_config.json'
    items=[]
    for package in json.loads(config.read_text())['packages']:
        uri=package['rootUri']
        if uri.startswith('file:'):
            parsed=unquote(urlparse(uri).path)
            directory=Path(parsed.lstrip('/') if os.name=='nt' else parsed)
        else: directory=(config.parent/unquote(uri)).resolve()
        if package['name']=='flutter':
            license=directory.parents[1]/'bin/cache/dart-sdk/LICENSE'
            items.append('Dart SDK\n'+license.read_text(encoding='utf-8'))
        for name in ('LICENSE','LICENSE.md','LICENSE.txt'):
            license=directory/name
            if license.is_file():
                items.append(package['name']+'\n'+license.read_text(encoding='utf-8',errors='replace'));break
    assert any(item.startswith('Dart SDK\n') for item in items)
    return '\n\n---\n\n'.join(items)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--platform',choices=['windows','macos','macos-bootstrap'],required=True)
    p.add_argument('--arch',choices=['x64','arm64'],default='x64')
    p.add_argument('--version',default=VERSION)
    p.add_argument('--defines',type=Path,required=True)
    p.add_argument('--product-key',default='DailyOddBuilds.TokenScale')
    p.add_argument('--output-dir',type=Path)
    args=p.parse_args()
    assert args.platform!='windows' or args.arch=='x64','Windows installer currently supports x64'
    assert re.fullmatch(r'(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})',args.version)
    assert re.fullmatch(r'DailyOddBuilds\.TokenScale(?:\.[A-Za-z0-9_-]+)?',args.product_key)
    defines=json.loads(args.defines.read_text(encoding='utf-8-sig'))
    allowed={'FIREBASE_PROJECT_ID','FIREBASE_API_KEY','FIREBASE_APP_ID','FIREBASE_SENDER_ID',
             'ARENA_API_URL','ARENA_WEB_URL','ARENA_DATABASE_URL','ARENA_EMULATOR','ARENA_RELEASE_APPROVED'}
    assert set(defines)<=allowed,'Only public SDK configuration is allowed'
    assert defines.get('ARENA_EMULATOR') in (None,False,'false'), 'Never package emulator/test stats as a live installer'
    options=[f'-D{k}={str(v).lower() if isinstance(v,bool) else v}' for k,v in defines.items()]
    options.append(f'-DCOLLECTOR_VERSION={args.version}')
    target=f'{args.platform}-{args.arch}-{args.version}'
    stage=ROOT/'build/cli'/target; stage.mkdir(parents=True,exist_ok=True)
    output=args.output_dir.resolve() if args.output_dir else ROOT/'dist'; output.mkdir(parents=True,exist_ok=True)
    for name in ('LICENSE',):shutil.copyfile(ROOT/name,stage/name)
    (stage/'THIRD_PARTY_LICENSES.txt').write_text(notices(),encoding='utf-8')
    (stage/'README.txt').write_text(
        'Token Scale Is All You Need '+args.version+'\n\n'
        'Development collector; official service/public release is pending policy clarification.\n'
        'Requires Codex and its existing local ChatGPT login. Google/Firebase identifies the website account.\n'
        'Install once and approve the browser connection. A tray/menu-bar daemon runs without a terminal.\n'
        'Windows: open Install.vbs for a console-free installer; install.cmd is a terminal fallback.\n'
        'Mac: open Install Token Scale.app; install.command is a terminal fallback.\n'
        'Automatic sync: startup + 00/06/12/18 local slots; only changed metadata is submitted.\n'
        'Automatic update: every six hours; only day004-cli-vX.Y.Z releases from\n'
        'https://github.com/hssum9409/daily_odd_builds-public . No credential is sent to GitHub.\n'
        'Statistics are community-reported, not cryptographically attested by OpenAI.\n'
        'No prompts, code, paths or OpenAI credentials are uploaded. Publication is opt-in on the website.\n'
        'Uninstall retains local login/cache; logout removes the local login. Server account deletion is on the website.\n'
        'CLI: version, status, login, logout, inspect, sync --consent, settings --auto-sync off --auto-update off.\n'
        'Installed CLI lifecycle: stop / startup enable|disable / update --install-root INSTALL_PATH.\n'
        'Windows data: %LOCALAPPDATA%/TokenScaleCLI (DPAPI); Mac data: ~/.config/token-scale (Keychain).\n'
        'Windows uses the original Dart 3.13.5 AOT runtime + token-scale.aot; no new custom PE loader.\n'
        'Windows CLI: "%LOCALAPPDATA%/Programs/Token Scale/token-scale.cmd" status (or other command).\n'
        'Runtime/host upgrades require an installer; automatic updates replace the versioned collector only.\n'
        'Product files do not have formal Authenticode/Developer ID certification. No OS policy is disabled.\n'
        'Mac uninstall: "$HOME/Library/Application Support/Token Scale/manage.sh" uninstall "$HOME/Library/Application Support/Token Scale"\n'
        'Support: https://github.com/hssum9409/daily_odd_builds-public/issues\n',encoding='utf-8')
    dart=shutil.which('dart')
    assert dart
    exe=stage/('token-scale.exe' if args.platform=='windows' else 'token-scale')
    if args.platform=='macos-bootstrap':
        run([dart,'compile','kernel',*options,'cli_collector/bin/token_scale.dart','-o',stage/'collector.dill'])
        exe.write_text('#!/bin/bash\nset -e\ndir="$(cd -- "$(dirname -- "$0")" && pwd -P)"\nroot="$(cd "$dir/../.." && pwd -P)"\nexec "$root/runtime/dart-sdk/bin/dart" "$dir/collector.dill" "$@"\n',encoding='utf-8',newline='\n')
        for name,value in [('runtime-version.txt',SDK),('runtime-architecture.txt',args.arch),('runtime-sha256.txt',SDK_HASH[args.arch])]:
            (stage/name).write_text(value,encoding='utf-8')
    elif args.platform=='windows':
        # Official stable runtime + AOT snapshot avoids generating a new PE
        # loader on each update. Neither file is claimed to be Authenticode signed.
        runtime=Path(dart).parent/'cache/dart-sdk/bin/dartaotruntime.exe'
        if not runtime.is_file():runtime=Path(dart).parent/'dartaotruntime.exe'
        assert runtime.is_file()
        result=subprocess.run([str(runtime),'--version'],capture_output=True,text=True,check=True)
        assert f'Dart SDK version: {SDK} ' in result.stdout+result.stderr, 'Pinned runtime/compiler version required'
        run([dart,'compile','aot-snapshot',*options,'cli_collector/bin/token_scale.dart','-o',stage/'token-scale.aot'])
        shutil.copyfile(runtime,stage/'dartaotruntime.exe')
        shutil.copyfile(stage/'token-scale.aot',output/'token-scale-windows-x64.aot')
    else:
        if args.platform=='macos': assert platform.system()=='Darwin', 'Native macOS binaries must be built on macOS'
        run([dart,'compile','exe',*options,'cli_collector/bin/token_scale.dart','-o',exe])
        shutil.copyfile(exe,output/(f'token-scale-{args.platform}-{args.arch}'+('.exe' if args.platform=='windows' else '')))
    if args.platform=='windows':
        for name in ('manage.ps1','host.ps1','install.cmd','token-scale.cmd','start.cmd','launch.ps1','launch.vbs','Install.vbs','setup.ps1','tray.ps1'):
            shutil.copyfile(ROOT/'cli_collector/install/windows'/name,stage/name)
        shutil.copyfile(ROOT/'cli_collector/install/desktop-strings.json',stage/'desktop-strings.json')
        # Discard obsolete generated helpers from a preceding local build only.
        for name in ('TokenScaleHost.exe','token-scale.exe'):
            if (stage/name).is_file():(stage/name).unlink()
        files=package_files(stage,{'LICENSE','THIRD_PARTY_LICENSES.txt','README.txt','token-scale.aot','dartaotruntime.exe','host.ps1','manage.ps1','install.cmd','token-scale.cmd','start.cmd','launch.ps1','launch.vbs','Install.vbs','setup.ps1','tray.ps1','desktop-strings.json'})
        zip_path=output/f'Token-Scale-Install-Windows-x64-{args.version}.zip'
        with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
            for file in files:z.write(file,file.relative_to(stage).as_posix())
    else:
        for file in (ROOT/'cli_collector/install/macos').iterdir():
            # Also tolerate source checkouts made before .gitattributes existed.
            data=file.read_bytes().replace(b'\r\n',b'\n')
            assert b'\r' not in data and b'\x00' not in data, f'Expected Unix text asset: {file.name}'
            (stage/file.name).write_bytes(data)
        shutil.copyfile(ROOT/'cli_collector/install/desktop-strings.json',stage/'desktop-strings.json')
        plist=plistlib.loads((stage/'Info.plist').read_bytes());plist['CFBundleVersion']=args.version
        (stage/'Info.plist').write_bytes(plistlib.dumps(plist))
        (stage/'version.txt').write_text(args.version,encoding='utf-8')
        (stage/'architecture.txt').write_text('arm64' if args.arch=='arm64' else 'x86_64',encoding='utf-8')
        installer=stage/'Install Token Scale.app/Contents'
        (installer/'MacOS').mkdir(parents=True,exist_ok=True)
        shutil.copyfile(stage/'InstallTokenScale',installer/'MacOS/InstallTokenScale')
        (installer/'Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier':'org.dailyoddbuilds.token-scale.installer',
            'CFBundleName':'Install Token Scale','CFBundleExecutable':'InstallTokenScale',
            'CFBundlePackageType':'APPL','CFBundleVersion':args.version,'LSUIElement':True,
            'LSMinimumSystemVersion':'14.0','NSPrincipalClass':'NSApplication'}))
        if args.platform=='macos':
            actual_arch=subprocess.check_output(['lipo','-archs',str(exe)],text=True).strip()
            assert actual_arch==('arm64' if args.arch=='arm64' else 'x86_64'), f'Compiler architecture mismatch: {actual_arch}'
            run(['codesign','--force','--sign','-',exe])
            run(['codesign','--verify','--strict',exe])
            shutil.copyfile(exe,output/f'token-scale-macos-{args.arch}')
            (output/f'token-scale-macos-{args.arch}').chmod(0o700)
        expected={'LICENSE','THIRD_PARTY_LICENSES.txt','README.txt','token-scale','Info.plist','TokenScaleOpen','host.sh','manage.sh','install.command','version.txt','architecture.txt','desktop-strings.json','status-menu.js','Setup.js','InstallTokenScale','Install Token Scale.app/Contents/Info.plist','Install Token Scale.app/Contents/MacOS/InstallTokenScale'}
        if args.platform=='macos-bootstrap':expected|={'collector.dill','runtime-version.txt','runtime-architecture.txt','runtime-sha256.txt'}
        files=package_files(stage,expected)
        archive=output/f'Token-Scale-{args.platform}-{args.arch}-{args.version}.tar.gz'
        with tarfile.open(archive,'w:gz') as tar:
            for file in files:
                info=tar.gettarinfo(str(file),arcname='Token-Scale/'+file.relative_to(stage).as_posix());info.mode=0o700 if file.name in {'token-scale','TokenScaleOpen','install.command','host.sh','manage.sh','InstallTokenScale'} else 0o600
                with file.open('rb') as stream:tar.addfile(info,stream)
    print(json.dumps({'package':target,'stage':str(stage),'version':args.version}))

if __name__=='__main__':main()
