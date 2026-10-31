import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const folder of ['src','tools','tests'])for(const name of await readdir(new URL('../'+folder+'/',import.meta.url))){
 if(!/\.(js|mjs)$/.test(name))continue;
 const file=fileURLToPath(new URL('../'+folder+'/'+name,import.meta.url)),r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
}
console.log('PASS shared authentication syntax');
