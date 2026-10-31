import {chromium} from 'playwright';import {build} from 'esbuild';import {mkdtemp,cp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
if(process.env.FACT_LENS_REPORT_LIVE!=='1')throw Error('Set FACT_LENS_REPORT_LIVE=1 for one synthetic production report');
const work=await mkdtemp(path.join(os.tmpdir(),'factlens-report-live-')),extension=path.join(work,'extension');await cp('dist',extension,{recursive:true});
await build({stdin:{contents:`export {submitDiagnosticReport} from './extension/diagnostics.js'; export {makeDiagnosticReport} from './shared/diagnostics.mjs';`,resolveDir:process.cwd(),sourcefile:'live-probe.js'},bundle:true,format:'esm',platform:'browser',outfile:path.join(extension,'live-probe.js')});
await writeFile(path.join(extension,'live-probe.html'),'<meta charset="utf-8"><title>Fact Lens synthetic diagnostic transport QA</title>');
let context;
try{
 context=await chromium.launchPersistentContext(path.join(work,'profile'),{headless:true,channel:'chrome',ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});const cdp=await context.browser().newBrowserCDPSession();await cdp.send('Extensions.loadUnpacked',{path:extension});const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/live-probe.html`);
 const requests=[];page.on('request',request=>{if(request.url().includes('/factLensDiagnostics')){const h=request.headers();assert.equal(h.authorization,undefined);assert.equal(h.cookie,undefined);if(request.method()==='POST')requests.push(request.postDataJSON());}});
 const receipt=await page.evaluate(async()=>{const {submitDiagnosticReport,makeDiagnosticReport}=await import('./live-probe.js');const payload=makeDiagnosticReport({phase:'기타',model:'gpt-6.1-terra',code:'schema_mismatch',validation:'source_mapping',validationCode:'coverage_missing',validationCounts:{inputBlocks:3,missingBlocks:1},textLength:150},chrome.runtime.getManifest().version,156,crypto.randomUUID());const first=await submitDiagnosticReport(payload);const second=await submitDiagnosticReport(payload);return{payload,first,second};});
 assert.equal(requests.length,2);assert.deepEqual(receipt.first,receipt.second);assert.deepEqual(requests[0],requests[1]);
 const file=path.join(os.tmpdir(),'fact-lens-live-report-0.1.16.json');await writeFile(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({browser:context.browser().version(),receipt:receipt.first,requests:requests.length,evidence:file}));
 const endpoint='https://asia-northeast3-daily-odd-builds-portal.cloudfunctions.net/factLensDiagnostics';
 assert.equal((await fetch(endpoint)).status,405);assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:JSON.stringify(receipt.payload)})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...receipt.payload,token:'not-a-real-token'})})).status,400);
 const privateRead=await fetch(`https://firestore.googleapis.com/v1/projects/daily-odd-builds-portal/databases/(default)/documents/factlens_error_reports_v1/${receipt.payload.reportId}`);assert.equal(privateRead.status,403);
 console.log('PASS real Chrome extension-origin upload and duplicate receipt, no auth/cookies, GET/website origin/extra sensitive field rejected, anonymous Firestore read denied');
}finally{await context?.close();if(work.startsWith(path.join(os.tmpdir(),'factlens-report-live-')))await rm(work,{recursive:true,force:true});}
