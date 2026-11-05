import './verify-auth.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=await fs.readdir(path.join(root,'extension'));
for(const file of files.filter(p=>p.endsWith('.js'))){const r=spawnSync(process.execPath,['--check',path.join(root,'extension',file)],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);}
const manifest=JSON.parse(await fs.readFile(path.join(root,'extension/manifest.json'),'utf8'));
if(manifest.manifest_version!==3 || manifest.permissions.some(p=>['cookies','debugger','nativeMessaging','webRequestBlocking'].includes(p)) || manifest.host_permissions.some(p=>p.includes('*://*')||p==='<all_urls>'))throw Error('Unexpected permission');
for(const file of [manifest.background.service_worker,manifest.side_panel.default_path,'panel.css','panel.js','auth.js','credentials.js','renewal.js','editor.js','photos.js','network.js','core.js'])await fs.access(path.join(root,'extension',file));
const source=(await Promise.all(files.filter(p=>p.endsWith('.js')).map(p=>fs.readFile(path.join(root,'extension',p),'utf8')))).join('\n');
if(/\.submit\(|article_submit|upimg_file\.php|OPENAI_API_KEY|\.click\(\)/.test(source))throw Error('Unexpected submit/direct upload/API key path');
console.log(`PASS: ${files.length} extension files, JavaScript syntax, bounded permissions, no native helper/post submission/direct upload endpoint.`);
