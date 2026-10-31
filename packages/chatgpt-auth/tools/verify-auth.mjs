// Copied into the consuming app by vendor.mjs; verifies its pinned runtime.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const vendor=join(root,'extension/vendor/chatgpt-auth');
const manifest=JSON.parse(await readFile(join(vendor,'module.json'),'utf8'));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(manifest.name!=='@daily-odd-builds/chatgpt-auth' || manifest.version!==pkg.chatgptAuth?.version)throw Error('ChatGPT auth module version does not match the app pin');
const expected=['LICENSE.txt','chrome.js','connection.js','credentials.js','renewal.js'];
if(JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(expected))throw Error('Unexpected ChatGPT auth manifest files');
if(JSON.stringify((await readdir(vendor)).sort())!==JSON.stringify([...expected,'module.json'].sort()))throw Error('Unexpected vendored files');
for(const name of expected){
  const hash=createHash('sha256').update(await readFile(join(vendor,name))).digest('hex');
  if(hash!==manifest.files[name])throw Error(`Vendored ChatGPT auth file changed: ${name}`);
}
console.log(`Verified ChatGPT auth ${manifest.version}: pinned files and SHA-256`);
