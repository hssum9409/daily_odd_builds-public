import './verify-auth.mjs';
import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
async function walk(dir){const out=[];for(const d of await readdir(dir,{withFileTypes:true})){if(d.isDirectory())out.push(...await walk(`${dir}/${d.name}`));else out.push(`${dir}/${d.name}`);}return out;}
for(const file of (await walk('extension')).filter(f=>/\.(mjs|js)$/.test(f))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status)throw Error(r.stderr);}
const m=JSON.parse(await readFile('extension/manifest.json','utf8'));
const pkg=JSON.parse(await readFile('package.json','utf8')),meta=JSON.parse(await readFile('metadata.json','utf8'));
assert.equal(m.version,pkg.version);assert.equal(meta.version,pkg.version);
assert.ok(!m.host_permissions.includes('<all_urls>'));assert.ok(!m.permissions.includes('tabs'));
assert.deepEqual(m.host_permissions,['https://namu.wiki/*','https://auth.openai.com/*','https://api.openai.com/*','http://127.0.0.1/*']);
for(const f of [...Object.values(m.icons),m.side_panel.default_path,m.background.service_worker])await readFile(`extension/${f}`);
for(const f of (await walk('extension')).filter(f=>/\.html$/.test(f))){const h=await readFile(f,'utf8');assert.ok(!/<script[^>]*>\s*[^<\s]/.test(h));for(const [,asset] of h.matchAll(/(?:src|href)="(assets\/[^"?#]+)"/g))await readFile(`extension/${asset}`);}
console.log('PASS syntax, packaged references, least-privilege manifest and CSP');
