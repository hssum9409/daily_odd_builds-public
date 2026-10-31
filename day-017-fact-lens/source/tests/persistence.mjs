// Actual Chrome/profile/IndexedDB/alarms; synthetic credentials, provider and clock.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(os.tmpdir(), 'fact-lens-persistence-'));
const extension = path.join(root, 'extension');
await cp('dist', extension, {recursive:true});
await build({entryPoints:['extension/credentials.js'],outfile:path.join(extension,'qa-vault.js'),bundle:true,format:'esm',platform:'browser'});
await writeFile(path.join(extension, 'qa-provider.js'), `
import {credentialStore} from './qa-vault.js';
const realNow=Date.now.bind(Date);
let now=realNow(), calls=0, revoked=0, failure=false;
Date.now=()=>now;
globalThis.__factLensQA={store:credentialStore,realNow,ready:chrome.storage.local.get('qaNow').then(saved=>{now=saved.qaNow||realNow()}),get calls(){return calls},get revoked(){return revoked},
 async time(value){now=value;await chrome.storage.local.set({qaNow:value})},fail(value){failure=value}};
globalThis.fetch=async(url,options)=>{
 if(String(url).endsWith('/oauth/token')){
  calls++;if(failure)throw Error('QA offline');
  if(options.body.get('grant_type')!=='refresh_token')throw Error('QA unexpected grant');
  return Response.json({access_token:'qa-access-'+calls,refresh_token:'qa-rotated-'+calls,expires_in:3600,scope:'openid chatgpt.tokens.use.direct'});
 }
 if(String(url).includes('openid-configuration'))return Response.json({revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});
 if(String(url).endsWith('/oauth/revoke')){revoked++;return new Response('',{status:200})}
 throw Error('QA blocks all other worker network requests');
};
`);
// Only fixture deviation: import a deterministic provider/clock before production code.
const { readFile }=await import('node:fs/promises');
await writeFile(path.join(extension,'background.js'),`import './qa-provider.js';\n`+(await readFile(path.join(extension,'background.js'),'utf8')).replace('queue = Promise.resolve()', 'queue = globalThis.__factLensQA.ready'));
let context,worker,base,page;
const day=86400000, issued=Date.now();
const fresh=()=>({accessToken:'qa-access',refreshToken:'qa-refresh',clientId:'oaiapp_qa',expires:issued+3600000,
 refreshExpires:issued+30*day,subject:'qa-user',name:'QA persistent account',scopes:['chatgpt.tokens.use.direct']});
