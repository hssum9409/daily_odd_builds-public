import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DAY=86400000;
const {chromium}=await import(process.env.DC_WRITER_PLAYWRIGHT?pathToFileURL(process.env.DC_WRITER_PLAYWRIGHT).href:'playwright');
const out=path.resolve(process.env.DC_WRITER_QA_OUT || path.join(root,'.private','background-qa'));
const fixture=path.join(out,'background-fixture'),profile=path.join(out,'background-profile');
await fs.mkdir(out,{recursive:true});await fs.cp(path.join(root,'extension'),fixture,{recursive:true});
// QA-only static provider runs before the unmodified production worker on EVERY wake.
// It exists solely in this isolated fixture and never enters the package allowlist.
function syntheticProvider(){
  self.qaBoot=crypto.randomUUID();
  self.fetch=async(raw,options={})=>{
    const url=String(raw),body=options.body;
    if(url.endsWith('/.well-known/openid-configuration'))return Response.json({revocation_endpoint:'https://auth.openai.com/qa-revoke'});
    if(url.endsWith('/qa-revoke'))return new Response('',{status:200});
    if(url!=='https://auth.openai.com/api/accounts/oauth/token'||body.get('grant_type')!=='refresh_token'||body.get('client_id')!=='oaiapp_background_qa')throw Error('Unexpected fixture request');
    const {qaMode,qaStats={attempts:0,rotations:0}}=await chrome.storage.local.get(['qaMode','qaStats']);
    if(body.get('refresh_token')!==`SYNTHETIC_REFRESH_${qaStats.rotations}`)throw Error('Fixture rotation mismatch');
    qaStats.attempts++;await chrome.storage.local.set({qaStats});
    if(qaMode==='offline')throw Error('Synthetic offline');
    if(qaMode==='503')return Response.json({error:'server_error'},{status:503});
    if(qaMode==='invalid')return Response.json({error:'invalid_grant'},{status:400});
    qaStats.rotations++;await chrome.storage.local.set({qaStats});
    return Response.json({access_token:'SYNTHETIC_ACCESS',refresh_token:`SYNTHETIC_REFRESH_${qaStats.rotations}`,expires_in:3600});
  };
}
await fs.writeFile(path.join(fixture,'qa-provider.js'),`(${syntheticProvider.toString()})();\n`);
await fs.writeFile(path.join(fixture,'background.js'),`import './qa-provider.js';\n`+await fs.readFile(path.join(root,'extension/background.js'),'utf8'));
await fs.writeFile(path.join(fixture,'qa-control.html'),'<!doctype html><title>Isolated synthetic QA setup</title>');
const report={started:new Date().toISOString(),mode:'real Chrome alarms / stopped worker / browser restarts / zero open extension panels / synthetic OAuth only',checks:[],processIds:[]};
let context,worker,id,driver,cdp,versions=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=name=>{report.checks.push({name,pass:true});console.log('PASS: '+name);};
async function boot(){
  context=await chromium.launchPersistentContext(profile,{...(process.env.DC_WRITER_CHROME?{executablePath:process.env.DC_WRITER_CHROME}:{}),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run']});
  await context.route(/^https?:/,route=>route.abort());
  report.browser=context.browser().version();
  const browserCDP=await context.browser().newBrowserCDPSession();report.processIds.push((await browserCDP.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type==='browser').id);
  const loaded=await browserCDP.send('Extensions.loadUnpacked',{path:fixture});if(id)assert.equal(loaded.id,id);id=loaded.id;
  worker=context.serviceWorkers().find(w=>w.url().includes(id)) || await context.waitForEvent('serviceworker');
  driver=context.pages()[0] || await context.newPage();await driver.goto('about:blank');cdp=await context.newCDPSession(driver);versions=[];
  cdp.on('ServiceWorker.workerVersionUpdated',event=>{for(const v of event.versions){versions=versions.filter(old=>old.versionId!==v.versionId);versions.push(v);}});await cdp.send('ServiceWorker.enable');
}
async function close(){await context.close();context=null;}
async function seed(mode='ok',remainingDays=9,{legacy=false}={}){
  const p=await context.newPage();await p.goto(`chrome-extension://${id}/qa-control.html`);
  await p.evaluate(async({mode,remainingDays,legacy})=>{
    await chrome.storage.local.clear();await chrome.storage.session.clear();await chrome.alarms.clearAll();
    await chrome.storage.local.set({qaMode:mode,qaStats:{attempts:0,rotations:0}});
    const refreshExpires=Date.now()+remainingDays*86400000;
    await (await import('./credentials.js')).credentialStore.write({accessToken:'SYNTHETIC_ACCESS',refreshToken:'SYNTHETIC_REFRESH_0',clientId:'oaiapp_background_qa',expires:refreshExpires-30*86400000+3600000,...(legacy?{}:{refreshExpires}),subject:'synthetic-qa',name:'Synthetic background QA',scopes:['chatgpt.tokens.use.direct']});
  },{mode,remainingDays,legacy});await p.close();await close();await boot();
}
async function state(){return worker.evaluate(async()=>({boot:self.qaBoot,alarm:await chrome.alarms.get('chatgpt-renewal'),...(await chrome.storage.local.get(['qaStats','chatgptRenewalRetry'])),contexts:(await chrome.runtime.getContexts({contextTypes:['TAB','SIDE_PANEL']})).length}));}
async function waitSchedule(){for(let i=0;i<30;i++){const s=await state();if(s.alarm)return s;await pause(100);}throw Error('Missing background schedule');}
async function fire({stop=false}={}){
  await worker.evaluate(()=>chrome.alarms.create('chatgpt-renewal',{when:Date.now()+3000,periodInMinutes:15}));
  if(stop){
    const version=versions.find(v=>v.scriptURL===`chrome-extension://${id}/background.js`&&v.runningStatus==='running');assert.ok(version,'running worker observed');
    await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
    for(let i=0;i<40&&!versions.some(v=>v.versionId===version.versionId&&v.runningStatus==='stopped');i++)await pause(50);
    assert.ok(versions.some(v=>v.versionId===version.versionId&&v.runningStatus==='stopped'),'worker actually stopped');
  }
  // No extension pages, RPC calls, or worker evaluation until the real alarm fires.
  await pause(6000);worker=context.serviceWorkers().find(w=>w.url().includes(id));return state();
}
async function vaultPresent(){return worker.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dc-writer-credentials',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('fixture read'));});
  const found=await new Promise(resolve=>{const r=db.transaction('credentials').objectStore('credentials').get('current');r.onsuccess=()=>resolve(!!r.result);});db.close();return found;
});}
try{
  await boot();await seed('ok',11);const notDue=await waitSchedule();assert.equal(notDue.contexts,0);assert.ok(notDue.alarm.scheduledTime>Date.now()+DAY-60000);
  assert.equal((await fire()).qaStats.attempts,0);check('expired access token does not trigger background refresh with 11 days remaining');
  const newWindow=await worker.evaluate(async()=>{await chrome.alarms.clear('chatgpt-renewal');return chrome.windows.create({url:'about:blank',type:'normal'});});
  assert.ok((await waitSchedule()).alarm);assert.equal((await state()).contexts,0);await worker.evaluate(id=>chrome.windows.remove(id),newWindow.id);check('opening a Chrome window restores a lost renewal schedule without a panel');
  await seed();const initial=await waitSchedule();assert.equal(initial.contexts,0);assert.equal(initial.qaStats.attempts,0);check('Chrome restart recreates due refresh-token alarm without opening extension');
  const renewed=await fire({stop:true});assert.equal(renewed.contexts,0);assert.notEqual(initial.boot,renewed.boot);assert.equal(renewed.qaStats.rotations,1);assert.equal(renewed.qaStats.attempts,1);check('real alarm wakes stopped worker and renews with every extension page closed');
  assert.ok(renewed.alarm.scheduledTime>Date.now()+20*DAY-60000);assert.ok(renewed.alarm.scheduledTime<Date.now()+20*DAY+60000);assert.equal(await vaultPresent(),true);check('replacement credentials persist and next renewal is scheduled 20 days later');
  const duplicate=await fire();assert.equal(duplicate.qaStats.attempts,1);check('early or duplicate alarm does not refresh an unexpired token');
  await seed('503');await waitSchedule();const failed=await fire();assert.equal(failed.qaStats.attempts,1);assert.equal(failed.qaStats.rotations,0);assert.equal(failed.chatgptRenewalRetry.failures,1);assert.equal(await vaultPresent(),true);assert.ok(failed.alarm.scheduledTime>Date.now()+40000);check('background HTTP 503 preserves connection and schedules bounded retry');
  await close();await boot();const afterRestart=await waitSchedule();assert.equal(afterRestart.chatgptRenewalRetry.retryAt,failed.chatgptRenewalRetry.retryAt);assert.equal(afterRestart.qaStats.attempts,1);check('retry deadline survives browser restart without login or panel');
  // Fast-forward ONLY test retry metadata, then let Chrome deliver another real alarm.
  await worker.evaluate(async()=>{const {chatgptRenewalRetry:r}=await chrome.storage.local.get('chatgptRenewalRetry');await chrome.storage.local.set({qaMode:'ok',chatgptRenewalRetry:{...r,retryAt:0}});});
  const recovered=await fire();assert.equal(recovered.qaStats.rotations,1);assert.equal(recovered.chatgptRenewalRetry,undefined);assert.equal(recovered.contexts,0);check('background retry recovers without reopening extension or reauthorizing');
  await seed('invalid');await waitSchedule();const invalid=await fire();assert.equal(invalid.qaStats.attempts,1);assert.equal(invalid.alarm,undefined);assert.equal(await vaultPresent(),false);check('confirmed invalid grant removes saved credentials and all renewal alarms');
  await close();await boot();await pause(500);assert.equal((await state()).alarm,undefined);assert.equal(await vaultPresent(),false);check('revoked connection cannot reappear on browser restart');
  await seed('ok',0);await pause(500);const expired=await state();assert.equal(expired.alarm,undefined);assert.equal(expired.qaStats.attempts,0);assert.equal(await vaultPresent(),false);check('30 days without renewal expires locally without a refresh request');
  await close();await boot();await pause(500);assert.equal((await state()).alarm,undefined);assert.equal(await vaultPresent(),false);check('expired account remains signed out across another Chrome restart');
  await seed('ok',11,{legacy:true});const migrated=await waitSchedule();assert.ok(migrated.alarm.scheduledTime>Date.now()+DAY-60000);assert.ok(migrated.alarm.scheduledTime<Date.now()+DAY+60000);assert.equal((await fire()).qaStats.attempts,0);check('0.1.4 credentials migrate using original issuance instead of extending 30 days from startup');
  await seed();await waitSchedule();
  const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);
  // Use the same authorized panel RPC as the UI; no genuine account is involved.
  const logout=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'oauth:session',action:'disconnect'}));assert.equal(logout.ok,true);await panel.close();
  assert.equal((await state()).alarm,undefined);assert.equal(await vaultPresent(),false);check('explicit disconnect cancels scheduled renewal and deletes saved connection');
  const stale=await fire();assert.equal(stale.alarm,undefined);assert.equal(stale.contexts,0);assert.equal(await vaultPresent(),false);check('stale alarm after logout cannot renew or resurrect credentials');
  report.passed=true;
}catch(e){report.passed=false;report.failure=e.message;console.error(e);process.exitCode=1;}
finally{if(context)await close();report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'background-result.json'),JSON.stringify(report,null,2));}
