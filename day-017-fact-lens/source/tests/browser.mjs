import { languageInstruction } from '../shared/language.mjs';
import { analysisFixture, verdictFixture } from './analysis-fixture.mjs';
import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const fixture = '<!doctype html><meta charset="utf-8"><title>달과 지구에 관한 세 가지 주장</title><nav>광고 메뉴</nav><main><article><h1>달과 지구에 관한 세 가지 주장</h1><p>달은 지구 주위를 공전한다. 이 글은 달과 지구의 관계를 살펴보는 충분한 길이의 테스트 기사입니다. 주변 천체를 관찰하고 과학적 사실을 확인할 때에는 여러 출처와 정확한 관측을 대조해야 합니다.</p><p>달은 스스로 빛을 낸다. 이 문장은 오류 검증의 대상이며 정확한 과학 정보를 통해 사실 여부를 확인해야 합니다. 여기에는 실제 뉴스나 개인 정보가 포함되어 있지 않습니다.</p><p hidden>HIDDEN_SECRET</p><form><textarea>FORM_SECRET</textarea></form><p contenteditable>EDITABLE_SECRET</p></article></main><footer>FOOTER_SECRET</footer>';
const pageTitle = '달과 지구: 달은 약 한 달에 한 번 지구 주위를 공전합니다';
const description = '달 표면에서 보이는 빛은 태양에서 온 반사광입니다.';
const longFixture='<meta charset="utf-8"><title>긴 본문 전체 읽기</title><main><article><h1>긴 본문 전체 읽기</h1>'+Array.from({length:600},(_,i)=>`<p>문단 ${i}: 관측 자료의 조건과 분석 시점을 함께 확인해야 합니다. 충분한 길이의 독립적인 설명을 제공하며 원문 전체의 맥락을 읽을 때 앞부분과 뒷부분이 함께 전달되어야 한다는 검사 자료입니다.</p>`).join('')+'<p>문서 맨 마지막의 고유한 핵심 결론도 분석 입력에서 빠지면 안 됩니다.</p></article></main>';
const scopeTitle='독립적인 수치와 후속 사건의 범위 합성 검사';
const scopeExamples=[{parent:'후보 측은 상대 후보의 어머니가 출연한 공격 광고를 내보냈다.',core:'어머니가 출연한 공격 광고를 내보냈다.',extra:'광고 당시 후보는 4%포인트 뒤졌다.',verdict:'insufficient'}, {parent:'두 정치인은 해당 광고를 옹호했다.',core:'두 정치인은 해당 광고를 옹호했다.',extra:'광고는 계속 방송됐다.',verdict:'refuted'}];
const foreignQuote='The Moon orbits Earth.';
const foreignTitle='English source for multilingual output';
const foreignFixture=`<meta charset="utf-8"><title>${foreignTitle}</title><article><h1>${foreignTitle}</h1><p>${foreignQuote} The article describes the relation between the Earth and its satellite, with qualifications about observations, time and reflected sunlight. This synthetic passage has enough context to test extraction and translated analysis without using personal information.</p></article>`;
const translated={ko:['달은 지구 주위를 공전합니다.','달과 지구의 관계','독립적인 관측 자료가 공전을 뒷받침합니다.'],en:['The Moon orbits Earth.','The Earth–Moon relationship','Independent observations support the orbit.'],ja:['月は地球の周りを公転します。','地球と月の関係','独立した観測記録が公転を裏付けています。'],zh:['月球围绕地球运行。','地球与月球的关系','独立观测资料支持公转结论。']};
const bareTitle='문단 태그 없는 기사 본문 회귀 검사';
const bareLead='첫 문단은 문단 태그 없이 텍스트와 줄바꿈으로 구성됩니다. 기사 본문의 맥락과 관측 조건을 확인하는 합성 테스트 자료이며 개인 정보나 실제 뉴스 내용을 포함하지 않습니다.';
const bareEnd='마지막 문단의 고유한 결론도 빠짐없이 읽어야 합니다. 하나의 기사 요소 아래에 여러 문단이 직접 연결되어 있어도 각 원문 위치를 정확하게 찾을 수 있어야 한다는 검사입니다.';
const bareFixture=(tag='article')=>`<!doctype html><meta charset="utf-8"><title>${bareTitle}</title><div id="newsct" role="main"><h2 id="title_area">${bareTitle}</h2><${tag} id="dic_area"><strong class="media_end_summary">본문과 함께 읽어야 하는 부제입니다.</strong><br>${bareLead}<br><br><span class="end_photo_org"><img src="${imageFixture}" width="320" height="180"><em class="img_desc">본문과 별도로 표시해야 하는 기사 사진 설명입니다.</em></span><br><span style="display:contents">${bareEnd}</span><div hidden>HIDDEN_BARE_SECRET</div><form><textarea>FORM_BARE_SECRET</textarea></form><span contenteditable>EDITABLE_BARE_SECRET</span><span style="display:none">CSS_BARE_SECRET</span></${tag}><section id="recommendations">${'추천 기사 본문이 아닌 내용 RECOMMENDATION_SECRET '.repeat(100)}<img src="https://unrelated.test/recommendation.png" width="320" height="180"></section></div>`;
const contextualFixture = fixture.replace('<title>달과 지구에 관한 세 가지 주장</title>', `<title>${pageTitle}</title><meta name="description" content="${description}"><meta name="author" content="과학 QA 작성자"><meta property="article:published_time" content="2026-10-31">`).replace('<h1>', '<p class="subtitle">관측 시기와 반사광의 조건을 함께 살펴봅니다.</p><h1>').replace('<p hidden>', '<h2>관측과 시간의 맥락</h2><p hidden>');
const work = await mkdtemp(path.join(os.tmpdir(), 'fact-lens-browser-'));
const extensionPath = path.join(work, 'extension');
await cp('dist', extensionPath, {recursive:true});
const manifest = JSON.parse(await readFile(path.join(extensionPath,'manifest.json'),'utf8'));
// Test the production permission manifest as shipped, without any toolbar gesture.
assert.ok(manifest.host_permissions.includes('<all_urls>'));
assert.ok(!manifest.permissions.includes('activeTab'));
const context = await chromium.launchPersistentContext(path.join(work,'profile'),{
 headless: !process.env.HEADED, channel:'chrome', viewport:{width:440,height:1000},
 ignoreDefaultArgs:['--disable-extensions'], args:['--enable-unsafe-extension-debugging'],
});
const browserSession = await context.browser().newBrowserCDPSession();
await browserSession.send('Extensions.loadUnpacked',{path:extensionPath});
context.setDefaultTimeout(15000);
const errors=[];
context.on('weberror',error=>errors.push(error.error().message));
let responseGate;
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
const base = `chrome-extension://${id}`;
const consoleIssues=[];let expectedResourceErrors=0;
context.on('console',message=>{
 if(!['error','warning'].includes(message.type())||!message.page()?.url().startsWith(base))return;
 if(message.text().startsWith('Failed to load resource:')){expectedResourceErrors++;return;}
 consoleIssues.push({type:message.type(),text:message.text()});
});
let nonce, redirectUri, tokenCalls=0, responseCalls=0, refreshCalls=0, rejectToken=false, malformedIdentity=false, malformedMode='none', transportMode='json', contextMode=false, expectedTier='priority', activeChecks=0, peakChecks=0, multimodalMode=false, excludeExtras=false, forceFast400=false, imageFixture, languageMode='ko', expectedMaximum=8;
const commentQuote='댓글 작성자는 달의 관측 주기에 관해 독립적인 과학적 반론을 제시합니다.';
const adComment='무료 가입하면 보너스 10만원 지급! 추천인 코드 ABC로 가입하세요. https://shop.example/ AD_PROMO_MARKER';
const subtlePromo='여러분의 새로운 시작을 저희 프로그램에서 함께 설계해 드립니다. 다음 단계는 제 소개에서 만나실 수 있어요.';
const imageText='달은 태양에서 온 빛을 반사합니다. 관측 자료 2026';
const imageDescription='그림에는 태양에서 달로 향하는 빛과 지구에서 관측하는 관계가 표시되어 있습니다.';
const requestInput=body=>JSON.parse(Array.isArray(body.input[0].content)?body.input[0].content[0].text:body.input[0].content);
const {publicKey,privateKey}=await generateKeyPair('RS256');
const jwk = {...await exportJWK(publicKey),kid:'qa-key',alg:'RS256',use:'sig'};
await context.route('http://example.test/**',async route=>{
 const url=new URL(route.request().url());
 if(['/fixture.png','/ad.png'].includes(url.pathname)&&imageFixture)return route.fulfill({contentType:'image/png',body:Buffer.from(imageFixture.split(',')[1],'base64')});
 if(url.pathname==='/redirect')return route.fulfill({status:302,headers:{location:url.searchParams.get('to')}});
 if(url.pathname==='/js')return route.fulfill({contentType:'text/html',body:`<script>location.href=${JSON.stringify(url.searchParams.get('to'))}</script>`});
 await route.fulfill({contentType:'text/html',headers:{'content-security-policy':"style-src 'none'; script-src 'none'; img-src http: https: data:"},body:contextualFixture});
});
await context.route(/^https:\/\/(article|another)\.test\//, route => route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/foreign')?foreignFixture:route.request().url().endsWith('/bare')?bareFixture():route.request().url().endsWith('/bare-main')?bareFixture('main'):route.request().url().endsWith('/long')?longFixture:route.request().url().endsWith('/empty')?'<meta charset="utf-8"><title>짧은 페이지</title><p>본문이 짧습니다.</p>':fixture}));
await context.route('https://auth.openai.com/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname.endsWith('/authorize')){nonce=url.searchParams.get('nonce');redirectUri=url.searchParams.get('redirect_uri');return route.fulfill({contentType:'text/html',body:'<title>Mock ChatGPT authorization</title><p>OAuth harness only</p>'});}
 if(url.pathname.endsWith('/openid-configuration'))return route.fulfill({json:{issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/.well-known/jwks.json',revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'}});
 if(url.pathname.endsWith('jwks.json'))return route.fulfill({json:{keys:[jwk]}});
 if(url.pathname.endsWith('/oauth/revoke'))return route.fulfill({body:'',status:200});
 if(url.pathname.endsWith('/oauth/token')){
  tokenCalls++;
  const form=new URLSearchParams(route.request().postData());
  assert.equal(form.get('resource'),'https://api.openai.com/v1');
  assert.equal(form.get('client_id'),'oaiapp_qa');
  if(rejectToken)return route.fulfill({status:400,json:{error:'invalid_grant'}});
  if(form.get('grant_type')==='refresh_token'){refreshCalls++;return route.fulfill({json:{access_token:'qa-access',refresh_token:'qa-rotated',token_type:'Bearer',expires_in:3600,scope:'openid chatgpt.tokens.use.direct'}});}
  assert.equal(form.get('redirect_uri'),redirectUri);
  assert.ok(form.get('code_verifier'));
  const jwt=await new SignJWT({email:'qa@example.test',nonce:malformedIdentity?'wrong':nonce}).setProtectedHeader({alg:'RS256',kid:'qa-key'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_qa').setSubject('qa-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  return route.fulfill({json:{access_token:'qa-access',refresh_token:'qa-refresh',token_type:'Bearer',expires_in:1,scope:'openid chatgpt.tokens.use.direct',id_token:jwt}});
 }
 return route.abort();
});
function sse(output){
 const events=[];
 output.forEach((item,index)=>{
  if(item.type==='message'){
   events.push({type:'response.output_item.added',output_index:index,item:{...item,id:`m-${index}`,content:[]}});
   item.content.forEach((part,contentIndex)=>{
    if(part.type!=='output_text')return;
    const mid=Math.floor(part.text.length/2);
    for(const delta of [part.text.slice(0,mid),part.text.slice(mid)])events.push({type:'response.output_text.delta',output_index:index,item_id:`m-${index}`,content_index:contentIndex,delta});
   });
  }else events.push({type:'response.output_item.done',output_index:index,item});
 });
 events.push({type:'response.completed',response:{status:'completed',output:[]}});
 return events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('');
}
function providerReply(output){return transportMode==='json'?{json:{status:'completed',output}}:{contentType:transportMode==='sse-plain'?'text/plain':'text/event-stream',body:sse(output)};}
const qaModels = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol'].map(slug => ({ slug, display_name: slug, visibility: 'list' }));
let expectedEffort = 'high';
await context.route('https://api.openai.com/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/v1/models')return route.fulfill({json:{models:qaModels}});
 if(url.pathname==='/v1/responses'){
  if(responseGate)await responseGate;
  responseCalls++;
  const data=route.request().postDataJSON();
  if(forceFast400&&data.service_tier!=='default')return route.fulfill({status:400,json:{detail:'PRIVATE_QA_OPAQUE_400'}});
  assert.ok(!JSON.stringify(data.input).includes('AD_PROMO_MARKER'));
  assert.equal(data.store,false);assert.equal(data.stream,true);assert.ok(Array.isArray(data.input));assert.equal(data.service_tier,expectedTier);
  assert.equal(data.model,'gpt-6.1-sol');assert.equal(data.text.format.strict,true);assert.ok(data.instructions.includes('ONE valid JSON object'));assert.ok(data.instructions.includes(JSON.stringify(data.text.format.schema)));
  assert.deepEqual(data.reasoning, { effort: expectedEffort });
  if(data.text.format.name==='page_analysis')assert.ok(data.instructions.includes(`MAXIMUM is ${expectedMaximum} major claims`));
  if(requestInput(data).pageTitle===scopeTitle || scopeExamples.some(e=>e.parent===requestInput(data).claim)){
   const input=requestInput(data);let value;
   if(data.text.format.name==='page_analysis'){
    value=analysisFixture(scopeExamples.map(e=>({claim:e.parent,quote:`${e.core} ${e.extra}`,origin:'body'})),input);
    value.claims.forEach((g,i)=>{g.aspects[0].claim=`${scopeExamples[i].core} ${scopeExamples[i].extra}`;});
   }else{
    const e=scopeExamples.find(e=>e.parent===input.claim),coreUrl='https://evidence.example/core',extraUrl='https://evidence.example/extra';
    value={verdict:'supported',reason:'합성 자료가 **핵심 사건을 확인합니다.**',explanation:'핵심 사건 자체는 **자료로 확인됩니다.**',caveat:'',scopeSourceUrls:[coreUrl],sources:[{url:coreUrl,relation:'supports',evidence:'**핵심 사건**에 대한 합성 근거입니다.'},{url:extraUrl,relation:'context',evidence:'별도 수치 또는 후속 사건의 합성 근거입니다.'}],aspectResults:[{id:input.aspects[0].id,checks:[
     {claim:e.core,quote:e.core,scope:'component',verdict:'supported',reason:'핵심 사건을 확인했습니다.',explanation:'핵심 사건은 자료로 확인됩니다.',sourceUrls:[coreUrl]},
     {claim:e.extra,quote:e.extra,scope:'separate',verdict:e.verdict,reason:e.verdict==='refuted'?'합성 자료에서는 **광고 방송이 중단됐습니다.**':'4%포인트 수치를 뒷받침하는 **근거가 없습니다.**',explanation:'대주장에 포함되지 않는 **독립적인 주장**의 검사입니다.',sourceUrls:[extraUrl]},
    ]}]};
   }
   return route.fulfill(providerReply([...(data.tools?[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://evidence.example/core',title:'핵심 근거 · QA'},{url:'https://evidence.example/extra',title:'별도 근거 · QA'}]}}]:[]),{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]));
  }
  if(data.text.format.name==='article_summary'){
   await new Promise(resolve=>setTimeout(resolve,700));
   assert.ok(!data.tools);assert.ok(data.instructions.endsWith(languageInstruction(languageMode)));
   const input=requestInput(data),copy=translated[languageMode];
   assert.ok(input.sourceBlocks.some(block=>block.text.includes(foreignQuote)));
   return route.fulfill(providerReply([{type:'message',content:[{type:'output_text',text:JSON.stringify({overview:copy[0],sections:[{heading:copy[1],summary:`**${copy[0]}**`,sourceIds:input.sourceBlocks.map(block=>block.id)}],coverage:input.sourceBlocks.map(block=>({sourceId:block.id,role:'content'}))})}]}]));
  }
  if(requestInput(data).pageTitle===foreignTitle || (requestInput(data).aspects && requestInput(data).originalQuote===foreignQuote)){
   assert.ok(data.instructions.endsWith(languageInstruction(languageMode)));
   const input=requestInput(data),copy=translated[languageMode];
   if(data.text.format.name==='page_analysis')return route.fulfill(providerReply([{type:'message',content:[{type:'output_text',text:JSON.stringify(analysisFixture([{quote:foreignQuote,claim:copy[0],origin:'body'}],input))}]}]));
   assert.equal(input.originalQuote,foreignQuote);
   return route.fulfill(providerReply([{type:'web_search_call',status:'completed',action:{sources:[{url:'https://science.nasa.gov/moon/',title:'NASA Moon · QA'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(verdictFixture({verdict:'supported',reason:copy[2],explanation:`**${copy[2]}**`,caveat:'',sources:[{url:'https://science.nasa.gov/moon/',relation:'supports',evidence:copy[2]}]},input))}]}]));
  }
  if(data.text.format.name==='page_images'){
   assert.equal(data.input[0].content[1].type,'input_image');assert.match(data.input[0].content[1].image_url,/^data:image\/jpeg;base64,/);assert.equal(data.input[0].content[1].detail,'high');
   assert.equal(requestInput(data).images[0].id,'image-1');
   return route.fulfill(providerReply([{type:'message',content:[{type:'output_text',text:JSON.stringify({images:[{id:'image-1',transcription:imageText,description:imageDescription,uncertainty:'모의 인식 응답이며 원본의 진위를 증명하지 않습니다.'}]})}]}]));
  }
  const check=data.text.format.name==='fact_verdict';
  if(!check&&transportMode==='html')return route.fulfill({contentType:'text/html',body:'<html>PRIVATE_QA_HTML_TOKEN</html>'});
  if(!check&&malformedMode!=='none'){
   if(malformedMode==='once')malformedMode='none';
   return route.fulfill(providerReply([{type:'message',content:[{type:'output_text',text:'PRIVATE_QA_OUTPUT: invalid prose instead of JSON'}]}]));
  }
  if(!check){
   const analyzed=requestInput(data);const input={title:analyzed.pageTitle,context:analyzed.sourceBlocks.map(block=>({...block,kind:block.origin})),supplementary:analyzed.sourceBlocks.map(block=>({...block,kind:block.origin}))};
   assert.equal(input.title,pageTitle);assert.ok(input.context.some(block=>block.kind==='description'&&block.text===description));
   assert.ok(input.context.some(block=>block.kind==='subtitle'));assert.ok(input.context.some(block=>block.kind==='published'));assert.ok(input.context.some(block=>block.kind==='author'));assert.ok(input.context.some(block=>block.kind==='headings'));
   if(multimodalMode){assert.equal(input.supplementary.some(block=>block.kind==='comment'),!excludeExtras);assert.equal(input.supplementary.some(block=>block.kind==='image_text'),!excludeExtras);}
   const claims=multimodalMode?(excludeExtras?[{claim:'달은 지구를 공전한다.',quote:'달은 지구 주위를 공전한다.',origin:'body'}]:[{claim:'댓글은 달의 관측 주기에 반론을 제기한다.',quote:commentQuote,origin:'comment'},{claim:'이미지의 문구는 관측된 달빛이 자체 발광이 아닌 태양 반사광이라는 의미입니다.',quote:imageText,origin:'image_text'},{claim:'그림은 태양에서 달로 온 빛을 지구에서 관측하는 관계를 설명합니다.',quote:imageDescription,origin:'image_visual'},{claim:'달은 지구를 공전한다.',quote:'달은 지구 주위를 공전한다.',origin:'body'}]):contextMode?[{claim:'제목에 있는 공전 주기',quote:pageTitle,origin:'title'},{claim:'설명에 있는 반사광',quote:description,origin:'description'},{claim:'달의 공전',quote:'달은 지구 주위를 공전한다.',origin:'body'}]:[{claim:'달은 지구를 공전한다',quote:'달은 지구 주위를 공전한다.',origin:'body'},{claim:'달이 자체 발광한다',quote:'달은 스스로 빛을 낸다.',origin:'body'}];
   const analysis=analysisFixture(claims,requestInput(data));
   if(multimodalMode&&!excludeExtras){const promo=requestInput(data).sourceBlocks.find(block=>block.text===subtlePromo);assert.ok(promo);analysis.coverage.find(item=>item.sourceId===promo.id).role='promotional';}
   if(multimodalMode&&!excludeExtras){
    const imageGroup=analysis.claims[1], visualGroup=analysis.claims[2];imageGroup.claim='달빛은 태양 반사광이며 지구에서 관측된다.';imageGroup.context='같은 그림의 문구와 시각적 관계를 한 논점으로 묶었습니다.';imageGroup.aspects.push(...visualGroup.aspects);analysis.claims.splice(2,1);
    analysis.coverage.forEach(block=>{block.groupIds=[...new Set(block.groupIds.map(id=>id===visualGroup.id?imageGroup.id:id))];});
   }
   return route.fulfill(providerReply([{type:'message',content:[{type:'output_text',text:JSON.stringify(analysis)}]}]));
  }
  const original=requestInput(data).originalQuote;assert.ok(!JSON.stringify(requestInput(data)).includes(subtlePromo));
  assert.ok(requestInput(data).context.some(block=>block.text===description));
  if(requestInput(data).quoteOrigin.imageId)assert.equal(data.input[0].content[1].type,'input_image');
  activeChecks++;peakChecks=Math.max(peakChecks,activeChecks);await new Promise(resolve=>setTimeout(resolve,original===pageTitle?500:350));activeChecks--;
  const refuted=original.includes('스스로');
  const verdict={verdict:refuted?'refuted':'supported',reason:refuted?'달은 스스로 빛나지 않고 **태양빛을 반사합니다.**':original===imageText||original===imageDescription?'외부 자료가 **태양빛 반사와 달빛 관측 관계**를 뒷받침합니다.':original===commentQuote?'외부 관측 자료가 **달의 관측 주기**를 제시합니다.':'관측 자료에서 **달의 지구 공전 궤도**가 확인됩니다.',explanation:(refuted?'테스트 검색은 **달이 태양빛을 반사한다**는 근거를 반환했습니다.':'테스트 검색은 **달의 지구 공전**을 뒷받침하는 근거를 반환했습니다.')+(contextMode?' <img src=x onerror="window.qaInjected=true">':''),caveat:'**모의 제공자 응답**입니다.',sources:[{url:'https://science.nasa.gov/moon/',relation:refuted?'contradicts':'supports',evidence:'모의 검색 결과의 **결정적인 근거 요약**입니다.'}]};
  return route.fulfill(providerReply([{type:'web_search_call',status:'completed',action:{sources:[{url:'https://science.nasa.gov/moon/',title:'NASA Moon · QA source'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(verdictFixture(verdict,requestInput(data))),annotations:[]}]}]));
 }
 return route.abort();
});
const diagnosticUploads=[];
await context.route('https://asia-northeast3-daily-odd-builds-portal.cloudfunctions.net/factLensDiagnostics',async route=>{
 const req=route.request(),value=req.postDataJSON();diagnosticUploads.push(value);
 assert.equal(req.headers().authorization,undefined);assert.equal(req.headers().cookie,undefined);
 assert.deepEqual(Object.keys(value).sort(),['chromeMajor','diagnostic','extensionVersion','reportId','schemaVersion']);
 assert.ok(!/PRIVATE|QA_TOKEN|example.test|articleTitle|articleText/.test(JSON.stringify(value)));
 return diagnosticUploads.length===1?route.fulfill({status:429,json:{error:'rate_limit'}}):route.fulfill({json:{accepted:true,reportId:value.reportId}});
});
const panel=await context.newPage();await panel.goto(`${base}/sidepanel.html`);
assert.equal(await panel.locator('#login-gate').isVisible(),true);assert.equal(await panel.locator('#workspace').isVisible(),false);assert.equal(await panel.getByRole('button',{name:'팩트체크',exact:true}).count(),0);
async function begin(){
 const nextPage=context.waitForEvent('page');
 await panel.locator('#gate-login').click();
 const authPage=await nextPage;
 await authPage.waitForURL('https://auth.openai.com/**');
 assert.ok(authPage,'Login opens ordinary auth tab');
 const pending=await worker.evaluate(async()=> (await chrome.storage.session.get('pending')).pending);
 return {authPage,pending};
}
try{
 console.log(`Browser: ${context.browser()?.version() || await worker.evaluate(()=>navigator.userAgent)}`);console.log(`Panel: ${panel.url()} | ${await panel.title()}`);
 for(const mode of ['direct','redirect','js']){
  rejectToken=true;
  const {authPage,pending}=await begin();
  const cb=`${pending.redirectUri}?${new URLSearchParams({code:'qa-invalid',state:pending.state,client_id:'oaiapp_qa'})}`;
  const target=mode==='direct'?cb:`http://example.test/${mode}?to=${encodeURIComponent(cb)}`;
  await authPage.goto(target).catch(()=>{});
  await panel.getByText(/토큰 교환 요청 실패/).first().waitFor();
  assert.equal((await worker.evaluate(async()=> (await chrome.storage.session.get('account')).account)),undefined);
  await authPage.close();
  console.log(`PASS callback without server (${mode}), invalid_grant not authenticated`);
 }
 rejectToken=false;malformedIdentity=true;
 let started=await begin();
 await started.authPage.goto(`${started.pending.redirectUri}?${new URLSearchParams({code:'qa-code',state:started.pending.state,client_id:'oaiapp_qa'})}`).catch(()=>{});
 await panel.getByText(/로그인 계정 또는 증명/).first().waitFor();
 assert.equal(await worker.evaluate(async()=>!!(await chrome.storage.session.get('account')).account),false);
 await started.authPage.close(); console.log('PASS wrong signed ID-token nonce rejected');
 malformedIdentity=false;started=await begin();
 const callsBefore=tokenCalls;
 await started.authPage.goto(`${started.pending.redirectUri}?${new URLSearchParams({code:'qa-code',state:'wrong-state',client_id:'oaiapp_qa'})}`).catch(()=>{});
 await panel.waitForTimeout(100);assert.equal(tokenCalls,callsBefore);
 await started.authPage.goto(`${started.pending.redirectUri}?${new URLSearchParams({code:'qa-code',state:started.pending.state,client_id:'oaiapp_qa'})}`).catch(()=>{});
 await panel.locator('#workspace').waitFor();await panel.locator('#settings').click();
 await panel.getByText(/qa@example.test · 요금제 사용 연결됨/).waitFor();
 await started.authPage.close();
 await panel.locator('#model option[value="gpt-6.1-sol"]').waitFor({state:'attached'});
 const modelPicker = panel.locator('#model'), presetPicker = panel.locator('#model-preset'), effortPicker = panel.locator('#reasoning-effort');
 const autoModel = modelPicker.locator('option[value=""]'), autoEffort = effortPicker.locator('option[value="auto"]');
 assert.equal(await autoModel.textContent(), '자동 · gpt-6.1-terra');
 assert.equal(await autoEffort.textContent(), '자동 · 보통');
 assert.equal(await panel.locator('#fast-mode').isChecked(),true);
 await presetPicker.selectOption('free');
 assert.equal(await autoModel.textContent(), '자동 · gpt-6-luna');
 assert.equal(await autoEffort.textContent(), '자동 · 보통');
 await presetPicker.selectOption('plus');
 assert.equal(await autoModel.textContent(), '자동 · gpt-6.1-terra');
 assert.equal(await autoEffort.textContent(), '자동 · 보통');
 await modelPicker.selectOption('gpt-6.1-sol');
 await effortPicker.selectOption('low');
 await panel.waitForFunction(async () => {
   const saved = await chrome.storage.local.get(['modelPreset', 'selectedModel', 'reasoningEffort']);
   return saved.modelPreset === 'plus' && saved.selectedModel === 'gpt-6.1-sol' && saved.reasoningEffort === 'low';
 });
 const article=await context.newPage();await article.goto('http://example.test/article?private=query#fragment');
 await article.bringToFront();
 await panel.reload();
 await panel.locator('#page-title').filter({hasText:'달과 지구'}).waitFor();
 await panel.locator('#settings').click();
 await panel.locator('#model option[value="gpt-6.1-sol"]').waitFor({state:'attached'});
 assert.equal(await modelPicker.inputValue(), 'gpt-6.1-sol');
 assert.equal(await presetPicker.inputValue(), 'plus');
 assert.equal(await effortPicker.inputValue(), 'low');
 expectedEffort = 'low';
 await panel.locator('#reload-models').click();await panel.waitForTimeout(250);assert.equal(refreshCalls,1);
 console.log('PASS mock OAuth code exchange, JWKS signature/identity, rotating refresh and model list');
 const text=await panel.locator('#article-text').inputValue();assert.ok(text.includes('달은 지구'));assert.ok(!/SECRET|광고 메뉴/.test(text));
 assert.equal(await panel.locator('#fast-mode').isChecked(),true);
 assert.equal(await panel.locator('#settings-general #output-language').count(),1);assert.equal(await panel.locator('#settings-general #fast-mode').count(),1);
 assert.equal(await panel.locator('#input-options #output-language, #input-options #fast-mode').count(),0);
 const uiEvidence=process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(),'fact-lens-evidence');await mkdir(uiEvidence,{recursive:true});
 const originalDraft=await panel.locator('#article-text').inputValue();
 await panel.locator('#settings-tab-creator').click();assert.equal(await panel.locator('#settings-general').isVisible(),false);
 assert.ok((await panel.locator('#settings-creator').innerText()).includes('AI 슬롭 같다구요? 으쩌라구요'));
 assert.equal(await panel.locator('#creator-version').innerText(),`팩트렌즈 · v${manifest.version}`);
 const creatorLinks=await panel.locator('#settings-creator a').evaluateAll(nodes=>nodes.map(a=>({url:a.href,target:a.target,rel:a.rel})));
 assert.deepEqual(creatorLinks.map(a=>a.url),['https://github.com/hssum9409','https://github.com/hssum9409/daily_odd_builds-public/issues','https://daily-odd-builds-portal.web.app/']);assert.ok(creatorLinks.every(a=>a.target==='_blank'&&a.rel.includes('noopener')));
 await panel.setViewportSize({width:320,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.locator('#settings-panel').screenshot({path:path.join(uiEvidence,'settings-creator-320.png')});
 await panel.locator('#settings-tab-creator').press('ArrowLeft');
 assert.equal(await panel.locator('#settings-tab-reading').getAttribute('aria-selected'),'true');
 const readingPreview=panel.locator('#reading-preview');
 assert.equal(await readingPreview.getAttribute('lang'),'ko');
 await panel.locator('#reading-font').selectOption('serif');
 await panel.locator('#reading-size').selectOption('20');
 await panel.locator('#reading-density').selectOption('relaxed');
 const previewStyle=await readingPreview.locator('p').first().evaluate(node=>{
  const style=getComputedStyle(node);return {size:style.fontSize,leading:style.lineHeight,font:style.fontFamily};
 });
 assert.equal(previewStyle.size,'20px');assert.equal(previewStyle.leading,'39px');assert.match(previewStyle.font,/Batang/);
 assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await panel.locator('#settings-reading').screenshot({path:path.join(uiEvidence,'reading-settings-320.png')});
 await panel.locator('#reading-reset').click();
 assert.equal(await panel.locator('#reading-font').inputValue(),'noto');
 assert.equal(await panel.locator('#reading-size').inputValue(),'16');
 assert.equal(await panel.locator('#reading-density').inputValue(),'balanced');
 await panel.locator('#settings-tab-reading').press('ArrowLeft');assert.equal(await panel.locator('#settings-tab-general').getAttribute('aria-selected'),'true');
 await panel.screenshot({path:path.join(uiEvidence,'settings-general-320.png'),fullPage:true});
 await panel.locator('#settings-tab-general').press('End');assert.equal(await panel.locator('#settings-tab-creator').getAttribute('aria-selected'),'true');await panel.locator('#settings-tab-creator').press('Home');
 assert.equal(await panel.locator('#article-text').inputValue(),originalDraft);await panel.setViewportSize({width:440,height:1000});
 assert.ok((await panel.locator('#article-context').inputValue()).includes(description));
 await panel.locator('#settings').click();
 let resumeFirst;responseGate=new Promise(resolve=>{resumeFirst=resolve;});
 await article.bringToFront();await panel.evaluate(()=>document.getElementById('check').click());
 await panel.locator('#check[aria-busy=true] .action-spinner').waitFor();
 assert.equal(await panel.locator('#summarize').getAttribute('aria-busy'),'false');assert.equal(await panel.locator('#summarize-label').innerText(),'요약정리');
 assert.equal(await panel.locator('#check-label').innerText(),'팩트체크 진행 중');
 const spinning=await panel.locator('#check .action-spinner').evaluate(node=>getComputedStyle(node).animationName);assert.equal(spinning,'action-spin');
 await panel.locator('.page-context').screenshot({path:path.join(uiEvidence,'check-running-440.png')});
 responseGate=undefined;resumeFirst();
 await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(await panel.locator('.action-spinner').count(),0);assert.equal(await panel.locator('#check').getAttribute('aria-busy'),'false');
 assert.equal(responseCalls,3);assert.equal(await panel.locator('.claim').count(),2);assert.equal(await panel.locator('.source a').count(),2);
 await panel.locator('#settings').click();
 await effortPicker.selectOption('auto');
 expectedEffort = 'high';
 await panel.locator('#close-settings').click();
 assert.equal(peakChecks,2);assert.ok(await panel.locator('.explanation strong').count()>0);assert.ok(await panel.locator('.evidence strong').count()>0);
 assert.equal(await panel.locator('.claim-section[open]').count(),0);assert.equal(await panel.locator('#page-overview').getAttribute('open'),null);
 assert.equal(await panel.locator('.claim-reason').count(),2);assert.equal(await panel.locator('.claim-reason').first().isVisible(),true);assert.ok((await panel.locator('.claim-reason').first().textContent()).includes('공전 궤도'));assert.ok((await panel.locator('.claim-reason').nth(1).textContent()).includes('태양빛을 반사'));
 const reasonEvidence=process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(),'fact-lens-evidence');await mkdir(reasonEvidence,{recursive:true});
 for(const width of [440,320]){await panel.setViewportSize({width,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const sizes=await panel.locator('.run-actions button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return [r.width,r.height];}));assert.deepEqual(sizes[0],sizes[1]);
 await panel.screenshot({path:path.join(reasonEvidence,`primary-collapsed-${width}.png`),fullPage:true});}
 console.log('PASS equal-size action buttons, mode-specific animated progress/reset, settings-only language/Fast, Day 1 creator tab/links/keyboard/draft preservation');
 await panel.setViewportSize({width:440,height:1000});

 assert.equal(await panel.locator('#overview-text').isVisible(),false);assert.equal(await panel.locator('.original-quote').first().isVisible(),false);assert.equal(await panel.locator('.explanation').first().isVisible(),false);
 assert.equal(await panel.locator('#input-options').isVisible(),false);assert.equal(await panel.locator('#page-domain').isVisible(),false);assert.equal(await panel.locator('#check').isVisible(),true);assert.equal(await panel.locator('#summarize').isVisible(),true);
 await panel.locator('.claim-move').first().click();await article.waitForFunction(()=>getSelection()?.toString().includes('달은 지구'));assert.equal(await panel.locator('.claim-evidence').first().getAttribute('open'),null);
 // Clear the selection in the ARTICLE tab; it must not affect card selection in the panel.
 const firstExpand=panel.locator('.claim-head').first();
 assert.equal(await firstExpand.getAttribute('aria-expanded'),'false');assert.equal(await firstExpand.getAttribute('aria-controls'),await panel.locator('.claim-evidence').first().getAttribute('id'));
 await firstExpand.click();await panel.locator('.source a').first().waitFor();assert.equal(await firstExpand.getAttribute('aria-expanded'),'true');
 assert.equal(await panel.locator('.claim-context').first().getAttribute('open'),null);assert.equal(await panel.locator('.claim-originals').first().getAttribute('open'),null);
 await firstExpand.click();await panel.locator('.source a').first().waitFor({state:'hidden'});assert.equal(await firstExpand.getAttribute('aria-expanded'),'false');
 await firstExpand.focus();await firstExpand.press('Enter');await panel.locator('.source a').first().waitFor();assert.equal(await firstExpand.getAttribute('aria-expanded'),'true');
 assert.equal(await panel.locator('.claim-context').first().getAttribute('open'),null);assert.equal(await panel.locator('.original-quote').first().isVisible(),false);
 await panel.screenshot({path:path.join(reasonEvidence,'primary-expanded-440.png'),fullPage:true});
 await panel.locator('.claim-context > summary').first().click();await panel.locator('.claim-summary').first().waitFor();
 await firstExpand.click();assert.equal(await panel.locator('.claim-context').first().getAttribute('open'),'');assert.equal(await panel.locator('.claim-originals').first().getAttribute('open'),null);
 await firstExpand.click();await panel.locator('.source a').first().waitFor();await panel.locator('.claim-context > summary').first().click();
 await panel.locator('.claim-originals > summary').first().click();await panel.locator('.original-quote').first().waitFor();

 await panel.locator('#page-overview > summary').click();await panel.locator('#overview-text').waitFor();
 await panel.getByRole('button',{name:'오류',exact:true}).click();assert.equal(await panel.locator('.claim').count(),1);
 await panel.getByRole('button',{name:'전체',exact:true}).click();
 assert.equal(await panel.locator('.claim-originals').first().getAttribute('open'),'');assert.equal(await panel.locator('.claim-evidence').first().getAttribute('open'),'');assert.equal(await panel.locator('.claim-head').first().getAttribute('aria-expanded'),'true');
 await panel.getByRole('button',{name:'원문에서 보기',exact:true}).first().click();
 const selectedQuote=await article.evaluate(()=>getSelection().toString());if(!selectedQuote.includes('달은 지구'))console.log('Selection diagnosis',JSON.stringify({selectedQuote,message:await panel.locator('#message').textContent(),original:await panel.locator('.original-quote').first().textContent(),highlight:await article.locator('[data-fact-lens-highlight]').allTextContents()}));assert.ok(selectedQuote.includes('달은 지구'));
 assert.equal(await article.locator('[data-fact-lens-highlight]').count(),1);
 console.log('PASS article extraction, sensitive area exclusion, full mock provider flow, filters and original selection');
 transportMode='sse-plain';malformedMode='once';await article.bringToFront();let nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(responseCalls,7);
 assert.equal(await panel.locator('.claim').count(),2);assert.equal(await panel.locator('#overview-text').isVisible(),false);assert.equal(await panel.locator('.claim-section[open]').count(),0);
 transportMode='sse';malformedMode='always';await article.bringToFront();nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText(/전체 맥락 분석:.*invalid_json/).waitFor();assert.equal(responseCalls,9);
 assert.ok(!(await panel.locator('#message').innerText()).includes('PRIVATE_QA_OUTPUT'));
 const formatDiagnostic=await worker.evaluate(async()=> (await chrome.storage.session.get('lastRequestDiagnostic')).lastRequestDiagnostic);
 assert.equal(formatDiagnostic.code,'invalid_json');assert.equal(formatDiagnostic.phase,'전체 맥락 분석');assert.equal(formatDiagnostic.attempt,2);assert.ok(!JSON.stringify(formatDiagnostic).includes('PRIVATE_QA_OUTPUT'));
 malformedMode='none';
 console.log('PASS 6.1 sol request schema/JSON contract, delta-only terminal reconstruction, one retry recovery and persistent-format error UI without leaking output');
 transportMode='html';await article.bringToFront();nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText(/전체 맥락 분석:.*unexpected_html/).waitFor();assert.equal(responseCalls,10);
 assert.equal(await panel.locator('#copy-diagnostic').isVisible(),true);
 const transportDiagnostic=await worker.evaluate(async()=> (await chrome.storage.session.get('lastRequestDiagnostic')).lastRequestDiagnostic);
 assert.equal(transportDiagnostic.code,'unexpected_html');assert.equal(transportDiagnostic.contentType,'text/html');assert.ok(!JSON.stringify(transportDiagnostic).includes('PRIVATE_QA_HTML_TOKEN'));assert.ok(!(await panel.locator('#message').innerText()).includes('PRIVATE_QA_HTML_TOKEN'));
 assert.equal(diagnosticUploads.length,0);await panel.locator('#report-diagnostic').click();assert.equal(await panel.locator('#diagnostic-report').isVisible(),true);assert.equal(diagnosticUploads.length,0);
 const preview=JSON.parse(await panel.locator('#diagnostic-preview').innerText());assert.equal(preview.diagnostic.code,'unexpected_html');assert.equal(preview.extensionVersion,manifest.version);assert.equal(preview.chromeMajor,156);
 await panel.locator('#send-diagnostic').click();await panel.locator('#diagnostic-status').filter({hasText:'전송 한도'}).waitFor();assert.equal(diagnosticUploads.length,1);
 await panel.locator('#send-diagnostic').click();await panel.locator('#diagnostic-status').filter({hasText:preview.reportId}).waitFor();assert.equal(diagnosticUploads.length,2);assert.deepEqual(diagnosticUploads[0],diagnosticUploads[1]);
 await panel.setViewportSize({width:320,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:path.join(uiEvidence,'diagnostic-report-320.png'),fullPage:true});await panel.setViewportSize({width:440,height:1000});await panel.locator('#cancel-diagnostic').click();
 console.log('PASS opt-in diagnostic preview, no automatic send, strict metadata-only payload, no auth/cookies, visible rate limit, same-id retry and receipt, narrow UI');
 console.log('PASS completed JSON and mislabeled SSE transports; HTML rejected with safe diagnostics button, without a retry or secret leakage');
 expectedTier='default';await panel.locator('#settings').click();await panel.locator('#fast-mode').uncheck();await panel.locator('#edit-input').click();
 await panel.waitForFunction(async()=> (await chrome.storage.local.get('fastMode')).fastMode===false);
 await article.bringToFront();await panel.reload();await panel.locator('#page-title').filter({hasText:pageTitle}).waitFor();
 assert.equal(await panel.locator('#fast-mode').isChecked(),false);
 contextMode=true;transportMode='json';peakChecks=0;
 await article.bringToFront();nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(responseCalls,14);assert.equal(peakChecks,3);
 assert.ok((await panel.locator('.claim-number').nth(0).textContent()).includes('페이지 제목'));
 assert.ok((await panel.locator('.claim-number').nth(1).textContent()).includes('페이지 설명'));
 assert.equal(await panel.locator('.explanation img').count(),0);assert.equal(await panel.evaluate(()=>window.qaInjected),undefined);
 assert.ok((await panel.locator('.explanation').first().textContent()).includes('<img'));
 assert.ok((await panel.locator('#report-meta').textContent()).includes('일반 처리 요청'));
 const contextEvidence=process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(),'fact-lens-evidence');await mkdir(contextEvidence,{recursive:true});
 assert.equal(await panel.locator('.claim-section[open]').count(),0);await panel.screenshot({path:path.join(contextEvidence,'compact-context-440.png'),fullPage:true});
 await panel.locator('.claim-head').first().click();await panel.screenshot({path:path.join(contextEvidence,'context-bold-440.png'),fullPage:true});
 console.log('PASS primary expand/collapse and keyboard control reveal only evidence/sources; context/originals require explicit toggles; ARIA stays synchronized across filtering');
 console.log('PASS independently collapsed context/original/evidence sections, no first-item auto-expansion, preserved toggles across filtering and compact 320/440px layouts');
 console.log('PASS default Fast and persisted opt-out, three overlapping searches, title/metadata origins, complete context, safe inline bold and literal HTML');
 contextMode=false;multimodalMode=true;
 imageFixture=await article.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=220;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,600,220);x.fillStyle='black';x.font='28px sans-serif';x.fillText('달은 태양에서 온 빛을 반사합니다.',20,65);x.fillText('관측 자료 2026',20,120);return c.toDataURL('image/png');});
 await article.evaluate(({commentQuote,adComment,subtlePromo})=>{
  const comments=document.createElement('section');comments.id='comments';comments.innerHTML='<h2>독자 댓글</h2><div class="comment-body"><p></p><p hidden>COMMENT_HIDDEN_SECRET</p><form><textarea>COMMENT_FORM_SECRET</textarea></form></div>';
  comments.querySelector('p').textContent=commentQuote;
  for(let i=0;i<31;i++){const ad=document.createElement('div');ad.className='comment-body';const p=document.createElement('p');p.textContent=adComment+' '+i;ad.append(p);if(i===0){const image=document.createElement('img');image.src='http://example.test/ad.png';image.width=360;image.height=132;ad.append(image);}comments.prepend(ad);}
  const soft=document.createElement('div');soft.className='comment-body';soft.textContent=subtlePromo;comments.append(soft);document.body.append(comments);
  const figure=document.createElement('figure');figure.innerHTML='<img src="http://example.test/fixture.png" width="360" height="132" alt="달빛 관측 도표"><figcaption>관측 조건을 설명하는 테스트 이미지 캡션입니다.</figcaption>';document.querySelector('article').append(figure);
 },{commentQuote,adComment,subtlePromo});
 await article.locator('article img').evaluate(image=>image.decode());
 await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());
 await panel.locator('#image-count').filter({hasText:'1개'}).waitFor();
 assert.ok((await panel.locator('#supplement-text').inputValue()).includes(commentQuote));assert.ok(!(await panel.locator('#supplement-text').inputValue()).includes('AD_PROMO_MARKER'));assert.ok((await panel.locator('#supplement-count').textContent()).includes('홍보 31개 제외'));assert.ok(!/SECRET/.test(await panel.locator('#supplement-text').inputValue()));
 assert.ok(!(await panel.locator('#article-text').inputValue()).includes(commentQuote));
 await article.bringToFront();nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(responseCalls,19);
 assert.equal(await panel.locator('.claim').count(),3);assert.equal(await panel.locator('.image-analysis').count(),1);assert.ok((await panel.locator('#comment-filter-status').textContent()).includes('32개 자동 제외'));
 assert.equal(await panel.locator('.claim-section[open]').count(),0);
 for(const width of [440,320]){await panel.setViewportSize({width,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:path.join(contextEvidence,`filtered-comment-${width}.png`),fullPage:true});}
 await panel.setViewportSize({width:440,height:1000});

 assert.ok((await panel.locator('.claim-number').nth(0).textContent()).includes('댓글'));assert.ok((await panel.locator('.claim-number').nth(1).textContent()).includes('OCR'));assert.ok((await panel.locator('.claim-number').nth(1).textContent()).includes('AI 해석'));
 assert.ok((await panel.locator('.claim h3').first().textContent()).includes('관측 주기에 반론'));assert.ok((await panel.locator('.original-quote').first().textContent()).includes(commentQuote));
 assert.ok(await panel.locator('.original-quote').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))<await panel.locator('.claim h3').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)));
 await panel.locator('.claim-originals > summary').first().click();await panel.locator('.original-quote').first().waitFor();
 await panel.locator('.original-quote').first().click();await article.waitForFunction(text=>getSelection()?.toString()===text,commentQuote);assert.equal(await article.evaluate(()=>getSelection().toString()),commentQuote);assert.equal(await article.locator('[data-fact-lens-highlight]').count(),1);assert.ok((await article.locator('[data-fact-lens-highlight]').textContent()).includes(commentQuote));
 await panel.locator('.claim-originals > summary').nth(1).click();await panel.locator('.original-quote').nth(1).click();await article.locator('img[data-fact-lens-highlight]').waitFor();assert.equal(await article.locator('img[data-fact-lens-highlight]').count(),1);assert.equal(await article.locator('[data-fact-lens-highlight]').count(),1);assert.equal(await article.locator('img[data-fact-lens-highlight]').evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
 await article.screenshot({path:path.join(contextEvidence,'source-highlight.png'),fullPage:true});
 assert.equal(await panel.locator('#claim-limit').count(),0);assert.equal(await panel.locator('#page-overview').isVisible(),true);
 await panel.locator('.claim-head').nth(1).click();assert.equal(await panel.locator('.aspect-results').getAttribute('open'),'');assert.equal(await panel.locator('.aspect-result').first().isVisible(),true);
 assert.equal(await panel.locator('.aspect-result').count(),2);assert.ok((await panel.locator('#claim-count').textContent()).includes('3개'));
 for(const width of [440,320]){await panel.setViewportSize({width,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:path.join(contextEvidence,`multimodal-${width}.png`),fullPage:true});}
 await panel.setViewportSize({width:440,height:1000});
 excludeExtras=true;await panel.locator('#settings').click();await panel.locator('#edit-input').click();await panel.locator('#include-comments').uncheck();await panel.locator('#include-images').uncheck();
 await article.bringToFront();nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(responseCalls,21);assert.equal(await panel.locator('.claim').count(),1);assert.equal(await panel.locator('.image-analysis').count(),0);assert.equal(await panel.locator('#comment-filter-status').isVisible(),false);
 console.log('PASS 31 promotional comments excluded before capture limits, attached ad image excluded, contextual promotional classification, no ad search requests and visible exclusion count');
 console.log('PASS image download/resize and real pixel payload, OCR/visual/comment labels, contextual summaries with small originals, comment/image navigation and persistent highlights, supplementary opt-out and narrow UI');
 forceFast400=true;await panel.locator('#settings').click();await panel.locator('#fast-mode').check();await panel.locator('#edit-input').click();
 await article.bringToFront();nextModelRequest=context.waitForEvent('request',{predicate:request=>request.url().endsWith('/v1/responses')});await panel.evaluate(()=>document.getElementById('check').click());await nextModelRequest;
 await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(responseCalls,24);
 assert.equal(await panel.locator('#fast-mode').isChecked(),true);assert.ok((await panel.locator('#report-warnings').textContent()).includes('일반 처리로 재요청'));
 assert.ok((await panel.locator('#report-meta').textContent()).includes('→ 일반 처리로 재요청'));assert.ok(!(await panel.locator('#message').textContent()).includes('PRIVATE_QA'));
 const fallbackDiagnostic=await worker.evaluate(async()=> (await chrome.storage.session.get('lastRequestDiagnostic')).lastRequestDiagnostic);
 assert.equal(fallbackDiagnostic.requestedTier,'fast');assert.equal(fallbackDiagnostic.wireTier,'default');assert.ok(fallbackDiagnostic.compatibility.includes('standard_fallback'));
 console.log('PASS observed Fast-400/standard-success pattern: same-model recovery, explicit fallback warning/meta, no repeated rejected Fast calls and no provider-text leakage');

 forceFast400=false;multimodalMode=false;excludeExtras=false;contextMode=false;expectedTier='priority';
 await panel.locator('#settings').click();await panel.locator('#reload-models').click();assert.equal(await panel.locator('#max-claims').inputValue(),'8');await panel.locator('#max-claims').fill('4');await panel.locator('#max-claims').press('Tab');await panel.waitForFunction(async()=> (await chrome.storage.local.get('maxClaims')).maxClaims===4);await panel.locator('#max-claims').fill('20');await panel.locator('#max-claims').press('Tab');await panel.waitForFunction(async()=> (await chrome.storage.local.get('maxClaims')).maxClaims===20);expectedMaximum=20;await panel.locator('#edit-input').click();
 await article.goto('https://another.test/foreign');await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());await panel.locator('#page-title').filter({hasText:foreignTitle}).waitFor();
 const fontProtocol=await context.newCDPSession(panel);
 await fontProtocol.send('DOM.enable');await fontProtocol.send('CSS.enable');
 async function assertLocalFont(selector, language){
  const locale=language==='zh'?'zh-Hans':language;
  assert.equal(await panel.locator(selector).getAttribute('lang'),locale);
  const family=await panel.locator(selector).evaluate(async node=>{
   const style=getComputedStyle(node);await document.fonts.load(`400 16px ${style.fontFamily}`,node.textContent);
   return style.fontFamily;
  });
  const suffix={ko:' KR',en:'',ja:' JP',zh:' SC'}[language];
  assert.ok(family.startsWith(`"Fact Lens Noto Sans${suffix}"`),family);
  const {root}=await fontProtocol.send('DOM.getDocument');
  const {nodeId}=await fontProtocol.send('DOM.querySelector',{nodeId:root.nodeId,selector});
  const {fonts}=await fontProtocol.send('CSS.getPlatformFontsForNode',{nodeId});
  assert.ok(fonts.some(font=>font.isCustomFont&&font.glyphCount>0),JSON.stringify(fonts));
 }
 for(const language of ['ko','en','ja','zh']){
  languageMode=language;
  if(!(await panel.locator('#output-language').isVisible()))await panel.locator('#settings').click();
  let resumeSummary;if(language==='ko')responseGate=new Promise(resolve=>{resumeSummary=resolve;});
  await panel.locator('#output-language').selectOption(language);await article.bringToFront();await panel.evaluate(()=>document.getElementById('summarize').click());
  await panel.locator('#summarize[aria-busy=true] .action-spinner').waitFor();assert.equal(await panel.locator('#check').getAttribute('aria-busy'),'false');assert.equal(await panel.locator('#check-label').innerText(),'팩트체크');assert.equal(await panel.locator('#summarize-label').innerText(),'요약정리 진행 중');
  assert.equal(await panel.locator('#stop').innerText(),'요약 중지');
  if(language==='ko'){await panel.locator('.page-context').screenshot({path:path.join(uiEvidence,'summary-running-440.png')});responseGate=undefined;resumeSummary();}
  await panel.getByText('요약정리를 완료했습니다.',{exact:false}).waitFor();assert.equal(await panel.locator('.action-spinner').count(),0);assert.equal(await panel.locator('#summarize').getAttribute('aria-busy'),'false');assert.equal(await panel.locator('#results').isVisible(),false);assert.equal(await panel.locator('#summary-results').isVisible(),true);assert.equal(await panel.locator('#input-options').isVisible(),false);
  assert.ok((await panel.locator('#summary-overview').textContent()).includes(translated[language][0]));assert.equal(await panel.locator('.summary-originals').getAttribute('open'),null);
  await assertLocalFont('#summary-overview',language);
  assert.equal(await panel.locator('#check').isVisible(),true);assert.equal(await panel.locator('#summarize').isVisible(),true);
  await article.bringToFront();await panel.evaluate(()=>document.getElementById('check').click());await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();
  assert.equal(await panel.locator('#summary-results').isVisible(),false);assert.equal(await panel.locator('.claim h3').textContent(),translated[language][0]);assert.ok((await panel.locator('.claim-reason').textContent()).includes(translated[language][2]));
  await assertLocalFont('.claim h3',language);
 }
 await fontProtocol.detach();
 const newEvidence=process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(),'fact-lens-evidence');await mkdir(newEvidence,{recursive:true});
 await panel.locator('#settings').click();await panel.locator('#settings-tab-reading').click();
 await panel.locator('#reading-font').selectOption('system');
 await panel.locator('#reading-size').selectOption('18');
 await panel.locator('#reading-density').selectOption('compact');
 assert.equal(await panel.locator('#reading-preview').getAttribute('lang'),'zh-Hans');
 assert.match(await panel.locator('.claim h3').evaluate(node=>getComputedStyle(node).fontFamily),/Microsoft YaHei/);
 await panel.waitForFunction(async()=>{
  const {readingStyle}=await chrome.storage.local.get('readingStyle');
  return readingStyle?.font==='system'&&readingStyle?.size==='18'&&readingStyle?.density==='compact';
 });
 await panel.locator('#close-settings').click();
 await panel.setViewportSize({width:320,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:path.join(newEvidence,'language-check-320.png'),fullPage:true});
 await article.bringToFront();await panel.reload();await panel.locator('#page-title').filter({hasText:foreignTitle}).waitFor();assert.equal(await panel.locator('#output-language').inputValue(),'zh');assert.equal(await panel.locator('#max-claims').inputValue(),'20');
 assert.equal(await panel.locator('#reading-font').inputValue(),'system');
 assert.equal(await panel.locator('#reading-size').inputValue(),'18');
 assert.equal(await panel.locator('#reading-density').inputValue(),'compact');
 await panel.evaluate(()=>document.getElementById('summarize').click());await panel.getByText('요약정리를 완료했습니다.',{exact:false}).waitFor();await panel.screenshot({path:path.join(newEvidence,'language-summary-320.png'),fullPage:true});
 assert.equal(await panel.locator('#summary-overview').evaluate(node=>getComputedStyle(node).fontSize),'18px');
 console.log('PASS bundled fonts render in four output languages, spacing and font choices apply live, and reading settings survive reload');
 const previousSummary=await panel.locator('#summary-overview').textContent();
 await article.evaluate(()=>document.querySelector('article p').append(' Additional content loaded without navigation.'));
 await panel.locator('#page-update').waitFor();assert.equal(await panel.locator('#summary-overview').textContent(),previousSummary);assert.equal(await panel.locator('#input-options').isVisible(),false);
 await panel.screenshot({path:path.join(newEvidence,'page-update-320.png'),fullPage:true});
 await article.bringToFront();await panel.evaluate(()=>document.getElementById('refresh-page').click());await panel.locator('#page-update').waitFor({state:'hidden'});assert.ok((await panel.locator('#article-text').inputValue()).includes('Additional content loaded'));assert.equal(await panel.locator('#summary-results').isVisible(),false);
 await article.evaluate(()=>history.pushState({},'', '/foreign?spa=1'));await panel.locator('#page-update').waitFor();await article.bringToFront();await panel.evaluate(()=>document.getElementById('refresh-page').click());await panel.locator('#page-update').waitFor({state:'hidden'});
 const switched=await context.newPage();await switched.goto('https://article.test/news');await switched.bringToFront();await panel.locator('#page-update').waitFor();assert.ok((await panel.locator('#page-title').textContent()).includes(foreignTitle));await switched.close();await article.bringToFront();
 languageMode='ko';await panel.locator('#settings').click();await panel.locator('#output-language').selectOption('ko');await panel.locator('#close-settings').click();await panel.setViewportSize({width:440,height:1000});
 assert.equal(await panel.locator('#demo').count(),0);assert.equal(await panel.locator('#welcome').count(),0);assert.equal(await panel.locator('.fast-hint').count(),0);
 console.log('PASS login-only gate, removed guide/demo, four persisted output languages for summary and fact-check, original English quotes, no summary web search, collapsed input, independent move/card/keyboard actions, saved 4-20 claim maximum, live same-URL content/SPA/tab-change overlay and explicit refresh');
 // Deliberately misgroup compound aspects, then exercise verifier-side scope repair.
 await article.evaluate(({title,examples})=>{document.title=title;document.body.replaceChildren();const main=document.createElement('article'),h=document.createElement('h1');h.textContent=title;main.append(h);for(const e of examples){const p=document.createElement('p');p.textContent=`${e.core} ${e.extra}`;main.append(p);}const context=document.createElement('p');context.textContent='이 문서는 실제 정치 사건을 판정하는 기사가 아니라 서로 다른 사실의 판정 범위를 검증하는 충분한 길이의 합성 검사 자료입니다. 원문 이동과 출처 연결도 함께 확인합니다.';main.append(context);document.body.append(main);},{title:scopeTitle,examples:scopeExamples});
 await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());await panel.locator('#page-title').filter({hasText:scopeTitle}).waitFor();const scopeCallsBefore=responseCalls;
 await panel.evaluate(()=>document.getElementById('check').click());await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();assert.equal(responseCalls-scopeCallsBefore,3);assert.equal(await panel.locator('.claim').count(),2);
 const scopedCards=panel.locator('.claim');
 assert.deepEqual(await scopedCards.locator('h3').allTextContents(),[scopeExamples[0].parent,scopeExamples[1].parent]);
 for(const index of [0,1]){assert.ok((await scopedCards.nth(index).locator('.claim-head .badge').textContent()).includes('사실로 뒷받침됨'));await scopedCards.nth(index).locator('.claim-head').click();assert.equal(await scopedCards.nth(index).locator('.source a').getAttribute('href'),'https://evidence.example/core');assert.equal(await scopedCards.nth(index).locator('.claim-originals').getAttribute('open'),null);}
 assert.ok(!(await panel.locator('#claims').innerText()).includes(scopeExamples[0].extra));assert.ok(!(await panel.locator('#claims').innerText()).includes(scopeExamples[1].extra));
 await scopedCards.nth(1).locator('.claim-move').click();await article.waitForFunction(text=>getSelection()?.toString()===text,scopeExamples[1].core);assert.equal(await article.evaluate(()=>getSelection().toString()),scopeExamples[1].core);
 await panel.setViewportSize({width:320,height:1000});assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel.screenshot({path:path.join(newEvidence,'scope-separated-320.png'),fullPage:true});await panel.setViewportSize({width:440,height:1000});await panel.screenshot({path:path.join(newEvidence,'scope-separated-440.png'),fullPage:true});
 console.log('PASS main-topic-first selection: two planned main cards stay supported; unrelated numeric/broadcast details create no extra cards; scoped sources/navigation, three total requests, narrow layout');

 for (const url of ['https://article.test/news','https://another.test/story']) {
  await article.goto(url);await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());
  await panel.locator('#page-domain').filter({hasText:new URL(url).hostname}).waitFor();
  assert.ok((await panel.locator('#article-text').inputValue()).includes('달은 지구'));
 }
 await article.goto('https://another.test/bare');await article.bringToFront();
 await article.locator('#dic_area img').evaluate(img=>img.decode());
 const bare=await worker.evaluate(async()=>{
  const [tab]=await chrome.tabs.query({url:'https://another.test/bare'});
  return (await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extract.js']}))[0].result;
 });
 assert.equal(bare.extractionError,undefined);assert.equal(bare.title,bareTitle);
 assert.ok(bare.text.includes(bareLead));assert.ok(bare.text.includes(bareEnd));
 assert.ok(!/SECRET|사진 설명/.test(bare.text));assert.equal(bare.images.length,1);
 assert.ok(bare.supplementary.some(block=>block.kind==='caption'&&block.text.includes('기사 사진 설명')));
 assert.ok(bare.context.some(block=>block.kind==='subtitle'&&block.text.includes('부제')));
 const leadLocation=bare.locations.find(block=>block.text===bareLead),endLocation=bare.locations.find(block=>block.text===bareEnd);
 assert.ok(leadLocation?.locationId);assert.ok(endLocation?.locationId);
 for(const location of bare.locations)assert.equal(await article.locator(`[data-fact-lens-node="${location.locationId}"]`).count(),1);
 assert.equal(await article.locator(`[data-fact-lens-node="${leadLocation.locationId}"]`).getAttribute('id'),'dic_area');
 assert.equal(await article.locator('#dic_area p').count(),0);
 await panel.evaluate(()=>document.getElementById('read-page').click());
 await panel.locator('#page-title').filter({hasText:bareTitle}).waitFor();
 assert.ok((await panel.locator('#article-text').inputValue()).includes(bareEnd));
 await article.goto('https://another.test/bare-main');await article.bringToFront();
 const bareMain=await worker.evaluate(async()=>{
  const [tab]=await chrome.tabs.query({url:'https://another.test/bare-main'});
  return (await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extract.js']}))[0].result;
 });
 assert.equal(bareMain.extractionError,undefined);assert.ok(bareMain.text.includes(bareLead));assert.ok(bareMain.text.includes(bareEnd));
 assert.ok(!/SECRET/.test(bareMain.text));
 console.log('PASS bare-text/BR article and main fallback, complete lead/end, article preferred over larger recommendation container, one article image, separate caption/subtitle, excluded sensitive regions and stable location IDs');
 await article.goto('https://another.test/long');await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());
 await panel.locator('#page-title').filter({hasText:'긴 본문 전체 읽기'}).waitFor();
 assert.ok((await panel.locator('#article-text').inputValue()).length>36000);assert.ok((await panel.locator('#article-text').inputValue()).includes('문서 맨 마지막의 고유한 핵심 결론'));
 console.log('PASS full article beyond the old 36,000-character cutoff retains the ending; highlights work under strict page style CSP');
 assert.equal(await panel.locator('#settings svg').count(),1);
 assert.equal(await panel.locator('#settings svg circle').getAttribute('cy'),'12');
 await article.goto('https://another.test/empty');await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());
 await panel.getByText(/읽을 수 있는 본문을 찾지 못했습니다/).waitFor();
 assert.ok(!(await panel.locator('#message').innerText()).includes('권한'));
 console.log('PASS production all-site permissions across HTTP and two HTTPS origins without toolbar clicks; short article is not a permissions error; SVG settings button');
 forceFast400=false;expectedTier='priority';contextMode=false;multimodalMode=false;excludeExtras=false;await article.goto('http://example.test/article');await article.bringToFront();await panel.evaluate(()=>document.getElementById('read-page').click());await panel.locator('#page-title').filter({hasText:pageTitle}).waitFor();await panel.evaluate(()=>document.getElementById('check').click());await panel.getByText('검증을 완료했습니다.',{exact:false}).waitFor();
 const evidence=process.env.FACT_LENS_EVIDENCE || path.join(os.tmpdir(),'fact-lens-evidence');await mkdir(evidence,{recursive:true});
 for(const width of [440,320,832]){
  await panel.setViewportSize({width,height:width===832?1890:1000});
  if(width===832)await panel.evaluate(()=>{document.documentElement.style.zoom='1.89';});
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await panel.screenshot({path:path.join(evidence,`panel-${width}.png`),fullPage:true});
 }
 await panel.evaluate(()=>{document.documentElement.style.zoom='1';});await panel.setViewportSize({width:440,height:1000});
 await panel.locator('#settings').click();await panel.locator('#recent-diagnostic').click();await panel.locator('#diagnostic-report').waitFor();assert.ok(JSON.parse(await panel.locator('#diagnostic-preview').innerText()).diagnostic.code);await panel.locator('#cancel-diagnostic').click();
 await panel.locator('#logout').click();
 await panel.getByText('연결을 해제했습니다.',{exact:false}).first().waitFor();assert.equal(await panel.locator('#workspace').isVisible(),false);assert.equal(await panel.locator('#login-gate').isVisible(),true);await panel.screenshot({path:path.join(evidence,'login-gate-440.png'),fullPage:true});
 assert.equal(await worker.evaluate(async()=>!!(await chrome.storage.session.get('account')).account),false);
 assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)).includes('qa-access')),false);
 assert.deepEqual(errors,[]);assert.deepEqual(consoleIssues,[]);console.log(`PASS extension console health: no unexpected errors/warnings; ${expectedResourceErrors} expected negative-fixture resource errors`);
 console.log(`PASS demo distinction, 320/440/native-concept-size no overflow, logout, no plaintext tokens in Chrome storage; screenshots ${evidence}`);
 console.log('Provider/auth are mocked. Real OAuth issuance, plan access, refresh and live fact checking remain unverified. Native toolbar grant is not tested by this harness.');
}finally{
 await context.close();
 if(work.startsWith(path.join(os.tmpdir(),'fact-lens-browser-')))await rm(work,{recursive:true,force:true,maxRetries:3,retryDelay:500});
}
