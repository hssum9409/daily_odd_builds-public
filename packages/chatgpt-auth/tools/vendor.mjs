import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),app=resolve(process.argv[2] || '');
if(!process.argv[2])throw Error('Usage: node tools/vendor.mjs APP_ROOT');
await readFile(join(app,'extension/manifest.json'));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),out=join(app,'extension/vendor/chatgpt-auth');await mkdir(out,{recursive:true});
const files={};for(const name of (await readdir(join(root,'src'))).sort()){
 if(!name.endsWith('.js'))continue;
 const bytes=await readFile(join(root,'src',name));await writeFile(join(out,name),bytes);files[name]=createHash('sha256').update(bytes).digest('hex');
}
await copyFile(join(root,'LICENSE'),join(out,'LICENSE.txt'));files['LICENSE.txt']=createHash('sha256').update(await readFile(join(out,'LICENSE.txt'))).digest('hex');
await writeFile(join(out,'module.json'),JSON.stringify({name:pkg.name,version:pkg.version,source:`https://github.com/hssum9409/daily_odd_builds-public/tree/chatgpt-auth-v${pkg.version}/packages/chatgpt-auth`,files},null,2)+'\n');
const scripts=(await readdir(app)).includes('scripts')?'scripts':'tools';
await copyFile(join(root,'tools/verify-auth.mjs'),join(app,scripts,'verify-auth.mjs'));
console.log(`Vendored ${pkg.name}@${pkg.version} into ${app}`);
