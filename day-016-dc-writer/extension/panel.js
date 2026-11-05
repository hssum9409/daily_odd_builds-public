import {MODES,STYLES,isWriteUrl,safeDcImage,preservedDocument,validateDocument,validateGeneratedDocument,renderDocument,documentToText,buildRequest,escapeHtml} from './core.js';
import {callEditor} from './editor.js';
import {PanelConnection} from './auth.js';
import {listModels,generateDocument} from './network.js';
import {draftStorage,preparePhoto,assertPhotoCount,base64,analysisImage} from './photos.js';

const $=id=>document.getElementById(id),connection=new PanelConnection();
const fields=['source','title','style','template','reference','instructions','preset','compress','save-draft','analyze'];
let mode='preserve',photos=[],documentDraft=null,targetSnapshot=null,targetId=null,abortGeneration=null,busy=false,saveTimer,templates=[],saving=Promise.resolve(),ready=false;
const report=(message,type='')=>{$('message').textContent=message;$('message').className=type;$('message').hidden=false;};
const handle=fn=>async(...args)=>{try{await fn(...args);}catch(e){report(e.name==='AbortError'?'작업을 취소했습니다.':e.message,'error');}};
function workspace(view='write'){$('welcome').hidden=true;$('settings').hidden=true;$('workspace').hidden=false;setView(view);}
function setView(view){$('write-view').hidden=view!=='write';$('preview-view').hidden=view!=='preview';$('write-tab').classList.toggle('active',view==='write');$('preview-tab').classList.toggle('active',view==='preview');$('write-tab').toggleAttribute('aria-current',view==='write');$('preview-tab').toggleAttribute('aria-current',view==='preview');}
function setBusy(value){busy=value;for(const id of ['generate','apply','regenerate','shorten','retone','import-photos','save-edit','clear-draft','refresh-target','target','replace',...fields])$(id).disabled=value;$('apply').disabled=value || !documentDraft;$('files').disabled=value;for(const node of document.querySelectorAll('.photo button,.photo input,[data-mode]'))node.disabled=value;}
function selectMode(value){if (!MODES[value]) return;mode=value;for(const b of document.querySelectorAll('[data-mode]')){const selected=b.dataset.mode===mode;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);}$('generate').textContent=mode==='preserve'?'원문으로 미리보기':'초안 만들기';saveSoon();}
function dirty(){documentDraft=null;$('apply').disabled=true;saveSoon();}
function saveSoon(){if (!ready) return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>handle(saveDraft)(),400);}
function serialized(){return {version:1,mode,photos:photos.map(({previewUrl,...p})=>p),documentDraft,fields:Object.fromEntries(fields.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))};}
async function saveDraft(){const value=$('save-draft').checked?serialized():null;saving=saving.catch(()=>{}).then(()=>draftStorage(value?'put':'clear',value));return saving;}
function photoUrls(){for(const p of photos) if (p.blob && !p.previewUrl)p.previewUrl=URL.createObjectURL(p.blob);}
function showPhotos(){
  photoUrls();$('photos').replaceChildren();
  photos.forEach((photo,i)=>{
    const card=document.createElement('div');card.className='photo';
    const img=document.createElement('img');img.src=photo.previewUrl || photo.url;img.alt=photo.name || `사진 ${i+1}`;
    const number=document.createElement('span');number.className='number';number.textContent=String(i+1);
    const remove=document.createElement('button');remove.className='remove';remove.textContent='×';remove.setAttribute('aria-label',`사진 ${i+1} 삭제`);remove.disabled=busy;
    remove.onclick=()=>{if(busy)return;if(photo.previewUrl)URL.revokeObjectURL(photo.previewUrl);photos=photos.filter(p=>p.id!==photo.id);$('source').value=$('source').value.replaceAll(`[[사진:${photo.id}]]`,'');showPhotos();dirty();};
    const caption=document.createElement('input');caption.placeholder='사진 설명 (선택)';caption.setAttribute('aria-label',`사진 ${i+1} 설명`);caption.maxLength=500;caption.value=photo.caption || '';caption.oninput=()=>{photo.caption=caption.value;dirty();};
    const controls=document.createElement('div');controls.className='photo-controls';
    for (const [label,action] of [['앞으로',()=>movePhoto(i,-1)],['본문에 넣기',()=>{const source=$('source');source.setRangeText(`\n[[사진:${photo.id}]]\n`,source.selectionStart,source.selectionEnd,'end');source.focus();dirty();}],['뒤로',()=>movePhoto(i,1)]]){
      const b=document.createElement('button');b.textContent=label;b.disabled=busy || (label==='앞으로'&&i===0) || (label==='뒤로'&&i===photos.length-1);b.onclick=action;controls.append(b);
    }
    card.append(img,number,remove,caption,controls);$('photos').append(card);
  });
}
function movePhoto(i,by){if (busy || !photos[i+by])return;[photos[i],photos[i+by]]=[photos[i+by],photos[i]];showPhotos();dirty();}
async function addFiles(files){
  if (busy) throw Error('현재 작업이 끝난 뒤 사진을 추가해 주세요.');
  const images=[...files];assertPhotoCount(photos.length,images.length);if(!images.length)return;
  setBusy(true);const added=[];
  try{for(const f of images)added.push(await preparePhoto(f,$('compress').checked));photos.push(...added);showPhotos();dirty();report(`사진 ${added.length}장을 기기에 준비했습니다. 편집기에 넣을 때 디시에 업로드합니다.`);}
  finally{setBusy(false);$('files').value='';}
}
function renderPreview(){
  if(!documentDraft)return;documentDraft=validateDocument(documentDraft,photos);
  const h=document.createElement('h2');h.className='article-title';h.textContent=documentDraft.title;
  $('preview').replaceChildren();if(documentDraft.title)$('preview').append(h);
  const content=document.createElement('div');content.innerHTML=renderDocument(documentDraft,photos,$('style').value);$('preview').append(content);
  $('apply').disabled=busy;
}
async function generate(override){
  if(busy)return;
  if(!$('source').value.trim()&&!photos.length)throw Error('글이나 사진을 먼저 넣어 주세요.');
  setBusy(true);
  try{
    if(mode==='preserve'&&!override){documentDraft=preservedDocument($('source').value,$('title').value,photos);report('원문을 바꾸지 않고 미리보기를 만들었습니다.','success');}
    else{
      await connection.restore();
      if(!connection.account)throw Error('AI로 글을 다듬으려면 오른쪽 위 계정 버튼에서 ChatGPT를 연결해 주세요.');
      if(!$('model').value)throw Error('ChatGPT 연결 화면에서 사용할 모델을 선택해 주세요.');
      const photoInput=await Promise.all(photos.map(async p=>({...p,analysisUrl:$('analyze').checked&&p.blob?await analysisImage(p.blob):null})));
      const request=buildRequest({source:override?.source ?? $('source').value,title:$('title').value,mode:override?'polish':mode,style:$('style').value,template:[$('preset').value,$('template').value].filter(Boolean).join('\n'),reference:$('reference').value,instructions:[$('instructions').value,override?.instructions].filter(Boolean).join('\n'),photos:photoInput,analyzeImages:$('analyze').checked},$('model').value);
      abortGeneration=new AbortController();const timeout=setTimeout(()=>abortGeneration?.abort(),180000);$('cancel-generation').hidden=false;report('초안을 작성하고 있습니다…');
      try{
        const output=await generateDocument(connection,request,abortGeneration.signal,()=>{});
        const next=validateGeneratedDocument(output,photos),used=new Set(next.blocks.filter(b=>b.type==='image').map(b=>b.id));if($('title').value)next.title=$('title').value;
        for(const p of photos)if(!used.has(p.id))next.blocks.push({type:'image',id:p.id});
        documentDraft=validateDocument(next,photos);report('초안을 만들었습니다. 내용을 확인한 뒤 편집기에 넣어 주세요.','success');
      }finally{clearTimeout(timeout);abortGeneration=null;$('cancel-generation').hidden=true;}
    }
    renderPreview();$('direct-editor').hidden=true;$('preview').hidden=false;workspace('preview');await refreshTargets();await saveDraft();
  }finally{setBusy(false);}
}
async function refreshTargets(){
  const tabs=(await chrome.tabs.query({url:'https://gall.dcinside.com/*'})).filter(t=>isWriteUrl(t.url));
  const old=targetId;$('target').replaceChildren();
  if(!tabs.length){$('target').append(new Option('글쓰기 탭을 열어 주세요',''));targetId=null;targetSnapshot=null;report('디시 PC 글쓰기 화면을 연 뒤 새로고침을 눌러 주세요.');return;}
  for(const tab of tabs){const u=new URL(tab.url);$('target').append(new Option(`${u.searchParams.get('id')} · ${tab.title || '글쓰기'}`,String(tab.id)));}
  const selected=tabs.find(t=>t.id===old)||tabs.find(t=>t.active)||tabs[0];$('target').value=String(selected.id);targetId=selected.id;await readTarget();
}
async function readTarget(){
  targetId=Number($('target').value)||null;targetSnapshot=null;if(!targetId)return;
  targetSnapshot=await callEditor(targetId,'status');$('target-status').textContent=`${targetSnapshot.gallery} · 첨부사진 ${targetSnapshot.images.length}장 · 기본은 기존 글 뒤에 추가합니다.`;$('replace').checked=false;$('undo').hidden=true;
}
async function importPhotos(){
  if(busy)return;await refreshTargets();if(!targetSnapshot)throw Error('디시 PC 글쓰기 탭을 먼저 열어 주세요.');
  const incoming=targetSnapshot.images.filter(p=>!photos.some(item=>(item.tempno===p.tempno && item.tabId===targetId)||(item.uploadRef?.tempno===p.tempno&&item.uploadRef?.tabId===targetId)));assertPhotoCount(photos.length,incoming.length);
  for(const p of incoming){if(!safeDcImage(p.url))continue;photos.push({id:crypto.randomUUID(),tempno:p.tempno,url:p.url,tabId:targetId,name:'디시 첨부사진',caption:''});}
  showPhotos();dirty();report(`디시 첨부사진 ${incoming.length}장을 가져왔습니다.`,'success');
}
async function apply(){
  if(busy)return;if(!documentDraft)throw Error('먼저 초안을 만들어 주세요.');
  const doc=validateDocument(documentDraft,photos);if(!targetId||!targetSnapshot)throw Error('적용할 글쓰기 탭을 불러와 주세요.');
  if(photos.some(p=>p.tempno&&p.tabId!==targetId))throw Error('다른 글쓰기 탭에서 가져온 사진이 있습니다. 해당 사진을 지우거나 원래 탭을 선택해 주세요.');
  if($('replace').checked&&!confirm('선택한 디시 탭의 기존 제목과 본문을 이 초안으로 교체할까요?'))return;
  setBusy(true);report('디시 기본 업로더로 사진을 준비하고 편집기에 적용하고 있습니다…');
  try{
    const payloadPhotos=await Promise.all(photos.map(async p=>p.tempno?{id:p.id,tempno:p.tempno}:{id:p.id,type:p.type,base64:await base64(p.blob)}));
    const next=await callEditor(targetId,'apply',{title:doc.title,html:renderDocument(doc,photos,$('style').value,true),photos:payloadPhotos,replace:$('replace').checked,expected:targetSnapshot});
    targetSnapshot=next;for(const photo of photos){const ref=next.photoRefs?.[photo.id];if(ref)photo.uploadRef={tempno:ref.tempno,tabId:targetId};}$('target-status').textContent=`${next.gallery} · 첨부사진 ${next.images.length}장 · 기본은 기존 글 뒤에 추가합니다.`;$('undo').hidden=false;report(`편집기에 적용했습니다. 새 사진 ${next.uploaded}장. 게시 버튼은 직접 눌러 주세요.`,'success');await saveDraft();
  }finally{setBusy(false);}
}
async function syncConnection(){
  await connection.restore();const account=connection.account;$('connected').hidden=!account;$('connect').hidden=!!account;$('connect').disabled=connection.pending;$('cancel-login').hidden=!connection.pending;
  if(account){$('account-name').textContent=account.name;if(!account.canGenerate){report('계정은 연결됐지만 ChatGPT 사용량 이용 권한은 승인되지 않았습니다.','error');return;}const models=await listModels(connection),{chatgptModel}=await chrome.storage.local.get('chatgptModel');const selected=$('model').value || chatgptModel;$('model').replaceChildren(...models.map(m=>new Option(m.name,m.id)));if(models.some(m=>m.id===selected))$('model').value=selected;report('ChatGPT가 연결됐습니다. 작성 화면에서 AI 초안을 만들 수 있습니다.','success');}
  else{$('model').replaceChildren(new Option('모델 선택',''));abortGeneration?.abort();const {oauthError}=await chrome.storage.session.get('oauthError');if(oauthError)report(oauthError,'error');}
}
let syncing=Promise.resolve();
function syncAccount(){syncing=syncing.catch(()=>{}).then(syncConnection);return syncing;}
async function beginLogin(){
  // A fast provider error or completed callback must not be overwritten by this hint.
  $('connect').disabled=true;report('열린 로그인 탭에서 계정을 선택하고 사용 권한을 확인해 주세요.');
  try{return await connection.begin();}catch(e){$('connect').disabled=false;throw e;}
}
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='oauth:notice'){report(message.message,'error');return;}
  if(message.type==='oauth:changed')handle(syncAccount)();
});
function showTemplates(){const select=$('saved-template');select.replaceChildren(new Option('저장한 양식 선택',''),...templates.map((t,i)=>new Option(t.slice(0,28),String(i))));}
for(const id of fields)$(id).addEventListener(id==='source'||id==='title'||['template','reference','instructions'].includes(id)?'input':'change',()=>{
  if(id==='style'&&documentDraft){renderPreview();saveSoon();}else if(id==='save-draft'){handle(saveDraft)();}else dirty();
});
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{if(busy)return;selectMode(b.dataset.mode);};
$('connect').onclick=handle(beginLogin);$('cancel-login').onclick=handle(async()=>{await connection.cancel();$('cancel-login').hidden=true;report('로그인을 취소했습니다.');});
$('disconnect').onclick=handle(async()=>{$('disconnect').disabled=true;abortGeneration?.abort();try{const result=await connection.disconnect();await syncAccount();report(result.revoked?'이 확장의 ChatGPT 연결을 해제했습니다.':'이 기기의 연결은 해제했습니다. 서버 연결 해제는 확인하지 못했습니다. ChatGPT 설정에서 앱 연결을 해제할 수 있습니다.');}finally{$('disconnect').disabled=false;}});
$('model').onchange=handle(()=>chrome.storage.local.set({chatgptModel:$('model').value}));
$('account-toggle').onclick=()=>{$('welcome').hidden=!$('welcome').hidden;$('workspace').hidden=!$('welcome').hidden;$('settings').hidden=true;};
$('settings-toggle').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('workspace').hidden=!$('settings').hidden;$('welcome').hidden=true;};
$('close-settings').onclick=()=>workspace();$('prepare-first').onclick=()=>workspace();
$('write-tab').onclick=()=>setView('write');$('preview-tab').onclick=()=>{setView('preview');handle(refreshTargets)();};
$('files').onchange=handle(e=>addFiles(e.target.files));
const drop=$('dropzone');drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=handle(async e=>{e.preventDefault();drop.classList.remove('dragging');await addFiles(e.dataTransfer.files);});
document.addEventListener('paste',handle(async e=>{if($('workspace').hidden)return;const files=[...e.clipboardData.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();await addFiles(files);}}));
$('import-photos').onclick=handle(importPhotos);$('generate').onclick=handle(()=>generate());$('regenerate').onclick=handle(()=>generate());$('cancel-generation').onclick=()=>abortGeneration?.abort();
$('refresh-target').onclick=handle(refreshTargets);$('target').onchange=handle(readTarget);$('apply').onclick=handle(apply);
$('undo').onclick=handle(async()=>{if(busy)return;targetSnapshot=await callEditor(targetId,'restore');$('undo').hidden=true;report('적용 전 제목과 본문으로 되돌렸습니다. 업로드된 첨부파일은 디시 편집기에 남아 있습니다.','success');});
$('compare').onclick=()=>{$('original').textContent=$('source').value;$('original').hidden=!$('original').hidden;};
$('direct').onclick=()=>{if(!documentDraft){report('먼저 초안을 만들어 주세요.');return;}$('direct-editor').hidden=false;$('preview').hidden=true;$('edit-title').value=documentDraft.title;$('edit-body').value=documentToText(documentDraft);};
$('save-edit').onclick=handle(async()=>{documentDraft=preservedDocument($('edit-body').value,$('edit-title').value,photos);renderPreview();$('direct-editor').hidden=true;$('preview').hidden=false;await saveDraft();});
$('shorten').onclick=handle(()=>{if(!documentDraft)throw Error('먼저 초안을 만들어 주세요.');return generate({source:documentToText(documentDraft),instructions:'사진과 핵심 사실은 유지하고 본문을 더 짧게 정리한다.'});});
$('retone').onclick=handle(()=>{if(!documentDraft)throw Error('먼저 초안을 만들어 주세요.');const tone=prompt('원하는 말투를 적어 주세요.','편안한 반말');if(tone?.trim())return generate({source:documentToText(documentDraft),instructions:`사진과 사실은 유지한다. 말투 요청: ${tone.slice(0,500)}`});});
$('save-template').onclick=handle(async()=>{const text=$('template').value.trim();if(!text)throw Error('저장할 양식을 먼저 적어 주세요.');if(templates.length>=20)throw Error('양식은 최대 20개까지 저장할 수 있습니다.');templates.push(text.slice(0,5000));await chrome.storage.local.set({templates});showTemplates();report('이 기기에 양식을 저장했습니다.','success');});
$('saved-template').onchange=()=>{if($('saved-template').value!==''){$('template').value=templates[Number($('saved-template').value)] || '';dirty();}};
$('clear-draft').onclick=handle(async()=>{if(!confirm('저장한 글과 사진을 이 기기에서 지울까요?'))return;clearTimeout(saveTimer);await saving.catch(()=>{});await draftStorage('clear');for(const p of photos)if(p.previewUrl)URL.revokeObjectURL(p.previewUrl);photos=[];documentDraft=null;for(const id of ['source','title','template','reference','instructions'])$(id).value='';showPhotos();$('preview').innerHTML='<p class="empty">글과 사진을 넣고 초안을 만들어 주세요.</p>';$('apply').disabled=true;report('기기에 저장한 초안과 사진을 삭제했습니다.','success');});
window.addEventListener('pagehide',()=>{abortGeneration?.abort();for(const p of photos)if(p.previewUrl)URL.revokeObjectURL(p.previewUrl);});
await handle(async()=>{
  const [draft,settings]=await Promise.all([draftStorage('get'),chrome.storage.local.get('templates')]);templates=Array.isArray(settings.templates)?settings.templates.filter(s=>typeof s==='string').slice(0,20):[];showTemplates();
  if(draft?.version===1){for(const id of fields)if(Object.hasOwn(draft.fields || {},id)){if($(id).type==='checkbox')$(id).checked=!!draft.fields[id];else $(id).value=String(draft.fields[id]).slice(0,50000);}photos=Array.isArray(draft.photos)?draft.photos.filter(p=>p.blob instanceof Blob).slice(0,20):[];showPhotos();selectMode(draft.mode);if(draft.documentDraft){try{documentDraft=validateDocument(draft.documentDraft,photos);renderPreview();}catch{documentDraft=null;}}workspace();}
  ready=true;$('apply').disabled=!documentDraft;
})();
await handle(syncAccount)();
