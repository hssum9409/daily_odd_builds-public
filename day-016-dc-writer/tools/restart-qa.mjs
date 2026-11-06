import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {installMockAuth} from './mock-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.DC_WRITER_PLAYWRIGHT?pathToFileURL(process.env.DC_WRITER_PLAYWRIGHT).href:'playwright');
const out=path.resolve(process.env.DC_WRITER_QA_OUT || path.join(root,'.private','restart-qa'));
await fs.mkdir(out,{recursive:true});
const profile=path.join(out,'restart-profile'),report={started:new Date().toISOString(),mode:'real Chrome process restarts / synthetic OAuth and Responses / isolated test profile',checks:[],processIds:[],errors:[]};
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const keys={jwk:{...publicKey.export({format:'jwk'}),kid:'qa-only',alg:'RS256',use:'sig'},privateJwk:privateKey.export({format:'jwk'})};
let context,worker,id,panel,authorizations=0,generations=0;
const check=name=>{report.checks.push({name,pass:true});console.log('PASS: '+name);};
async function boot(){
  context=await chromium.launchPersistentContext(profile,{...(process.env.DC_WRITER_CHROME?{executablePath:process.env.DC_WRITER_CHROME}:{}),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run'],viewport:{width:440,height:1000}});
  report.browser=context.browser().version();
  const cdp=await context.browser().newBrowserCDPSession();report.processIds.push((await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id);
  const extension=await cdp.send('Extensions.loadUnpacked',{path:path.join(root,'extension')});
  if(id)assert.equal(extension.id,id,'extension identity must be stable');id=extension.id;
  worker=context.serviceWorkers().find(w=>w.url().includes(id)) || await context.waitForEvent('serviceworker');await installMockAuth(worker,keys);
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin==='https://auth.openai.com'&&u.pathname==='/api/accounts/authorize'){
      authorizations++;await worker.evaluate(data=>chrome.storage.session.set({qaAuthorize:data}),{nonce:u.searchParams.get('nonce'),challenge:u.searchParams.get('code_challenge')});
      const callback=new URL(u.searchParams.get('redirect_uri'));callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('client_id','oaiapp_qa');callback.searchParams.set('code','FAKE_QA_CODE');return route.fulfill({status:302,headers:{location:callback.href}});
    }
    if(u.origin==='https://api.openai.com'&&u.pathname==='/v1/models')return route.fulfill({json:{models:[{visibility:'list',slug:'qa-model',display_name:'QA 전용 모델'},{visibility:'list',slug:'qa-alternate',display_name:'QA 두 번째 모델'}]}});
    if(u.origin==='https://api.openai.com'&&u.pathname==='/v1/responses'){
      generations++;
      const body = route.request().postDataJSON();
      assert.equal(body.model, 'qa-alternate');
      assert.deepEqual(body.reasoning, {effort: 'medium'});
      assert.equal(body.service_tier, 'fast');
      const doc={title:'브라우저 재시작 검증',blocks:[{type:'paragraph',text:'Chrome 재시작 후 저장된 연결로 만든 모의 초안입니다.'}]};
      return route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(doc)})}\n\ndata: {"type":"response.completed"}\n\n`});
    }
    if(['http:','https:'].includes(u.protocol))return route.abort();return route.continue();
  });
}
async function openPanel(){
  panel=await context.newPage();panel.on('pageerror',e=>report.errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/panel.html`);await panel.waitForFunction(()=>!!document.querySelector('#prepare-first')?.onclick);
}
async function restored(){await panel.waitForFunction(()=>!document.querySelector('#connected').hidden&&document.querySelector('#model').value==='qa-alternate');}
async function accountView(){if(!await panel.locator('#welcome').isVisible())await panel.locator('#account-toggle').click();}
async function inspectVault(){return worker.evaluate(async()=>{
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('dc-writer-credentials',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(Error('QA DB read failed'));});
  const record=await new Promise((res,rej)=>{const r=db.transaction('credentials').objectStore('credentials').get('current');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(Error('QA record read failed'));});db.close();
  if(!record)return {present:false};
  let exportRejected=false;try{await crypto.subtle.exportKey('raw',record.key);}catch{exportRejected=true;}
  const plaintextStorage=JSON.stringify({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null),session:await chrome.storage.session.get(null)});
  return {present:true,version:record.version,keyExtractable:record.key.extractable,exportRejected,recordKeys:Object.keys(record).sort(),plaintextAbsent:!plaintextStorage.includes('FAKE_QA_ACCESS')&&!plaintextStorage.includes('FAKE_QA_REFRESH'),ciphertextHasPlaintext:new TextDecoder().decode(record.ciphertext).includes('FAKE_QA_')};
});}
async function expireSavedToken(){await panel.evaluate(async()=>{const {credentialStore}=await import('./credentials.js');const session=await credentialStore.read();session.expires=0;await credentialStore.write(session);});}
async function shutdown(){await context.close();context=null;}
try{
  await boot();await openPanel();
  await panel.evaluate(async()=>{await (await import('./credentials.js')).credentialStore.write(null);await chrome.storage.local.clear();await chrome.storage.session.clear();await (await import('./photos.js')).draftStorage('clear');});
  // Reload the extension so its owner also starts without the prior test run's memory.
  await shutdown();report.processIds=[];await boot();await openPanel();await panel.locator('#connect').click();await panel.waitForFunction(()=>document.querySelector('#model').value==='qa-model');
  await panel.locator('#model').selectOption('qa-alternate');await panel.waitForFunction(async()=>(await chrome.storage.local.get('chatgptModel')).chatgptModel==='qa-alternate');assert.equal(authorizations,1);check('synthetic login with PKCE/OIDC validation and initial refresh');
  await panel.locator('#settings-toggle').click();
  await panel.locator('#settings-effort').selectOption('medium');
  await panel.locator('#settings-fast').selectOption('on');
  await panel.waitForFunction(async () => {
    const {chatgptEffort, chatgptFast} = await chrome.storage.local.get(['chatgptEffort', 'chatgptFast']);
    return chatgptEffort === 'medium' && chatgptFast === true;
  });
  const vault=await inspectVault();assert.equal(vault.present,true);assert.equal(vault.keyExtractable,false);assert.equal(vault.exportRejected,true);assert.equal(vault.plaintextAbsent,true);assert.equal(vault.ciphertextHasPlaintext,false);assert.deepEqual(vault.recordKeys,['ciphertext','iv','key','version']);report.vault=vault;check('encrypted credential record and non-exportable key persist without plaintext Chrome storage');
  await expireSavedToken();await worker.evaluate(()=>chrome.storage.session.set({qaMemoryMarker:true}));await shutdown();
  await boot();assert.notEqual(report.processIds[0],report.processIds[1]);assert.equal(await worker.evaluate(async()=>!!(await chrome.storage.session.get('qaMemoryMarker')).qaMemoryMarker),false);
  await worker.evaluate(()=>{self.qaAuth.expectedRefresh='FAKE_QA_REFRESH_ROTATED';});await openPanel();await restored();assert.equal(authorizations,1);assert.equal(await worker.evaluate(()=>self.qaAuth.refreshes),1);check('new Chrome process restores account/model and renews expired access with saved replacement refresh token');
  await panel.screenshot({path:path.join(out,'restart-restored-account.png'),fullPage:true});
  await panel.locator('#prepare-first').click();await panel.locator('#source').fill('재시작 검증용 가상 메모');await panel.locator('[data-mode="structure"]').click();await panel.locator('#generate').click();await panel.waitForFunction(()=>document.querySelector('#preview').textContent.includes('Chrome 재시작 후'));assert.equal(generations,1);check('restored connection generates a synthetic Responses draft with the saved model, effort and Fast');
  // A temporary provider error must not destroy the durable connection.
  await expireSavedToken();await shutdown();await boot();await worker.evaluate(()=>{self.qaAuth.refreshError={code:'server_error',status:503};});await openPanel();await panel.waitForFunction(()=>document.querySelector('#message').textContent.includes('HTTP 503'));assert.equal((await inspectVault()).present,true);check('restart during temporary refresh failure keeps encrypted credentials');
  await worker.evaluate(()=>{self.qaAuth.refreshError=null;});await panel.reload();await restored();assert.equal(authorizations,1);check('retry after transient provider error restores without login');
  // A confirmed invalid grant clears persisted credentials and cannot return next boot.
  await expireSavedToken();await shutdown();await boot();await worker.evaluate(()=>{self.qaAuth.refreshError={code:'invalid_grant',status:400};});await openPanel();await panel.waitForFunction(()=>document.querySelector('#message').textContent.includes('다시 연결'));assert.equal((await inspectVault()).present,false);check('invalid refresh grant deletes persistent credentials');
  await shutdown();await boot();await openPanel();await panel.waitForFunction(()=>document.querySelector('#connected').hidden);assert.equal((await inspectVault()).present,false);check('invalidated account remains signed out after browser restart');
  await accountView();await panel.locator('#connect').click();await panel.waitForFunction(()=>document.querySelector('#model').value==='qa-alternate');await panel.locator('#disconnect').click();await panel.waitForFunction(()=>!document.querySelector('#disconnect').disabled && document.querySelector('#connected').hidden);assert.equal((await inspectVault()).present,false);assert.equal(await worker.evaluate(()=>self.qaAuth.revocations),1);check('disconnect revokes and deletes the ciphertext and key');
  await shutdown();await boot();await openPanel();assert.equal((await inspectVault()).present,false);assert.equal(await panel.locator('#model option').count(),1);check('logout survives complete browser restart');
  assert.deepEqual(report.errors,[]);check('no extension page errors');report.passed=true;
}catch(e){report.passed=false;report.failure=e.message;console.error('FAIL: '+e.message);if(panel&&!panel.isClosed())await panel.screenshot({path:path.join(out,'restart-failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{if(context)await shutdown();report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'restart-result.json'),JSON.stringify(report,null,2));}
