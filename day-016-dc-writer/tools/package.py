from pathlib import Path
import hashlib,json,zipfile,subprocess
subprocess.run(["node",str(Path(__file__).with_name("verify-auth.mjs"))],check=True)
root=Path(__file__).resolve().parents[1]
source=root/'extension'
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
out=root/'dist'
out.mkdir(exist_ok=True)
target=out/f'dc-writer-{manifest["version"]}-development.zip'
files=sorted(p for p in source.rglob('*') if p.is_file())
expected={'auth.js','background.js','core.js','credentials.js','editor.js','manifest.json','network.js','panel.css','panel.html','panel.js','photos.js','renewal.js'}
expected|={f'vendor/chatgpt-auth/{name}' for name in ['chrome.js','connection.js','credentials.js','renewal.js','LICENSE.txt','module.json']}
assert {p.relative_to(source).as_posix() for p in files}==expected, 'Review package allowlist when adding files'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
    for p in files:archive.write(p,p.relative_to(source).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert sorted(archive.namelist())==sorted(p.relative_to(source).as_posix() for p in files)
receipt={'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':[p.relative_to(source).as_posix() for p in files],'developmentOnly':True}
(out/'package-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(target)
print(receipt['sha256'])
