"""Build runtime-free desktop ZIPs. Python is a developer tool only."""
from pathlib import Path
import hashlib, json, zipfile, shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist-scripts'
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']

def main():
    OUT.mkdir(exist_ok=True)
    artifacts = []
    for platform in ('windows', 'macos'):
        folder = OUT / f'WorklogScripts-{VERSION}-{platform}'
        folder.mkdir(exist_ok=True)
        files = [ROOT / 'LICENSE', ROOT / 'config/firebase.json', ROOT / 'desktop/README.md', ROOT / 'desktop/themes.json', ROOT / 'desktop/updates.js', *sorted((ROOT / 'desktop/assets').glob('*')), *sorted((ROOT / 'desktop' / platform).glob('*'))]
        manifest = []
        for source in files:
            if not source.is_file(): continue
            rel = source.relative_to(ROOT).as_posix()
            data = source.read_bytes()
            if source.suffix == '.ps1': data = source.read_text(encoding='utf-8-sig').replace('\r\n','\n').encode('utf-8-sig')
            elif source.suffix in ('.command','.js','.cs'): data = source.read_text(encoding='utf-8-sig').replace('\r\n','\n').encode('utf-8')
            target=folder/rel; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data); manifest.append(rel)
        commands = {'Install':('Install.ps1','-Launch'),'Start':('Launch.ps1',''),'Stop':('Control.ps1','-Action stop'),'Show':('Control.ps1','-Action show'),'Refresh':('Control.ps1','-Action refresh'),'Status':('Control.ps1','-Action status'),'Update':('Update.ps1','-Force'),'Uninstall':('Install.ps1','-Action Uninstall'),'Diagnose':('Verify.ps1','')}
        for name,(script,args) in commands.items():
            if platform == 'windows':
                rel=name+'.cmd';data=('@echo off\r\npowershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0desktop\\windows\\'+script+'" '+args+' %*\r\nexit /b %errorlevel%\r\n').encode('ascii')
            else:
                mapping={'Install':('install.command','--launch'),'Start':('run.command',''),'Stop':('control.command','stop'),'Show':('control.command','show'),'Refresh':('control.command','refresh'),'Status':('control.command','status'),'Update':('install.command','--update --launch'),'Uninstall':('install.command','--uninstall'),'Diagnose':('verify.command','')}
                script,args=mapping[name];rel=name+'.command'
                if name == 'Update':
                    data=('#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nprofile=${WORKLOG_SCRIPTS_HOME:-"$HOME/Library/Application Support/DailyOddBuilds/WorklogScripts"}\nexec /usr/bin/osascript -l JavaScript "$root/desktop/macos/Update.js" "$root" "$profile" --force "$@"\n').encode('utf-8')
                else:
                    data=('#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec /bin/sh "$root/desktop/macos/'+script+'" '+args+' "$@"\n').encode('utf-8')
            (folder/rel).write_bytes(data);manifest.append(rel)
        # PowerShell 5.1 also reads this file with the system code page in older installers.
        (folder/'release.json').write_bytes((json.dumps({'product':'WorklogScripts','displayName':'성실삐🤖','day':'005','version':VERSION,'platform':platform,'runtime':'os-built-in','macDeviceVerified':False,'repository':'hssum9409/daily_odd_builds-public','tag':'day005-v'+VERSION},ensure_ascii=True,indent=2)+'\n').encode('utf-8'));manifest.append('release.json')
        # Text-mode writes on Windows silently turn LF into CRLF. Manifest bytes
        # must be portable: POSIX read otherwise includes CR in the file name.
        (folder/'payload.sha256').write_bytes(''.join(hashlib.sha256((folder/rel).read_bytes()).hexdigest()+'  '+rel+'\n' for rel in sorted(manifest)).encode('ascii'))
        archive=OUT/(folder.name+('.zip' if platform=='windows' else '-preview.zip'))
        update=OUT/('WorklogScripts-'+platform+'-update'+('-preview' if platform=='macos' else '')+'.zip')
        for destination,prefix in ((archive,''),(update,'WorklogScripts/')):
            with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as z:
                for rel in sorted(manifest+['payload.sha256']):
                    source=folder/rel;info=zipfile.ZipInfo(prefix+rel);info.create_system=3;info.external_attr=(0o100755 if source.suffix=='.command' else 0o100644)<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,source.read_bytes())
            item={'platform':platform,'name':destination.name,'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()};artifacts.append(item);print(json.dumps(item))
    (OUT/'SHA256SUMS.txt').write_bytes(''.join(item['sha256']+'  '+item['name']+'\n' for item in artifacts).encode('ascii'))
    (OUT/'release-manifest.json').write_bytes((json.dumps({'product':'성실삐','day':'005','version':VERSION,'tag':'day005-v'+VERSION,'macDeviceVerified':False,'artifacts':artifacts},ensure_ascii=False,indent=2)+'\n').encode('utf-8'))

if __name__=='__main__':main()
