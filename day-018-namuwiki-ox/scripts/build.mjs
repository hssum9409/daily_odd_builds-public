import './verify-auth.mjs';
import {cp,mkdir,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Only the app-local generated directory is replaced. Source/user data never copied.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'dist');
if(dirname(output)!==root)throw Error('Build target escapes app root');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});await cp(resolve(root,'extension'),output,{recursive:true});
console.log('Built dist/ (dependency-free MV3 runtime)');