async function launch(){
 context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:'chrome',headless:true,viewport:{width:440,height:1000},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
 const session=await context.browser().newBrowserCDPSession();const loaded=await session.send('Extensions.loadUnpacked',{path:extension});
 base=`chrome-extension://${loaded.id}`;
 await context.route('https://**/*',route=>route.request().url()==='https://api.openai.com/v1/models'?route.fulfill({json:{models:[{slug:'qa-model',display_name:'QA model',visibility:'list'}]}}):route.abort());
 page=await context.newPage();await page.goto(`${base}/auth-result.html`);
 await page.evaluate(()=>Promise.race([chrome.runtime.sendMessage({type:'auth.status'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('QA worker startup timeout')),8000))]));
 worker=context.serviceWorkers().filter(value=>value.url().startsWith(base)).at(-1)||await context.waitForEvent('serviceworker');
}
const rpc=type=>page.evaluate(async type=>{const r=await chrome.runtime.sendMessage({type});if(!r.ok)throw Error(r.error);return type==='auth.token'?!!r.data:r.data},type);
async function vaultView(){return worker.evaluate(async()=>{
 const credentialStore=globalThis.__factLensQA.store;
 const value=await credentialStore.read();
 return value?{expires:value.expires,refreshExpires:value.refreshExpires,rotated:value.refreshToken.startsWith('qa-rotated-')}:null;
});}
async function seed(value){await worker.evaluate(value=>globalThis.__factLensQA.store.write(value),value);}
async function restart(){await context.close();await launch();}
async function waitFor(fn,description){const start=Date.now();while(Date.now()-start<8000){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`Timeout: ${description}`);}
async function wake(){
 const previous=await worker.evaluate(()=>globalThis.__factLensQA.calls);
 await worker.evaluate(()=>chrome.alarms.create('chatgpt-renewal',{when:globalThis.__factLensQA.realNow()+100}));
 await waitFor(async()=>await worker.evaluate(async()=>{const a=await chrome.alarms.get('chatgpt-renewal');return a?.periodInMinutes===15;}),'real alarm dispatch and reschedule');
 return previous;
}
try{
 await launch();await seed(fresh());await worker.evaluate(async now=>{await chrome.storage.local.set({chatgptClientId:'oaiapp_qa'});await globalThis.__factLensQA.time(now)},issued);
 await restart();
 assert.equal((await rpc('auth.status')).connected,true);
 await page.goto(`${base}/sidepanel.html`);await page.locator('#account-toggle').filter({hasText:'ChatGPT 연결됨'}).waitFor();
 await page.getByRole('button',{name:'설정 열기',exact:true}).click();await page.getByText(/QA persistent account · 요금제 사용 연결됨/).waitFor();
 const evidence=process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(),'fact-lens-evidence');
 const {mkdir}=await import('node:fs/promises');await mkdir(evidence,{recursive:true});
 await page.screenshot({path:path.join(evidence,'persistent-settings.png'),fullPage:true});
 await page.close();
 assert.equal(await worker.evaluate(()=>globalThis.__factLensQA.calls),0);
 const encrypted=await worker.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('fact-lens-credentials',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('IDB'))});
  const record=await new Promise(resolve=>{const r=db.transaction('credentials').objectStore('credentials').get('current');r.onsuccess=()=>resolve(r.result)});db.close();
  let nonexportable=false;try{await crypto.subtle.exportKey('raw',record.key)}catch{nonexportable=true}
  return nonexportable&&!new TextDecoder().decode(record.ciphertext).includes('qa-refresh')&&!JSON.stringify(await chrome.storage.local.get(null)).includes('qa-access');
 });assert.equal(encrypted,true);
 console.log('PASS actual full Chrome restart restores encrypted IndexedDB account and connected UI; non-exportable key; no plaintext tokens');
 await worker.evaluate(value=>globalThis.__factLensQA.time(value),issued+19*day);
 await wake();assert.equal(await worker.evaluate(()=>globalThis.__factLensQA.calls),0);
 console.log('PASS closed panel: 11 days remaining and expired access token do not cause background refresh');
 await worker.evaluate(async value=>{await globalThis.__factLensQA.time(value);globalThis.__factLensQA.fail(true)},issued+20*day);
 await wake();assert.equal(await worker.evaluate(()=>globalThis.__factLensQA.calls),1);assert.ok(await vaultView());
 const retry=await worker.evaluate(async()=> (await chrome.storage.local.get('chatgptRenewalRetry')).chatgptRenewalRetry);
 assert.equal(retry.failures,1);assert.equal(retry.retryAt,issued+20*day+60000);
 await worker.evaluate(async value=>{await globalThis.__factLensQA.time(value);globalThis.__factLensQA.fail(false)},retry.retryAt);
 await wake();await waitFor(async()=>(await vaultView())?.rotated,'rotation commits');
 const rotated=await vaultView();assert.equal(rotated.refreshExpires,retry.retryAt+30*day);assert.equal(await worker.evaluate(()=>globalThis.__factLensQA.calls),2);
 await wake();assert.equal(await worker.evaluate(()=>globalThis.__factLensQA.calls),2);
 console.log('PASS real Chrome alarm with panel closed: 10-day boundary, offline retry, persisted rotation, next 20-day schedule, no duplicate refresh');
 page=await context.newPage();await page.goto(`${base}/auth-result.html`);
 assert.equal((await rpc('auth.logout')).revoked,true);assert.equal(await vaultView(),null);
 await restart();assert.equal((await rpc('auth.status')).connected,false);assert.equal(await vaultView(),null);
 console.log('PASS logout durably deletes account and restart cannot revive it');
 await seed(fresh());await worker.evaluate(value=>globalThis.__factLensQA.time(value),issued+30*day);
 await restart();assert.equal((await rpc('auth.status')).connected,false);assert.equal(await vaultView(),null);assert.equal(await worker.evaluate(()=>globalThis.__factLensQA.calls),0);
 assert.match((await rpc('auth.status')).error,/유효기간/);
 console.log('PASS simulated 30-day absence then real restart requires reconnect without refresh request');
 // Durable storage removed/corrupted must fail closed on a new worker owner.
 await seed(fresh());await worker.evaluate(value=>globalThis.__factLensQA.time(value),issued);
 await worker.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('fact-lens-credentials',1);r.onsuccess=()=>resolve(r.result)});
  await new Promise((resolve,reject)=>{const tx=db.transaction('credentials','readwrite');tx.objectStore('credentials').put({version:1},'current');tx.oncomplete=resolve;tx.onerror=reject});db.close();
 });
 await restart();assert.equal((await rpc('auth.status')).connected,false);assert.match((await rpc('auth.status')).error,/저장된 ChatGPT 연결/);
 console.log('PASS corrupted durable credentials yield safe reconnect notice; no secret logged');
 console.log('Provider and time are synthetic. Actual elapsed 30-day usage, real OAuth issuance/rotation and store installation remain unverified.');
}finally{
 await context?.close();
 if(root.startsWith(path.join(os.tmpdir(),'fact-lens-persistence-')))await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:500});
}
