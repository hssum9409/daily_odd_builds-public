import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {installMockAuth} from './mock-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.DC_WRITER_PLAYWRIGHT?pathToFileURL(process.env.DC_WRITER_PLAYWRIGHT).href:'playwright');
const live=process.argv.includes('--live'),visible=process.argv.includes('--interactive'),textOnly=process.argv.includes('--text-only');
const out=path.resolve(process.env.DC_WRITER_QA_OUT || path.join(root,'.private','qa'));
await fs.mkdir(out,{recursive:true});
const report={mode:live?'live DC editor / real temporary image upload / no posting':'real Chrome MV3 / synthetic DC and OAuth providers',started:new Date().toISOString(),browserPlugin:'Browser plugin not available; Playwright with installed Chrome in isolated profile',checks:[],errors:[],blockedPosts:0};
const context=await chromium.launchPersistentContext(path.join(out,`${live?'live':'fixture'}-profile`),{
  ...(process.env.DC_WRITER_CHROME?{executablePath:process.env.DC_WRITER_CHROME}:{}),headless:!visible,
  ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run'],viewport:{width:1400,height:1000}
});
const check=(name,evidence)=>{report.checks.push({name,pass:true,...evidence});console.log(`PASS: ${name}`);};
let panel,editor,uploaded=0,postRequests=0;
try{
  report.browser=context.browser().version();
  const cdp=await context.browser().newBrowserCDPSession();const extension=await cdp.send('Extensions.loadUnpacked',{path:path.join(root,'extension')});
  let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=extension.id || new URL(worker.url()).hostname;
  const canvasPage=await context.newPage();
  const photoBytes=Buffer.from(await canvasPage.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=220;const x=c.getContext('2d');x.fillStyle='#e8f1ff';x.fillRect(0,0,360,220);x.fillStyle='#0658f7';x.fillRect(20,20,320,100);x.fillStyle='#ffffff';x.font='bold 20px sans-serif';x.fillText('DC WRITER UPLOAD TEST',34,76);x.fillStyle='#142c55';x.font='16px sans-serif';x.fillText('Temporary attachment / no post',28,165);return c.toDataURL('image/png').split(',')[1];}),'base64');
  await fs.writeFile(path.join(out,'test-photo.png'),photoBytes);await canvasPage.close();
  let refreshes=0,aiCalls=0,nonce,challenge,providerHtmlError=false;
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'qa-only',alg:'RS256',use:'sig'};
  const mockKeys={jwk,privateJwk:privateKey.export({format:'jwk'})};
  if(!live)await installMockAuth(worker,mockKeys);
  const jwt=()=>{const a=Buffer.from(JSON.stringify({alg:'RS256',kid:'qa-only'})).toString('base64url'),b=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_qa',sub:'synthetic-qa',email:'synthetic@example.invalid',exp:Math.floor(Date.now()/1000)+3600,nonce})).toString('base64url');return `${a}.${b}.${crypto.sign('RSA-SHA256',Buffer.from(`${a}.${b}`),privateKey).toString('base64url')}`;};
  const fixture=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>DC writer controlled editor fixture</title><style>body{font:16px sans-serif;padding:30px;color:#15274a}#subject{display:block;width:900px;font:24px sans-serif;padding:12px;margin-bottom:20px}.note-editable{width:900px;min-height:400px;border:1px solid #ccc;padding:20px;line-height:1.7}.note-editable img{max-width:360px}#submit{margin-top:20px}</style><h1>디시 편집기 제어용 fixture · 실제 서비스 아님</h1><input id="subject" value="기존 제목"><textarea id="memo" hidden></textarea><div class="note-editable" contenteditable="true"><p>기존 본문을 보존합니다.</p></div><button id="submit">등록</button><script>
  var attachments=[],upload_count_file=50,phashPending=0;const editable=document.querySelector('.note-editable');const handlers=new Map();
  function jQuery(value){if(value===document)return{on(name,cb){handlers.set(name,cb);return this},off(ns){for(const key of handlers.keys())if(key.includes(ns))handlers.delete(key);return this}};return{data(name){return name==='summernote'?true:null},summernote(command,value){if(command==='code'){if(value!==undefined)editable.innerHTML=value;return editable.innerHTML}if(command==='focus'){editable.focus();return}if(command==='createRange')return{collapse(){return this},select(){return this}}}};}
  window.jQuery=jQuery;function emit(kind,response){for(const [name,cb]of handlers)if(name.startsWith(kind))cb(null,{}, {url:'https://upimg.dcinside.com/upimg_file.php'},response)}
  function imageUploader(file){const form=new FormData();form.append('files[]',file);fetch('https://upimg.dcinside.com/upimg_file.php?id=dcwriterqa',{method:'POST',body:form}).then(r=>r.json()).then(data=>{emit('ajaxSuccess',data);const f=data.files[0];if(f.error)return;attachments.push({file_temp_no:f.file_temp_no,imageurl:f.url,filename:file.name,phash:'qa-phash'});const img=document.createElement('img');img.src=f.url;img.dataset.tempno=f.file_temp_no;img.dataset.phash='qa-phash';editable.append(img)}).catch(()=>emit('ajaxError'));}
  document.querySelector('#submit').onclick=()=>fetch('https://gall.dcinside.com/board/forms/article_submit',{method:'POST'});
  </script></html>`;
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(req.method()==='POST'&&u.hostname.endsWith('dcinside.com')&&u.hostname!=='upimg.dcinside.com'){if(u.pathname.includes('article_submit'))postRequests++;report.blockedPosts++;report.blockedPaths=[...new Set([...(report.blockedPaths || []),u.pathname])];return route.abort();}
    if(!live){
      if(u.hostname==='gall.dcinside.com'&&u.pathname.endsWith('/board/write/'))return route.fulfill({contentType:'text/html',body:fixture});
      if(u.hostname==='upimg.dcinside.com'){
        uploaded++;const fail=await editor.evaluate(()=>!!window.__failUpload);
        return route.fulfill({contentType:'application/json',body:JSON.stringify({files:[fail?{error:'Synthetic rejection'}:{url:`https://${uploaded%2?'dccdn11.dcinside.co.kr':'dcimg1.dcinside.com'}/qa-${uploaded}.png`,file_temp_no:`qa-${uploaded}`} ]})});
      }
      if(['dcimg1.dcinside.com','dccdn11.dcinside.co.kr'].includes(u.hostname))return route.fulfill({contentType:'image/png',body:photoBytes});
      if(u.hostname==='auth.openai.com'&&u.pathname==='/api/accounts/authorize'){
        if(providerHtmlError)return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Controlled login failure</title><script>fetch("/api/accounts/qa-bootstrap").catch(()=>{})</script>Provider error fixture'});
        nonce=u.searchParams.get('nonce');challenge=u.searchParams.get('code_challenge');await worker.evaluate(data=>chrome.storage.session.set({qaAuthorize:data}),{nonce,challenge});const callback=new URL(u.searchParams.get('redirect_uri'));callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('code','FAKE_QA_CODE');callback.searchParams.set('client_id','oaiapp_qa');return route.fulfill({status:302,headers:{location:callback.href}});
      }
      if(u.hostname==='auth.openai.com'&&u.pathname==='/api/accounts/qa-bootstrap')return route.fulfill({status:403,contentType:'text/html',body:'<!doctype html>Controlled HTML error response'});
      if(u.hostname==='auth.openai.com'&&u.pathname==='/api/accounts/oauth/token'){
        const body=new URLSearchParams(req.postData());
        if(body.get('grant_type')==='refresh_token')refreshes++;
        else{assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),challenge);assert.equal(body.get('client_id'),'oaiapp_qa');}
        return route.fulfill({contentType:'application/json',body:JSON.stringify({access_token:'FAKE_QA_ACCESS',refresh_token:'FAKE_QA_REFRESH',id_token:jwt(),expires_in:body.get('grant_type')==='refresh_token'?3600:1,scope:'openid profile email chatgpt.tokens.use.direct'})});
      }
      if(u.hostname==='auth.openai.com'&&u.pathname==='/.well-known/openid-configuration')return route.fulfill({json:{issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/qa-jwks',revocation_endpoint:'https://auth.openai.com/qa-revoke'}});
      if(u.hostname==='auth.openai.com'&&u.pathname==='/qa-jwks')return route.fulfill({json:{keys:[jwk]}});
      if(u.hostname==='auth.openai.com'&&u.pathname==='/qa-revoke')return route.fulfill({status:200,body:''});
      if(u.hostname==='api.openai.com'&&u.pathname==='/v1/models')return route.fulfill({json:{models:[{visibility:'list',slug:'qa-alternate',display_name:'QA 두 번째 모델'},{visibility:'list',slug:'gpt-6-luna',display_name:'GPT-6 Luna'}]}});
      if(u.hostname==='api.openai.com'&&u.pathname==='/v1/responses'){
        aiCalls++;const body=req.postDataJSON();assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.stream,true);
        assert.deepEqual(body.reasoning, {effort: 'medium'});
        assert.equal(body.service_tier, 'fast');
        const input=JSON.parse(body.input[0].content[0].text);
        assert.equal(input.writingGuide.primary,'reference');assert.deepEqual(input.writingGuide.priority,['reference','instructions','template','style']);assert.ok(!input.source.startsWith('검증용 가상 메모'));assert.ok(body.instructions.includes('레퍼런스를 최우선'));
        const output={title:'브라우저 검증용 초안',blocks:[{type:'paragraph',text:'검증용 가상 메모 : <script>문자 그대로 표시</script>\n사진과 본문을 함께 준비했습니다.'},{type:'heading',text:'확인한 내용'},...input.photos.map(p=>({type:'image',id:p.id}))]};
        const sse=`data: ${JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(output)})}\n\ndata: {"type":"response.completed"}\n\n`;
        return route.fulfill({contentType:'text/event-stream',body:sse});
      }
      if(u.hostname==='auth.openai.com'||u.hostname==='api.openai.com')return route.abort();
    }
    return route.continue();
  });
  editor=await context.newPage();await editor.goto(live?'https://gall.dcinside.com/mgallery/board/write/?id=thesingularity':'https://gall.dcinside.com/board/write/?id=dcwriterqa',{waitUntil:'domcontentloaded',timeout:60000});
  if(live){
    editor.on('dialog',async d=>{report.siteDialogs=[...(report.siteDialogs||[]),d.message().slice(0,200)];await d.dismiss();});
    editor.on('request',r=>{if(new URL(r.url()).hostname==='upimg.dcinside.com'){report.uploadRequests=(report.uploadRequests||0)+1;console.log('LIVE: native upload request sent');}});
    editor.on('requestfailed',r=>{if(new URL(r.url()).hostname==='upimg.dcinside.com')report.uploadNetworkFailure=r.failure()?.errorText;});
    editor.on('response',async r=>{if(new URL(r.url()).hostname==='upimg.dcinside.com'){report.uploadHttpStatus=r.status();try{const value=await r.json();report.uploadResponse={keys:Object.keys(value),fileCount:value.files?.length,error:value.files?.[0]?.error || null};}catch{report.uploadResponse={json:false}}console.log(`LIVE: native upload HTTP ${r.status()}`);}});
    editor.on('pageerror',e=>{report.sitePageErrors=[...(report.sitePageErrors||[]),e.message.slice(0,200)];});
  }
  await editor.waitForFunction(()=>window.jQuery?.('#memo').data('summernote'),{},{timeout:30000});
  const before=await editor.evaluate(()=>({html:jQuery('#memo').summernote('code'),title:document.querySelector('#subject').value}));
  panel=await context.newPage();panel.on('pageerror',e=>report.errors.push(e.message));panel.on('console',m=>{if(m.type()==='error')report.errors.push(m.text().slice(0,160));});
  await panel.goto(`chrome-extension://${id}/panel.html`);await panel.waitForFunction(()=>document.querySelector('#prepare-first')?.onclick);
  // A persistent QA profile must not seed a previous run's draft into this run.
  if(!live)await panel.evaluate(()=>chrome.runtime.sendMessage({type:'oauth:session',action:'disconnect'}));
  await panel.evaluate(async()=>{await (await import('./photos.js')).draftStorage('clear');await chrome.storage.local.clear();});await panel.reload();await panel.waitForFunction(()=>document.querySelector('#prepare-first')?.onclick);
  await panel.setViewportSize({width:440,height:1000});await panel.screenshot({path:path.join(out,live?'live-01-connect.png':'01-connect.png')});
  assert.equal(await panel.title(),'디시 글쓰기 도우미');assert.ok(await panel.locator('h1').innerText());check('page identity / nonblank / no framework overlay');
  await panel.locator('#prepare-first').click();await panel.locator('#source').fill('첫 줄은 그대로 유지합니다.\n\n<script>이 부분도 문자입니다.</script>\n사진을 아래에 배치합니다.');await panel.locator('#title').fill('디시 글쓰기 도우미 업로드 테스트');
  const files=textOnly?[]:[{name:'dc-writer-test.png',mimeType:'image/png',buffer:photoBytes}];
  if(!live)files.push({name:'dc-writer-test-2.png',mimeType:'image/png',buffer:photoBytes});
  if(files.length)await panel.locator('#files').setInputFiles(files);await panel.waitForFunction(n=>document.querySelectorAll('.photo').length===n,files.length);await panel.waitForFunction(()=>!document.querySelector('#generate').disabled);
  if(!live){
    await panel.locator('#photos .photo').first().locator('input').fill('첫 사진 설명');
    await panel.locator('summary').filter({hasText:'저장한 양식'}).click();
    await panel.locator('#template').fill('요약 → 사진 → 본문');await panel.locator('#save-template').click();await panel.waitForFunction(()=>document.querySelector('#saved-template').options.length===2);
  }
  await panel.evaluate(()=>scrollTo(0,0));await panel.waitForTimeout(100);await panel.screenshot({path:path.join(out,live?'live-02-compose.png':'02-compose.png'),fullPage:true});
  await panel.locator('#generate').click();await panel.locator('#preview-view').waitFor({state:'visible'});
  await panel.waitForFunction(()=>!!document.querySelector('#target').value&&!document.querySelector('#apply').disabled);
  await panel.evaluate(()=>scrollTo(0,0));await panel.waitForTimeout(100);await panel.screenshot({path:path.join(out,live?'live-03-preview.png':'03-preview.png'),fullPage:true});
  assert.equal(await panel.locator('#preview script').count(),0);assert.match(await panel.locator('#preview').innerText(),/<script>/);check('original text preserved / HTML escaped / photo preview');
  await panel.locator('#apply').click();
  await panel.waitForFunction(()=>!document.querySelector('#apply').disabled,{},{timeout:80000});
  const message=await panel.locator('#message').innerText();
  if(!message.includes('편집기에 적용했습니다.'))throw Error(`Editor apply failed: ${message}`);
  const applied=await editor.evaluate(()=>({title:document.querySelector('#subject').value,text:document.querySelector('.note-editable').innerText,images:[...document.querySelector('.note-editable').querySelectorAll('img[data-tempno]')].map(i=>({metadata:!!i.dataset.tempno,hash:!!i.dataset.phash,dcHost:['.dcinside.com','.dcinside.co.kr'].some(host=>new URL(i.src).hostname.endsWith(host)),loaded:i.complete&&i.naturalWidth>0})),attachmentCount:typeof attachments!=='undefined'?attachments.length:null,uploadStatus:document.querySelector('#upload_status')?.value || null}));
  await editor.waitForFunction(()=>[...document.querySelector('.note-editable').querySelectorAll('img[data-tempno]')].every(i=>i.complete&&i.naturalWidth>0),{},{timeout:20000});
  assert.ok(applied.images.length>=files.length);assert.ok(applied.images.every(i=>i.metadata&&i.dcHost));assert.ok(applied.attachmentCount>=files.length);
  if(!live){assert.match(applied.text,/기존 본문을 보존합니다/);assert.equal(applied.title,before.title);}
  check(textOnly?'REAL DC editor text applied':live?'REAL native DC upload + attachment metadata + rendered image':'native uploader bridge / append preserves existing title and body',{imageCount:applied.images.length,attachmentCount:applied.attachmentCount,uploadStatus:applied.uploadStatus});
  if(live){assert.equal(await editor.locator('label.txt_placeholder[for="subject"]').isVisible(),false);check('real DC title placeholder is hidden after assignment');}
  await editor.setViewportSize({width:1400,height:1000});await editor.screenshot({path:path.join(out,textOnly?'live-text-editor.png':live?'live-04-editor-applied.png':'04-editor-applied.png'),fullPage:false});
  await panel.locator('#undo').click();await panel.waitForFunction(()=>document.querySelector('#undo').hidden);
  assert.deepEqual(await editor.evaluate(()=>({html:jQuery('#memo').summernote('code'),title:document.querySelector('#subject').value})),before);check('undo restores content, keeps native attachment records');
  if(!live){
    // Reusing already uploaded files must not upload again; retry/undo is a core regression risk.
    await panel.locator('#target-status').evaluate(status => { status.textContent = ''; });
    await panel.locator('#refresh-target').click();
    await panel.waitForFunction(() => document.querySelector('#target-status').textContent.includes('첨부사진'));
    await panel.locator('#apply').click();await panel.waitForFunction(()=>!document.querySelector('#apply').disabled,{},{timeout:45000});
    assert.match(await panel.locator('#message').innerText(),/편집기에 적용했습니다/);assert.equal(uploaded,2);check('apply after undo reuses uploaded attachments');
    await editor.evaluate(()=>{document.querySelector('.note-editable').innerHTML+='<p>사용자 추가 편집</p>';});await panel.locator('#apply').click();await panel.waitForFunction(()=>!document.querySelector('#apply').disabled);assert.match(await panel.locator('#message').innerText(),/바뀌었습니다/);assert.match(await editor.locator('.note-editable').innerText(),/사용자 추가 편집/);check('changed-editor conflict prevents overwriting');
    await panel.locator('#account-toggle').click();providerHtmlError=true;await panel.locator('#connect').click();await panel.waitForFunction(()=>document.querySelector('#message').textContent.includes('OpenAI 로그인 페이지의 요청이 HTML로 응답했습니다'));
    const diagnostic=await panel.evaluate(async()=>{const {oauthDiagnostic}=await chrome.storage.session.get('oauthDiagnostic');return oauthDiagnostic;});assert.equal(diagnostic.status,403);assert.equal(diagnostic.stage,'provider-login-page');assert.deepEqual(Object.keys(diagnostic).sort(),['contentType','htmlInsteadOfJson','stage','status']);check('provider login HTML/403 is reported before token exchange with no sensitive diagnostics');
    await panel.locator('#cancel-login').click();providerHtmlError=false;await panel.locator('#connect').click();await panel.locator('#connected').waitFor({state:'visible',timeout:20000});await panel.waitForFunction(()=>document.querySelector('#model').value==='gpt-6-luna');
    assert.equal(await worker.evaluate(()=>self.qaAuth.refreshes),1);check('synthetic OAuth callback / PKCE / OIDC / background token renewal');
    const persisted=await panel.evaluate(async()=>JSON.stringify({local:await chrome.storage.local.get(null),sync:await chrome.storage.sync.get(null)}));assert.ok(!persisted.includes('FAKE_QA_ACCESS')&&!persisted.includes('FAKE_QA_REFRESH'));check('credentials absent from disk-backed local and sync storage');
    await panel.locator('#prepare-first').click();
    await panel.locator('#settings-toggle').click();
    await panel.locator('#settings-preset').selectOption('free');
    await panel.waitForFunction(() => document.querySelector('#settings-fast option:checked').textContent === '자동 · 끔');
    await panel.locator('#settings-preset').selectOption('auto');
    await panel.waitForFunction(() => document.querySelector('#settings-fast option:checked').textContent === '자동 · 켬');
    await panel.locator('#settings-model').selectOption('qa-alternate');
    await panel.waitForFunction(() => document.querySelector('#model').value === 'qa-alternate');
    await panel.locator('#settings-model').selectOption('');
    await panel.waitForFunction(() => document.querySelector('#model').value === 'gpt-6-luna');
    assert.equal(await panel.locator('#settings-effort option:checked').textContent(), '자동 · Medium');
    assert.equal(await panel.locator('#settings-fast option:checked').textContent(), '자동 · 켬');
    await panel.locator('#close-settings').click();
    await panel.locator('details').filter({has:panel.locator('#reference')}).locator('summary').click();await panel.locator('#reference').fill('완성된 두 문장 다음 짧은 소제목을 배치한다.');
    await panel.locator('#source').fill('검증용 가상 메모 : '+await panel.locator('#source').inputValue());
    await panel.locator('[data-mode="structure"]').click();await panel.locator('#generate').click();await panel.locator('#preview-view').waitFor({state:'visible'});await panel.waitForFunction(()=>document.querySelector('#preview').textContent.includes('확인한 내용'));assert.equal(await panel.locator('.article-title').innerText(),'디시 글쓰기 도우미 업로드 테스트');assert.equal(aiCalls,1);check('synthetic Responses SSE → structured document → preview, user title retained');
    assert.ok(!(await panel.locator('#preview').innerText()).includes('검증용 가상 메모'));await panel.locator('#apply').click();await panel.waitForFunction(()=>!document.querySelector('#apply').disabled);assert.match(await panel.locator('#message').innerText(),/편집기에 적용했습니다/);assert.ok(!(await editor.locator('.note-editable').innerText()).includes('검증용 가상 메모'));check('reference priority reaches provider and generated input label is absent from preview and applied body');
    await panel.locator('#direct').click();await panel.locator('#edit-title').fill('직접 수정한 제목');await panel.locator('#save-edit').click();assert.equal(await panel.locator('.article-title').innerText(),'직접 수정한 제목');check('direct editing updates real draft');
    await panel.locator('#write-tab').click();await panel.waitForTimeout(650);await panel.reload();await panel.locator('#workspace').waitFor({state:'visible'});assert.equal(await panel.locator('.photo').count(),2);await panel.waitForFunction(()=>document.querySelector('#model').value==='gpt-6-luna');assert.equal(await worker.evaluate(()=>self.qaAuth.exchanges),1);check('panel reload restores draft and ChatGPT account without another login');
    await panel.locator('#settings-toggle').click();
    assert.equal(await panel.locator('#settings-preset').inputValue(), 'auto');
    assert.equal(await panel.locator('#settings-effort').inputValue(), 'auto');
    assert.equal(await panel.locator('#settings-fast').inputValue(), 'auto');
    await panel.setViewportSize({width: 320, height: 900});
    assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({path: path.join(out, '07-inference-settings.png'), fullPage: true});
    await panel.setViewportSize({width: 440, height: 1000});
    await panel.locator('#close-settings').click();
    check('inference settings stay in sync, reach Responses and persist after panel reload');
    await panel.locator('[data-mode="preserve"]').click();await panel.locator('#files').setInputFiles({name:'third.png',mimeType:'image/png',buffer:photoBytes});await panel.waitForFunction(()=>document.querySelectorAll('.photo').length===3&&!document.querySelector('#generate').disabled);await panel.locator('#generate').click();await panel.waitForFunction(()=>!document.querySelector('#preview-view').hidden&&!document.querySelector('#apply').disabled);
    await editor.evaluate(()=>{window.__failUpload=true;});const bodyBeforeFailure=await editor.locator('.note-editable').innerHTML();await panel.locator('#apply').click();await panel.waitForFunction(()=>!document.querySelector('#apply').disabled);assert.match(await panel.locator('#message').innerText(),/ディシ|디시가 사진 업로드를 거절/);assert.equal(await editor.locator('.note-editable').innerHTML(),bodyBeforeFailure);check('native upload rejection preserves existing body');
    await editor.evaluate(()=>{window.__failUpload=false;});await panel.locator('#apply').click();await panel.waitForFunction(()=>!document.querySelector('#apply').disabled);assert.match(await panel.locator('#message').innerText(),/편집기에 적용했습니다/);assert.equal(uploaded,4);check('retry after rejected upload reuses completed photos');
    await panel.locator('#write-tab').click();await panel.locator('#import-photos').click();await panel.waitForFunction(()=>document.querySelector('#message').textContent.includes('가져왔습니다'));assert.equal(await panel.locator('.photo').count(),3);check('import does not duplicate photos already uploaded by this draft');
    await editor.evaluate(async bytes=>{const blob=await (await fetch('data:image/png;base64,'+bytes)).blob();imageUploader(new File([blob],'native-import.png',{type:'image/png'}));},photoBytes.toString('base64'));await editor.waitForFunction(()=>attachments.length===4);await panel.locator('#import-photos').click();await panel.waitForFunction(()=>document.querySelectorAll('.photo').length===4);assert.ok(await panel.locator('.photo').last().locator('img').evaluate(i=>new URL(i.src).hostname.endsWith('.dcinside.co.kr')));check('import pre-existing native CDN attachment');
    await panel.locator('#generate').click();await panel.waitForFunction(()=>!document.querySelector('#preview-view').hidden&&!document.querySelector('#apply').disabled);await panel.locator('#replace').check();panel.once('dialog',d=>d.accept());await panel.locator('#apply').click();await panel.waitForFunction(()=>!document.querySelector('#apply').disabled);assert.match(await panel.locator('#message').innerText(),/편집기에 적용했습니다/);assert.equal(await editor.locator('#subject').inputValue(),'디시 글쓰기 도우미 업로드 테스트');assert.ok(!(await editor.locator('.note-editable').innerText()).includes('기존 본문을 보존합니다'));assert.equal(uploaded,5);check('explicit replacement confirmation / imported photo reuse without upload');
    await panel.locator('#write-tab').click();
    await panel.setViewportSize({width:320,height:900});assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.screenshot({path:path.join(out,'05-narrow.png'),fullPage:true});check('320px narrow side panel / no horizontal overflow');
    const tabTargets=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]})).targetInfos;const target=tabTargets.find(t=>t.url===editor.url());if(!target)throw Error('No browser tab target for side panel action');
    await cdp.send('Extensions.triggerAction',{id,targetId:target.targetId});await panel.waitForTimeout(250);const targets=(await cdp.send('Target.getTargets')).targetInfos;
    report.sidePanelTargets=targets.filter(t=>t.url===`chrome-extension://${id}/panel.html`).map(t=>t.type);assert.ok(report.sidePanelTargets.length>=2);check('extension toolbar action opens native Chrome side panel');
    await panel.locator('#account-toggle').click();await panel.locator('#model').selectOption('qa-alternate');await panel.waitForFunction(async()=>(await chrome.storage.local.get('chatgptModel')).chatgptModel==='qa-alternate');
    for(const p of context.pages().filter(p=>p.url()===`chrome-extension://${id}/panel.html`))await p.close();
    panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);await panel.waitForFunction(()=>document.querySelector('#model').value==='qa-alternate');await panel.locator('#account-toggle').click();await panel.locator('#connected').waitFor({state:'visible'});assert.equal(await worker.evaluate(()=>self.qaAuth.exchanges),1);check('close all panels including native side panel and reopen retains account and selected second model');
    await panel.screenshot({path:path.join(out,'06-reopened-account.png'),fullPage:true});
    const workerControl=await context.newCDPSession(panel),versions=new Map();workerControl.on('ServiceWorker.workerVersionUpdated',e=>{for(const v of e.versions)versions.set(v.versionId,v);});await workerControl.send('ServiceWorker.enable');await panel.waitForTimeout(200);
    const version=[...versions.values()].find(v=>v.scriptURL===`chrome-extension://${id}/background.js`&&v.runningStatus==='running');assert.ok(version,'running extension worker version');
    await workerControl.send('ServiceWorker.stopWorker',{versionId:version.versionId});
    await panel.reload();await panel.waitForFunction(()=>document.querySelector('#model').value==='qa-alternate');worker=context.serviceWorkers().find(w=>w.url()===`chrome-extension://${id}/background.js`);assert.ok(worker);assert.equal(await worker.evaluate(()=>typeof self.qaAuth),'undefined','old worker globals must be gone');await installMockAuth(worker,mockKeys);assert.equal(await worker.evaluate(()=>self.qaAuth.exchanges),0);check('terminated service worker restores encrypted session without reauthorization');
    const isolated=await panel.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'https://gall.dcinside.com/*'});const [r]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:async()=>{try{await chrome.storage.session.get('chatgptSession');return false;}catch{return true;}}});return r.result;});assert.equal(isolated,true);check('content scripts cannot read trusted-context session storage');
    await panel.locator('#account-toggle').click();await panel.locator('#disconnect').click();await panel.waitForFunction(()=>!document.querySelector('#disconnect').disabled && document.querySelector('#connected').hidden);assert.equal(await worker.evaluate(()=>self.qaAuth.revocations),1);
    await panel.close();panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);await panel.waitForFunction(()=>document.querySelector('#prepare-first')?.onclick);assert.equal(await panel.evaluate(async()=>!!(await chrome.storage.session.get('chatgptSession')).chatgptSession),false);assert.equal(await panel.locator('#model option').count(),1);check('disconnect revokes session and reopening does not restore it');
  }
  assert.equal(postRequests,0);check('no article submission (other site POST requests blocked)');
  assert.deepEqual(report.errors,[]);check('extension console and page error health');
  report.passed=true;
}catch(e){report.passed=false;report.failure=e.message;console.error('FAIL:',e.message);if(editor)report.failureEditorState=await editor.evaluate(()=>({imgCount:document.querySelectorAll('.note-editable img').length,attachments:typeof attachments!=='undefined'?attachments.length:null,phashPending:typeof phashPending!=='undefined'?phashPending:null,uploadStatus:document.querySelector('#upload_status')?.value,uncertain:window.__dcWriterState?.uncertain})).catch(()=>null);if(panel)await panel.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{report.finished=new Date().toISOString();await fs.writeFile(path.join(out,textOnly?'live-text-result.json':live?'live-result.json':'browser-result.json'),JSON.stringify(report,null,2));if(!visible)await context.close();else console.log('Interactive browser stays open for user inspection.');}
