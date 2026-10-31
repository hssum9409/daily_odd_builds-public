// Browser plugin not available. Run the shipped MV3 extension in isolated Chrome.
// All provider responses and the NamuWiki document below are SYNTHETIC fixtures.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {b64url} from '../extension/connection.js';
const work=await mkdtemp(path.join(tmpdir(),'day018-qa-'));
console.log('QA workspace:',work);
const ctx=await chromium.launchPersistentContext(path.join(work,'profile'),{headless:!process.env.HEADED,channel:'chrome',viewport:{width:440,height:950},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const errors=[],requests=[];ctx.on('weberror',e=>errors.push(e.error().message));
ctx.setDefaultTimeout(15000);console.log('Chrome launched');
const cdp=await ctx.browser().newBrowserCDPSession();
await cdp.send('Extensions.loadUnpacked',{path:path.resolve('dist')});
console.log('Extension loaded');
const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const origin=`chrome-extension://${new URL(worker.url()).host}`;
const consoleIssues=[];let expectedHttpErrors=0;
ctx.on('console',m=>{if(!['error','warning'].includes(m.type()) || !m.page()?.url().startsWith(origin))return;if(m.text().startsWith('Failed to load resource:') && /400/.test(m.text()) && fastRejected){expectedHttpErrors++;return;}consoleIssues.push(m.text());});
console.log('Service worker ready');
const fixture=`<!doctype html><meta charset="utf-8"><title>고양이 - 나무위키</title><nav>NAV_SECRET</nav><h1>고양이</h1><div class="wiki-content"><h2>특징</h2>${Array.from({length:24},(_,i)=>`<div class="wiki-paragraph">${i+1}번 고양이의 털은 흰색이다. 이 문단은 합성 퀴즈 검사 자료이며 본문에서 동물의 특징을 구별하는 충분한 문맥을 담고 있다.</div>`).join('')}<p hidden>HIDDEN_SECRET</p><p style="display:none">CSS_SECRET</p><aside>ASIDE_SECRET</aside><form>FORM_SECRET</form><div class="wiki-macro-toc">TOC_SECRET</div><div class="wiki-folding">FOLD_SECRET</div><p contenteditable>EDIT_SECRET</p></div><footer>FOOTER_SECRET</footer>`;
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'qa',alg:'RS256',use:'sig'};
let nonce,redirect,tokenCalls=0,responseCalls=0,badQuote=false,rejectVerification=false,delay=false,fastRejected=false,shortBody=false;
let unblock;
ctx.on('request',r=>requests.push(r.url().split('?')[0]));
await ctx.route('https://namu.wiki/**',r=>r.fulfill({contentType:'text/html',body:shortBody?'<meta charset="utf-8"><h1>고양이</h1><div class="wiki-content"><div class="wiki-paragraph">출제하기에는 짧은 본문입니다.</div></div>':fixture}));
await ctx.route('https://auth.openai.com/**',async r=>{
  const u=new URL(r.request().url());
  if(u.pathname.endsWith('/authorize')){nonce=u.searchParams.get('nonce');redirect=u.searchParams.get('redirect_uri');return r.fulfill({contentType:'text/html',body:'<title>Mock ChatGPT login</title><p>Synthetic provider only</p>'});}
  if(u.pathname.endsWith('/openid-configuration'))return r.fulfill({json:{issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/qa-keys',revocation_endpoint:'https://auth.openai.com/revoke'}});
  if(u.pathname==='/qa-keys')return r.fulfill({json:{keys:[jwk]}});
  if(u.pathname==='/revoke')return r.fulfill({status:200,body:''});
  if(u.pathname.endsWith('/oauth/token')){
    tokenCalls++;const form=new URLSearchParams(r.request().postData());assert.ok(form.get('code_verifier'));assert.equal(form.get('redirect_uri'),redirect);
    const encode=x=>b64url(new TextEncoder().encode(JSON.stringify(x)));
    const v=`${encode({alg:'RS256',kid:'qa'})}.${encode({iss:'https://auth.openai.com',aud:'oaiapp_qa',sub:'synthetic',email:'qa@example.test',nonce,exp:Math.floor(Date.now()/1000)+3600})}`;
    const jwt=`${v}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(v))))}`;
    return r.fulfill({json:{access_token:'SYNTHETIC_ACCESS',refresh_token:'SYNTHETIC_REFRESH',expires_in:3600,id_token:jwt,scope:'openid chatgpt.tokens.use.direct'}});
  }
  return r.abort();
});
await ctx.route('https://api.openai.com/**',async r=>{
  if(r.request().url().endsWith('/models'))return r.fulfill({json:{models:[{slug:'gpt-6.1-terra',display_name:'GPT-6.1 Terra',visibility:'list'},{slug:'gpt-6.1-sol',display_name:'GPT-6.1 Sol',visibility:'list'}]}});
  const data=r.request().postDataJSON();assert.ok(!data.tools);assert.ok(!data.include);assert.equal(data.store,false);responseCalls++;
  if(delay)await new Promise(resolve=>{unblock=resolve;});
  if(fastRejected && data.service_tier!=='default')return r.fulfill({status:400,json:{error:{param:'service_tier',message:'service_tier not allowed'}}});
  const input=JSON.parse(data.input[0].content);
  const editing=Object.hasOwn(input,'proposedQuestions');
  const parsed={questions:input.sourceBlocks.filter(b=>/번 고양이/.test(b.text)).slice(0,input.questionCount).map((b,i)=>({statement:`${i+1}번 고양이의 털은 ${i%2?'검은색':'흰색'}이다.`,answer:i%2===0,sourceId:b.id,quote:badQuote&&!editing?'외부에서 지어낸 근거로는 문제를 만들 수 없습니다.':b.text,explanation:'본문에서는 털이 흰색이라고 설명한다.'.repeat(i===0 || i===9?18:1),correction:i%2?'털은 흰색이다.':''}))};
  if(editing && rejectVerification){parsed.questions[0].quote='편집 단계의 잘못된 근거도 재요청해서 고칩니다.';rejectVerification=false;}
  const text=JSON.stringify(parsed);
  // Exercise SSE delta reconstruction, including empty completed.output.
  return r.fulfill({contentType:'text/event-stream',body:[{type:'response.output_item.added',output_index:0,item:{type:'message',role:'assistant',content:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:text},{type:'response.completed',response:{status:'completed',service_tier:data.service_tier || 'default',output:[]}}].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')});
});
const panel=await ctx.newPage();await panel.goto(`${origin}/sidepanel.html`);
try{
  assert.equal(await panel.title(),'지피쨩 OX 퀴즈');await panel.locator('#unsupported').waitFor({state:'visible'});
  assert.equal(await panel.locator('#namuwiki-open').getAttribute('href'),'https://namu.wiki/');assert.equal(await panel.locator('#namuwiki-open').getAttribute('target'),'_blank');
  await panel.screenshot({path:path.join(work,'unsupported.png'),fullPage:true});
  const source=await ctx.newPage();await source.goto('https://namu.wiki/w/고양이');await source.bringToFront();
  await panel.locator('#gate-login').waitFor({state:'visible'});assert.ok(await panel.locator('#unsupported').isHidden());
  await panel.screenshot({path:path.join(work,'login.png')});
  const loginPromise=ctx.waitForEvent('page');await panel.locator('#gate-login').click();const login=await loginPromise;
  await login.waitForURL('https://auth.openai.com/**');
  const authURL=new URL(login.url());assert.equal(authURL.searchParams.get('agent_name_hint'),'지피쨩 나무위키 OX 퀴즈');
  const state=authURL.searchParams.get('state');
  await login.goto(`${redirect}?code=SYNTHETIC_CODE&state=wrong&client_id=oaiapp_qa`).catch(()=>{});
  assert.equal(tokenCalls,0);
  await login.goto(`${redirect}?code=SYNTHETIC_CODE&state=${state}&client_id=oaiapp_qa`).catch(()=>{});
  await panel.waitForFunction(async()=>!!(await chrome.runtime.sendMessage({type:'auth.status'}))?.data?.sharing);
  await source.bringToFront();
  await panel.locator('#workspace').waitFor({state:'visible'});assert.equal(tokenCalls,1);
  await panel.locator('#read-page').click();await panel.locator('#article-title').filter({hasText:'고양이'}).waitFor();
  const snapshot=await panel.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'https://namu.wiki/w/*'});return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:(await import('./extract.js')).extractArticle}))[0].result;});
  assert.ok(snapshot.blocks.length>=24);assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
  // Current NamuWiki hashes class names: section anchors + renderer boundary
  // must read narrative blocks while excluding navigation, ToC and foreign ads.
  const hashed=await ctx.newPage();await hashed.goto('https://namu.wiki/w/해시검사');
  await hashed.setContent(`<h1>해시검사</h1><nav>NAV_SECRET</nav><div data-v-page><div data-v-render><a href="#s-1">목차1</a><a href="#s-2">목차2</a><a href="#s-3">TOC_SECRET</a></div><div data-v-render><h2 data-v-render><a id="s-1" href="#toc">1.</a>개요<a href="/edit/test">EDIT_SECRET</a></h2></div><div data-v-render>해시 클래스 대신 렌더러 경계를 확인해서 이 본문 문장을 온전히 읽습니다. <b data-v-render>굵은 본문도 같은 구간으로 유지합니다.</b><span hidden>HIDDEN_SECRET</span></div><div data-v-foreign>AD_SECRET</div><div data-v-render><h2 data-v-render><a id="s-2" href="#toc">2.</a>특징</h2></div><div data-v-render>이것은 외부 출처가 아닌 두 번째 본문입니다. 폐쇄된 폼과 숨긴 요소를 출제 범위에서 제외하는 합성 검사 문단입니다.</div></div><footer>FOOTER_SECRET</footer>`);
  const hashedSnapshot=await panel.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://namu.wiki/w/*'});const tab=tabs.find(t=>t.url.includes('%ED%95%B4%EC%8B%9C') || t.url.includes('해시검사'));return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:(await import('./extract.js')).extractArticle}))[0].result;});
  assert.equal(hashedSnapshot.extractor,'section-renderer');assert.ok(!JSON.stringify(hashedSnapshot).includes('SECRET'));assert.ok(hashedSnapshot.blocks.some(b=>b.text.includes('온전히 읽습니다. 굵은 본문도')));
  await hashed.close();await source.bringToFront();
  await panel.locator('#page-update').waitFor({state:'visible'});const beforeRefresh=responseCalls;await panel.locator('#refresh-page').click();await panel.locator('#page-update').waitFor({state:'hidden'});assert.equal(responseCalls,beforeRefresh);
  assert.equal(await panel.locator('#count').inputValue(),'10');
  await panel.screenshot({path:path.join(work,'ready.png'),fullPage:true});
  for(const size of [{width:440,height:950},{width:320,height:560}]){
    await panel.setViewportSize(size);await panel.locator('#panel-content').evaluate(n=>{n.scrollTop=0;});
    assert.ok(await panel.locator('#generate').isEnabled());assert.ok(await panel.locator('#generation-disclosure').isVisible());
    const before=await panel.locator('#generate').boundingBox();assert.ok(before && before.y>=0 && before.y+before.height<=size.height);
    await panel.mouse.move(size.width/2,180);await panel.mouse.wheel(0,10000);
    await panel.waitForFunction(()=>{const n=document.getElementById('panel-content');return n.scrollTop>0 && n.scrollTop+n.clientHeight>=n.scrollHeight-2;});
    const after=await panel.locator('#generate').boundingBox();assert.ok(Math.abs(after.y-before.y)<1);
    const plus=await panel.locator('#plus').boundingBox(),dock=await panel.locator('#quiz-navigation').boundingBox();assert.ok(plus.y+plus.height<=dock.y);
    assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.scrollingElement.scrollTop===0));
    if(size.width===320)await panel.screenshot({path:path.join(work,'create-pinned.png')});
  }
  await panel.setViewportSize({width:440,height:950});console.log('Pinned create button passed');
  await panel.locator('#settings-toggle').click();await panel.locator('#reload-models').click();await panel.locator('#model option[value="gpt-6.1-sol"]').waitFor({state:'attached'});assert.ok(await panel.locator('#fast').isChecked());
  assert.ok(await panel.locator('#panel-content').isHidden());assert.ok(await panel.locator('#quiz-navigation').isHidden());
  assert.deepEqual(await panel.locator('#settings').boundingBox(),{x:0,y:0,width:440,height:950});
  assert.ok((await panel.locator('#message').innerText()).includes('모델'));assert.ok(await panel.locator('#message').isVisible());
  const closeStyle=await panel.locator('#settings-close').evaluate(n=>({background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color,height:n.getBoundingClientRect().height}));assert.notEqual(closeStyle.background,'rgba(0, 0, 0, 0)');assert.notEqual(closeStyle.background,closeStyle.color);assert.ok(closeStyle.height>=44);
  await panel.screenshot({path:path.join(work,'settings.png'),fullPage:true});
  await panel.setViewportSize({width:320,height:560});await panel.locator('#settings-general summary').click();await panel.mouse.move(160,400);await panel.mouse.wheel(0,10000);await panel.waitForFunction(()=>document.getElementById('settings').scrollTop>0);
  const closeRect=await panel.locator('#settings-close').boundingBox();assert.ok(closeRect.y>=0 && closeRect.y+closeRect.height<130);assert.ok(await panel.locator('#privacy-policy').isVisible());assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.screenshot({path:path.join(work,'settings-narrow.png')});
  await panel.locator('#settings-general summary').click();await panel.setViewportSize({width:440,height:950});await panel.locator('#settings').evaluate(n=>{n.scrollTop=0;});
  await panel.locator('#settings-tab-creator').click();await panel.locator('#settings-creator').waitFor({state:'visible'});assert.ok((await panel.locator('#settings-creator').innerText()).includes('AI 슬롭 같다구요? 으쩌라구요'));assert.equal(await panel.locator('#privacy-policy').getAttribute('href'),'https://daily-odd-builds-portal.web.app/privacy/namuwiki-ox');assert.equal(await panel.locator('#privacy-policy').getAttribute('target'),'_blank');
  await panel.screenshot({path:path.join(work,'creator.png'),fullPage:true});
  await panel.locator('#settings-tab-creator').press('ArrowLeft');assert.equal(await panel.locator('#settings-tab-general').getAttribute('aria-selected'),'true');assert.ok(await panel.locator('#fast').isChecked());await panel.locator('#settings-close').click();
  await panel.locator('#count').fill('5');await panel.locator('#count').dispatchEvent('change');
  assert.ok(await panel.locator('#minus').isDisabled());assert.equal(await panel.locator('#count').inputValue(),'5');
  await panel.locator('#count').fill('20');await panel.locator('#count').dispatchEvent('change');assert.ok(await panel.locator('#plus').isDisabled());
  await panel.locator('#count').fill('10');await panel.locator('#count').dispatchEvent('change');
  delay=true;await panel.locator('#generate').click();await panel.locator('#generation').waitFor({state:'visible'});await panel.locator('#stage-creating.current').waitFor({state:'visible'});assert.ok(await panel.locator('#welcome').isHidden());assert.equal(await panel.locator('#generation').getAttribute('aria-busy'),'true');
  await panel.waitForFunction(()=>parseInt(document.getElementById('generation-elapsed').textContent,10)>0);
  await panel.screenshot({path:path.join(work,'generating.png'),fullPage:true});
  await panel.waitForFunction(()=>document.getElementById('stage-creating').getAttribute('aria-current')==='step');
  delay=false;unblock?.();await panel.locator('#game').waitFor({state:'visible'});assert.equal(responseCalls,2);assert.ok(await panel.locator('#generation').isHidden());
  console.log('Generation passed');
  assert.ok(await panel.locator('#feedback').isHidden());assert.ok(await panel.locator('#quiz-navigation').isHidden());
  async function checkPinnedNavigation(label){
    for(const size of [{width:440,height:950},{width:320,height:560}]){
      await panel.setViewportSize(size);
      await panel.locator('#panel-content').evaluate(n=>{n.scrollTop=0;});
      const before=await panel.locator('#next').boundingBox();assert.ok(before && before.y>=0 && before.y+before.height<=size.height);
      await panel.mouse.move(size.width/2,180);await panel.mouse.wheel(0,10000);
      await panel.waitForFunction(()=>{const n=document.getElementById('panel-content');return n.scrollTop>0 && n.scrollTop+n.clientHeight>=n.scrollHeight-2;});
      const after=await panel.locator('#next').boundingBox();assert.ok(Math.abs(after.y-before.y)<1);assert.ok(Math.abs(after.height-before.height)<1);
      const leave=await panel.locator('#leave-game').boundingBox(),dock=await panel.locator('#quiz-navigation').boundingBox();assert.ok(leave.y+leave.height<=dock.y);
      assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.scrollingElement.scrollTop===0));
      if(size.width===320)await panel.screenshot({path:path.join(work,`${label}-pinned.png`)});
    }
    await panel.setViewportSize({width:440,height:950});
  }
  for(let i=0;i<10;i++){
    console.log('Answer',i+1);
    // Deliberately miss the second question to exercise wrong-only replay.
    await panel.locator(i===1 || i%2===0?'#answer-o':'#answer-x').click();
    await panel.locator('#feedback').waitFor({state:'visible'});assert.ok((await panel.locator('#quote').innerText()).includes('흰색'));
    if(i===0){await panel.screenshot({path:path.join(work,'answer.png'),fullPage:true});assert.equal(await panel.locator('#next').innerText(),'다음 문제');await checkPinnedNavigation('next');const question=await panel.locator('#question').innerText();await panel.locator('#settings-toggle').click();assert.ok(await panel.locator('#game').isHidden());assert.ok(await panel.locator('#quiz-navigation').isHidden());await panel.locator('#settings-close').press('Escape');assert.ok(await panel.locator('#settings').isHidden());assert.equal(await panel.locator('#question').innerText(),question);assert.ok(await panel.locator('#feedback').isVisible());assert.ok(await panel.locator('#next').isVisible());assert.ok(await panel.locator('#answer-o').isDisabled());}
    if(i===9){assert.equal(await panel.locator('#next').innerText(),'결과 보기');await checkPinnedNavigation('results');}
    await panel.locator('#next').click();
    assert.equal(await panel.locator('#panel-content').evaluate(n=>n.scrollTop),0);
    console.log('Advanced',i+1);
  }
  await panel.locator('#result').waitFor({state:'visible'});assert.equal(await panel.locator('#final-score').innerText(),'9 / 10');assert.ok(await panel.locator('#quiz-navigation').isHidden());
  await panel.screenshot({path:path.join(work,'result.png'),fullPage:true});
  const buttonSizes=await panel.evaluate(()=>({primary:document.getElementById('new-quiz').getBoundingClientRect().height,replay:document.getElementById('retry-all').getBoundingClientRect().height}));assert.ok(buttonSizes.primary>buttonSizes.replay);assert.ok((await panel.locator('#new-quiz').getAttribute('class')).includes('primary'));
  const callsBeforeReplay=responseCalls;await panel.locator('#retry-wrong').click();assert.equal(await panel.locator('#progress-label').innerText(),'1 / 1 문제');await panel.locator('#answer-x').click();await panel.locator('#next').click();assert.equal(await panel.locator('#final-score').innerText(),'1 / 1');assert.equal(responseCalls,callsBeforeReplay);
  await panel.reload();await panel.locator('#result').waitFor({state:'visible'});assert.equal(await panel.locator('#final-score').innerText(),'1 / 1');
  await ctx.route('https://example.test/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Not NamuWiki</h1>'}));
  const other=await ctx.newPage();await other.goto('https://example.test/');await other.bringToFront();await panel.locator('#unsupported').waitFor({state:'visible'});assert.ok(await panel.locator('#unsupported-quiz').isVisible());const beforeUnsupported=responseCalls;
  await panel.setViewportSize({width:320,height:850});await panel.screenshot({path:path.join(work,'unsupported-narrow.png'),fullPage:true});assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await source.bringToFront();await panel.locator('#result').waitFor({state:'visible'});assert.equal(await panel.locator('#final-score').innerText(),'1 / 1');assert.equal(responseCalls,beforeUnsupported);await other.close();await panel.setViewportSize({width:440,height:950});
  await panel.locator('#new-quiz').click();await source.bringToFront();await panel.locator('#read-page').click();
  badQuote=true;await panel.locator('#generate').click();await panel.locator('#game').waitFor({state:'visible'});assert.ok(!(await panel.locator('#question').innerText()).includes('외부'));badQuote=false;
  await panel.locator('#answer-o').click();assert.ok((await panel.locator('#quote').innerText()).includes('흰색'));await panel.locator('#leave-game').click();
  rejectVerification=true;const beforeRepair=responseCalls;await panel.locator('#generate').click();await panel.locator('#game').waitFor({state:'visible'});assert.equal(responseCalls,beforeRepair+3);const repaired=await panel.evaluate(async()=>Object.values(await chrome.storage.session.get(null)).find(x=>x?.report)?.report);assert.equal(repaired.editorPasses,2);await panel.locator('#leave-game').click();
  const beforeShort=responseCalls;shortBody=true;await source.reload();await source.bringToFront();await panel.locator('#page-update').waitFor({state:'visible'});await panel.locator('#refresh-page').click();await panel.locator('#generate.unavailable').waitFor({state:'visible'});assert.ok(await panel.locator('#generate').isDisabled());assert.ok((await panel.locator('#generate').innerText()).includes('본문이 너무 짧아요'));await panel.locator('#page-update').waitFor({state:'hidden'});assert.equal(responseCalls,beforeShort);await panel.screenshot({path:path.join(work,'short-body.png'),fullPage:true});
  // Repeated refreshes of a short, but successfully read, page must stay dismissed.
  await panel.locator('#read-page').click();assert.ok(await panel.locator('#page-update').isHidden());assert.ok(await panel.locator('#generate').isDisabled());
  shortBody=false;await source.reload();await source.bringToFront();await panel.locator('#page-update').waitFor({state:'visible'});await panel.locator('#refresh-page').click();await panel.locator('#page-update').waitFor({state:'hidden'});assert.ok(await panel.locator('#generate').isEnabled());assert.equal(await panel.locator('#generate').innerText(),'퀴즈 만들기');
  fastRejected=true;await panel.locator('#generate').click();await panel.locator('#game').waitFor({state:'visible'});const diagnostic=await panel.evaluate(async()=>Object.values(await chrome.storage.session.get(null)).find(x=>x?.report)?.report);assert.ok(diagnostic.compatibility.includes('standard_fallback'));assert.deepEqual(diagnostic.effectiveTiers,['default']);fastRejected=false;
  await panel.locator('#leave-game').click();delay=true;await source.bringToFront();await panel.locator('#generate').click();await panel.locator('#stop').waitFor({state:'visible'});await panel.locator('#stop').click();await panel.locator('#message').filter({hasText:'취소했어요'}).waitFor();unblock?.();delay=false;
  await panel.setViewportSize({width:320,height:850});await panel.screenshot({path:path.join(work,'narrow.png'),fullPage:true});assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const storage=await panel.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));assert.ok(!JSON.stringify(storage).includes('SYNTHETIC_ACCESS'));assert.ok(!JSON.stringify(storage).includes('SYNTHETIC_REFRESH'));
  await panel.locator('#settings-toggle').click();await panel.locator('#settings-tab-general').click();await panel.locator('#logout').click();await panel.locator('#login').waitFor({state:'visible'});await panel.locator('#settings-close').click();await source.bringToFront();await panel.locator('#gate-login').waitFor({state:'visible'});
  assert.ok(!Object.keys(await panel.evaluate(()=>chrome.storage.session.get(null))).some(k=>k.startsWith('quiz-window-')));
  assert.deepEqual(errors,[]);
  assert.deepEqual(consoleIssues,[]);
  assert.ok(!requests.some(u=>/firebase|googleapis|github|localhost/.test(u)));
  console.log(JSON.stringify({result:'PASS',environment:'isolated Chrome + synthetic NamuWiki/OpenAI',checks:['production MV3 permissions','PKCE callback state/tab matching','signed synthetic OIDC login','visible body only extraction','5/10/20 count','default Terra + Fast','dedicated generation view/stages/elapsed','creator tab/keyboard/settings preserved','public privacy link','document refresh without generation','non-NamuWiki dedicated guide/restore','primary new quiz/compact replay','10 answers -> score','quote feedback','wrong-only offline replay','session reload','bad draft automatically corrected','bad edit automatically retried','short-body reason on disabled quiz button','successful short-body refresh dismisses banner','body recovers and quiz button re-enables','Fast fallback','cancel','320px overflow','no plaintext tokens','logout clears quiz','no relevant console or JS errors'],expectedHttpErrors,responseCalls,screenshots:work},null,2));
}catch(e){console.error(e);await panel.screenshot({path:path.join(work,'failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{unblock?.();await ctx.close();}
