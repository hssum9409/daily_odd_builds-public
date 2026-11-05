import {extractArticle} from './extract.js';
import {models,generateQuiz} from './provider.js';
import {DEFAULT_MODEL,questionCount,isArticleUrl,validateArticle,score} from './shared/quiz.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
let auth={},article=null,report=null,questions=[],answers={},index=0,sourceTabId=null,busy=false,reading=false,controller=null;
let view='welcome',contextSupported=false,contextRevision=0,generationTimer=null,generationStartedAt=0;
let articleIssue='';
const windowId=(await chrome.windows.getCurrent()).id;
const sessionKey=`quiz-window-${windowId}`;
async function rpc(type){const r=await chrome.runtime.sendMessage({type});if(!r?.ok)throw Error(r?.error || '연결 요청을 완료하지 못했어요.');return r.data;}
function message(text=''){
  if(busy){$('generation-status').textContent=text;$('message').hidden=true;return;}
  $('message').textContent=text;$('message').hidden=!text;
}
function settings(show){
  const changed=$('settings').hidden===show;
  $('settings').hidden=!show;$('settings-toggle').setAttribute('aria-expanded',String(show));
  if(show)$('settings').querySelector('.settings-header').after($('message'));else $('unsupported').before($('message'));
  renderView();
  if(changed){if(show)$('settings').scrollTop=0;$(show?'settings-close':'settings-toggle').focus({preventScroll:true});}
}
function selectSettingsTab(name,focus=false){
  for(const tab of ['general','creator']){const active=name===tab,button=$(`settings-tab-${tab}`);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$(`settings-${tab}`).hidden=!active;if(active&&focus)button.focus();}
}
function renderView(){
  const settingsOpen=!$('settings').hidden;
  $('panel-content').hidden=settingsOpen;
  for(const name of ['welcome','game','result'])$(name).hidden=busy || (name==='welcome' && !contextSupported) || view!==name;
  $('generation').hidden=!busy;$('unsupported').hidden=busy || contextSupported || view!=='welcome';
  const create=!busy && contextSupported && view==='welcome' && !!auth.sharing;
  const next=!busy && view==='game' && typeof answers[questions[index]?.id]==='boolean';
  $('quiz-navigation').hidden=settingsOpen || (!create && !next);
  $('generate').hidden=!create;$('generation-disclosure').hidden=!create;$('next').hidden=!next;
}
async function syncContext({reload=false}={}){
  const revision=++contextRevision;
  const [active]=await chrome.tabs.query({active:true,windowId});
  let tab=active;
  if(!isArticleUrl(tab?.url) && active?.url?.startsWith(chrome.runtime.getURL('')) && sourceTabId){const source=await chrome.tabs.get(sourceTabId).catch(()=>null);if(source?.windowId===windowId && isArticleUrl(source.url))tab=source;}
  if(revision!==contextRevision)return;
  contextSupported=isArticleUrl(tab?.url);
  const same=tab?.id===sourceTabId && article?.url.split('#')[0]===tab?.url?.split('#')[0];
  if(!contextSupported){article=null;articleIssue='';reading=false;controls();return;}
  sourceTabId=tab.id;
  if(!auth.sharing){reading=false;controls();return;}
  if(same && !reload && tab.status!=='loading'){reading=false;controls();return;}
  article=null;articleIssue='';reading=true;
  $('article-title').textContent='본문을 읽고 있어요…';$('article-info').textContent='본문에서만 출제해요';controls();
  // Wait for the completed document instead of capturing the previous DOM on navigation.
  if(tab.status==='loading')return;
  try{
    const {captured,issue}=await capture(tab);
    if(revision!==contextRevision)return;
    article=captured;articleIssue=issue;
    $('article-title').textContent=article.title;
    const chars=article.blocks.reduce((n,b)=>n+b.text.length,0);
    $('article-info').textContent=`본문에서만 출제해요 · ${chars.toLocaleString()}자${article.truncated?' · 일부 본문':''}`;
    if(view==='welcome' && !busy)message(!issue && article.truncated?'긴 문서라 화면에서 추출한 본문 중 앞부분 최대 60,000자만 출제 범위에 포함돼요.':'');
  }catch(error){
    if(revision!==contextRevision)return;
    articleIssue=error.message;$('article-title').textContent='문서를 읽지 못했어요';$('article-info').textContent='문서를 다시 열면 본문을 자동으로 읽어요';
  }finally{if(revision===contextRevision){reading=false;controls();}}
}
function generationStage(stage){
  const stages=['reading','creating','checking'],current=stages.indexOf(stage);
  stages.forEach((name,i)=>{const node=$(`stage-${name}`);node.classList.toggle('done',i<current);node.classList.toggle('current',i===current);if(i===current)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
}
function controls(){
  $('generate').disabled=busy || reading || !contextSupported || !auth.sharing || !article || !!articleIssue || !$('count').validity.valid;
  $('generate').textContent=reading?'본문 읽는 중…':articleIssue || '퀴즈 만들기';
  $('generate').classList.toggle('unavailable',!!articleIssue);
  $('generate').title=articleIssue;
  for(const id of ['count','model','fast','reload-models','clear-quiz'])$(id).disabled=busy || reading;
  $('minus').disabled=busy || Number($('count').value)<=5;$('plus').disabled=busy || Number($('count').value)>=20;
  $('stop').disabled=!busy;renderView();
}
async function save(){
  if(!report){await chrome.storage.session.remove(sessionKey);return;}
  await chrome.storage.session.set({[sessionKey]:{report,questions,answers,index,sourceTabId,view}});
}
function clear(){controller?.abort();contextRevision++;reading=false;article=null;articleIssue='';report=null;questions=[];answers={};index=0;sourceTabId=null;view='welcome';void chrome.storage.session.remove(sessionKey);$('article-title').textContent='나무위키 문서를 열어 주세요';$('article-info').textContent='본문에서만 출제해요';controls();}
async function refreshAuth(){
  const was=auth.sharing;auth=await rpc('auth.status');
  $('login-gate').hidden=!!auth.sharing;$('workspace').hidden=!auth.sharing;
  for(const id of ['login','gate-login'])$(id).hidden=!!auth.pending || !!auth.sharing;
  for(const id of ['cancel-login','gate-cancel'])$(id).hidden=!auth.pending;
  $('logout').hidden=!auth.connected;
  $('account-status').textContent=auth.pending?'열린 탭에서 ChatGPT 로그인을 완료해 주세요.':auth.connected?`${auth.email || 'ChatGPT 계정'} · ${auth.sharing?'연결됨':'요금제 사용 권한 필요'}`:'ChatGPT 계정으로 연결해 주세요.';
  if(!auth.sharing){clear();if(auth.pending)message('열린 탭에서 ChatGPT 로그인을 완료해 주세요.');}
  if(auth.error)message(auth.error);
  controls();return !!auth.sharing && !was;
}
async function capture(tab){
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractArticle});
  if(!result[0]?.result)throw Error('본문을 읽지 못했어요. 나무위키 문서가 열린 뒤 다시 시도해 주세요.');
  const captured=result[0].result;let issue='';
  try{validateArticle(captured);}catch(error){if(!['article_too_short','article_too_long'].includes(error.code))throw error;issue=error.message;}
  if(captured.url.split('#')[0]!==tab.url.split('#')[0])throw Error('이동한 문서의 본문을 읽고 있어요. 잠시 후 다시 시도해 주세요.');
  return {captured,issue};
}
async function loadModels(){
  if(!auth.sharing)throw Error('ChatGPT를 먼저 연결해 주세요.');
  const saved=$('model').value || DEFAULT_MODEL,available=await models(AbortSignal.timeout(25000));
  const unique=new Map([[DEFAULT_MODEL,{id:DEFAULT_MODEL,name:'GPT-6.1 Terra · 기본'}],...available.map(m=>[m.id,m])]);
  if(!unique.has(saved))unique.set(saved,{id:saved,name:`${saved} · 목록에서 미확인`});
  $('model').replaceChildren(...[...unique.values()].map(m=>{const o=el('option',m.name);o.value=m.id;return o;}));$('model').value=saved;
  message(available.some(m=>m.id===saved)?'계정에서 사용할 수 있는 모델 목록을 불러왔어요.':'선택한 모델은 계정 목록에서 확인되지 않았어요. 기본값은 유지하며, 실제 사용 가능 여부는 요청 시 확인돼요.');
}
function game(){
  const q=questions[index];if(!q)return results();
  view='game';renderView();
  $('game-article').textContent=report.article.title;
  $('progress-label').textContent=`${index+1} / ${questions.length} 문제`;
  $('live-score').textContent=`${score(questions,answers)}개 정답`;
  $('progress').max=questions.length;$('progress').value=Object.keys(answers).length;
  $('question').textContent=q.statement;
  const answered=typeof answers[q.id]==='boolean';
  for(const [id,value] of [['answer-o',true],['answer-x',false]]){$(id).disabled=answered;$(id).classList.toggle('chosen',answered && answers[q.id]===value);$(id).setAttribute('aria-pressed',String(answered && answers[q.id]===value));}
  $('feedback').hidden=!answered;
  if(answered){
    const correct=answers[q.id]===q.answer;
    $('verdict').textContent=correct?'정답이에요! 잘 읽었네요 ✨':`아쉽다! 정답은 ${q.answer?'O':'X'}예요`;
    $('explanation').textContent=q.explanation;$('correction').textContent=q.correction?`본문에 따르면: ${q.correction}`:'';
    $('quote').textContent=q.quote;$('source-section').textContent=q.section || '본문';
    $('next').textContent=index===questions.length-1?'결과 보기':'다음 문제';
  }
}
function answer(value){const q=questions[index];if(!q || typeof answers[q.id]==='boolean')return;answers[q.id]=value;game();void save().catch(()=>message('현재 답을 세션에 저장하지 못했어요. 패널을 닫으면 진행 상황이 사라질 수 있어요.'));}
function results(){
  view='result';renderView();
  const correct=score(questions,answers);$('final-score').textContent=`${correct} / ${questions.length}`;
  $('result-comment').textContent=correct===questions.length?'전부 맞혔어요! 지피쨩도 박수 짝짝 👏':'읽었는데 헷갈리는 건 정상! 본문 근거와 함께 다시 봐요.';
  $('retry-wrong').hidden=correct===questions.length;
  const tier={priority:'Fast',fast:'Fast',default:'일반',unreported:'미확인'};
  $('request-meta').textContent=`${report.model} · ${report.fast?'Fast 요청':'일반 요청'}${report.compatibility.includes('standard_fallback')?' → 일반 처리 재요청':''} · 실제 처리: ${report.effectiveTiers.map(t=>tier[t] || t).join(', ')}${report.article.truncated?' · 일부 본문으로 출제':''} · ${new Date(report.article.capturedAt).toLocaleString('ko-KR')} 본문 기준`;
  const list=$('review-list');list.replaceChildren();
  for(const [i,q] of questions.entries()){
    const a=el('article','');a.append(el('h2',`${i+1}. ${q.statement}`),el('p',`정답 ${q.answer?'O':'X'} · 내 답 ${answers[q.id]===true?'O':answers[q.id]===false?'X':'미응답'}`),el('p',q.explanation));
    if(q.correction)a.append(el('p',`본문에 따르면: ${q.correction}`));a.append(el('blockquote',q.quote));list.append(a);
  }
}
async function generate(){
  if(busy || reading || !contextSupported || !auth.sharing || !article || articleIssue || !$('count').reportValidity())return;
  // Freeze this quiz's source before yielding. Automatic context updates only affect the next quiz.
  const captured=article;
  busy=true;controller=new AbortController();settings(false);generationStage('reading');
  generationStartedAt=Date.now();$('generation-meta').textContent=`OX ${questionCount($('count').value)}문제를 준비하고 있어요.`;$('generation-elapsed').textContent='0초 경과';
  generationTimer=setInterval(()=>{$('generation-elapsed').textContent=`${Math.floor((Date.now()-generationStartedAt)/1000)}초 경과`;},1000);
  controls();message('읽어 둔 본문으로 문제를 준비하고 있어요…');$('generation-heading').focus();
  try{
    controller.signal.throwIfAborted();
    const selectedModel=$('model').value || DEFAULT_MODEL,count=questionCount($('count').value);
    const next=await generateQuiz(captured,selectedModel,count,controller.signal,{fast:$('fast').checked,onPhase:message,onStage:generationStage});
    controller.signal.throwIfAborted();
    report=next;questions=next.questions;answers={};index=0;game();
    await save();settings(false);message('');$('question').focus();
  }catch(e){const text=controller.signal.aborted?'출제를 취소했어요.':e.message;busy=false;home();message(text);}
  finally{clearInterval(generationTimer);generationTimer=null;busy=false;controller=null;controls();if(view==='game')$('question').focus();}
}
function home(){view='welcome';renderView();void syncContext().catch(e=>message(e.message));void save();}
function retry(onlyWrong){const missed=questions.filter(q=>answers[q.id]!==q.answer);questions=onlyWrong?missed:report.questions;answers={};index=0;message('같은 문제로 다시 풀어요. 새 모델 요청은 보내지 않아요.');game();void save();}
function wire(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>message(e.message)));}
wire('settings-toggle',()=>settings($('settings').hidden));wire('settings-close',()=>settings(false));
$('creator-version').textContent=`지피쨩 나무위키 OX 퀴즈 · v${chrome.runtime.getManifest().version}`;
for(const name of ['general','creator']){
  wire(`settings-tab-${name}`,()=>selectSettingsTab(name));
  $(`settings-tab-${name}`).addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();selectSettingsTab(event.key==='Home'?'general':event.key==='End'?'creator':name==='general'?'creator':'general',true);});
}
for(const id of ['login','gate-login'])wire(id,async()=>{await rpc('auth.login');await refreshAuth();});
for(const id of ['cancel-login','gate-cancel'])wire(id,async()=>{await rpc('auth.cancel');await refreshAuth();});
wire('logout',async()=>{controller?.abort();const r=await rpc('auth.logout');await chrome.storage.session.remove(sessionKey);await refreshAuth();message(r.revoked?'ChatGPT 연결과 이 기기의 인증정보를 지웠어요.':'이 기기의 인증정보를 지웠어요. OpenAI 측 연결 해제는 확인하지 못했어요.');});
wire('clear-quiz',async()=>{clear();await syncContext();message('현재 문제와 답을 지웠어요.');});wire('reload-models',loadModels);
wire('generate',generate);wire('stop',()=>controller?.abort());wire('answer-o',()=>answer(true));wire('answer-x',()=>answer(false));
wire('next',async()=>{index++;game();$('panel-content').scrollTop=0;await save();if(index<questions.length)$('question').focus({preventScroll:true});});
wire('leave-game',home);wire('new-quiz',home);wire('retry-all',()=>retry(false));wire('retry-wrong',()=>retry(true));
async function changeCount(delta){$('count').value=Math.min(20,Math.max(5,questionCount($('count').value)+delta));await chrome.storage.local.set({questionCount:Number($('count').value)});controls();}
wire('minus',()=>changeCount(-1));wire('plus',()=>changeCount(1));
$('count').addEventListener('input',controls);$('count').addEventListener('change',()=>{if($('count').validity.valid)void chrome.storage.local.set({questionCount:Number($('count').value)});controls();});
$('model').addEventListener('change',()=>void chrome.storage.local.set({selectedModel:$('model').value}));
$('fast').addEventListener('change',()=>void chrome.storage.local.set({fastMode:$('fast').checked}));
document.addEventListener('keydown',e=>{if(e.repeat || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) || !$('settings').hidden || $('game').hidden)return;if(e.key.toLowerCase()==='o')answer(true);if(e.key.toLowerCase()==='x')answer(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && !$('settings').hidden){e.preventDefault();settings(false);}});
chrome.tabs.onUpdated.addListener((id,info,tab)=>{if(tab.windowId===windowId && (tab.active || id===sourceTabId) && (info.url || info.status || info.title))void syncContext({reload:info.status==='complete' || !!info.title}).catch(e=>message(e.message));});
chrome.tabs.onActivated.addListener(({windowId:id})=>{if(id===windowId)void syncContext().catch(e=>message(e.message));});
chrome.tabs.onRemoved.addListener(()=>{void syncContext().catch(()=>{});});
chrome.runtime.onMessage.addListener(event=>{if(event?.type==='auth.changed')void refreshAuth().then(added=>{if(added)return syncContext();}).catch(e=>message(e.message));});
const prefs=await chrome.storage.local.get(['selectedModel','fastMode','questionCount']);
$('fast').checked=prefs.fastMode!==false;$('count').value=questionCount(prefs.questionCount);
if(prefs.selectedModel && prefs.selectedModel!==DEFAULT_MODEL){const o=el('option',prefs.selectedModel);o.value=prefs.selectedModel;$('model').append(o);$('model').value=prefs.selectedModel;}
try{
  await syncContext();
  await refreshAuth();
  const saved=(await chrome.storage.session.get(sessionKey))[sessionKey];
  if(auth.sharing && saved?.report && Array.isArray(saved.questions) && saved.questions.length){
    report=saved.report;validateArticle(report.article);questions=saved.questions;answers=saved.answers || {};index=Math.max(0,Math.min(questions.length,Number(saved.index)||0));sourceTabId=saved.sourceTabId;
    if(saved.view!=='welcome')game();
  }
  await syncContext();
}catch(e){message(e.message);}
controls();
