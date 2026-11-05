import {isWriteUrl} from './core.js';

// This function is serialized by chrome.scripting into the page's MAIN world.
// It never clicks submit, changes login fields, reads cookies, or uses our own upload endpoint.
export async function editorCommand(command, data = {}) {
  try {
  const fail = message => { throw Error(message); };
  const u = new URL(location.href);
  if (u.protocol !== 'https:' || u.hostname !== 'gall.dcinside.com' || u.port || !/^\/(?:mgallery\/|mini\/)?board\/write\/?$/.test(u.pathname) || !/^[a-zA-Z0-9_]+$/.test(u.searchParams.get('id') || '')) fail('디시 PC 글쓰기 화면에서 실행해 주세요.');
  const $ = window.jQuery; const memo = $?.('#memo'); const subject = document.querySelector('#subject');
  if (!memo?.data('summernote') || !subject || document.querySelectorAll('.note-editable').length !== 1) fail('디시 편집기가 아직 준비되지 않았거나 구조가 변경되었습니다.');
  const setTitle = value => {
    subject.value=value;
    subject.dispatchEvent(new Event('input',{bubbles:true}));subject.dispatchEvent(new Event('change',{bubbles:true}));subject.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
    // DC uses a separate label rather than the input's native placeholder.
    const label=document.querySelector('label.txt_placeholder[for="subject"]');if(label)label.style.display=value?'none':'';
  };
  const code = () => memo.summernote('code');
  const safeUrl = value => { try { const p = new URL(value); return p.protocol === 'https:' && !p.username && !p.password && !p.port && ['dcinside.com','dcinside.co.kr'].some(host=>p.hostname===host || p.hostname.endsWith('.'+host)); } catch { return false; } };
  const images = () => [...document.querySelector('.note-editable').querySelectorAll('img')].filter(n => n.getAttribute('data-tempno') && safeUrl(n.src)).map(n=>({tempno:n.getAttribute('data-tempno'),url:n.src,html:n.outerHTML}));
  const snapshot = () => ({url:location.href,title:subject.value,html:code(),images:images(),gallery:u.searchParams.get('id'),uploadLimit:typeof upload_count_file === 'number' ? upload_count_file : 0});
  if (command === 'status') return snapshot();
  const store = window.__dcWriterState ||= {busy:false,backup:null,uploads:{}};
  if (command === 'restore') {
    if (!store.backup) fail('이 탭에서 되돌릴 내용이 없습니다.');
    if (code() !== store.backup.after || subject.value !== store.backup.afterTitle) fail('적용 후 편집한 내용이 있어 자동으로 되돌리지 않았습니다.');
    // Uploaded attachment records remain valid; only the editor content is restored.
    memo.summernote('code',store.backup.html); setTitle(store.backup.title); store.backup=null; return snapshot();
  }
  if (command !== 'apply') fail('지원하지 않는 명령입니다.');
  if (store.busy) fail('이미 사진을 적용하고 있습니다. 잠시 기다려 주세요.');
  if (store.uncertain) fail('이전 업로드의 완료 여부가 불확실합니다. 초안은 확장에 보관하고 디시 글쓰기 탭을 새로고침한 뒤 다시 불러와 주세요.');
  if (data.expected?.url !== location.href || data.expected?.html !== code() || data.expected?.title !== subject.value) fail('글쓰기 화면이 바뀌었습니다. 편집기 상태를 다시 불러온 뒤 적용해 주세요.');
  if (!Array.isArray(data.photos) || data.photos.length > 20 || typeof data.html !== 'string' || data.html.length > 100000 || typeof data.title !== 'string' || data.title.length > 40) fail('초안 또는 사진 크기가 올바르지 않습니다.');
  const template = document.createElement('template'); template.innerHTML = data.html;
  const allowed = new Set(['P','BR','H2','H3','UL','OL','LI','BLOCKQUOTE','STRONG','EM','SPAN']);
  for (const n of template.content.querySelectorAll('*')) {
    if (!allowed.has(n.tagName)) fail('지원하지 않는 HTML 태그가 있습니다.');
    for (const attr of [...n.attributes]) if (attr.name !== 'style' && attr.name !== 'data-dc-writer-photo') fail('지원하지 않는 HTML 속성이 있습니다.');
    if (n.hasAttribute('style') && (!/^[a-z0-9#:%;.,\s()\-]+$/i.test(n.getAttribute('style')) || /url|expression|@|behavior/i.test(n.getAttribute('style')))) fail('서식 값이 올바르지 않습니다.');
  }
  const ids = new Set(data.photos.map(p=>p.id)); const marks = [...template.content.querySelectorAll('[data-dc-writer-photo]')];
  if (ids.size !== data.photos.length || marks.length !== data.photos.length || new Set(marks.map(n=>n.dataset.dcWriterPhoto)).size !== marks.length || marks.some(n=>!ids.has(n.dataset.dcWriterPhoto))) fail('사진 배치 정보가 올바르지 않습니다.');
  const before = snapshot(); const imported = new Map(before.images.map(p=>[p.tempno,p]));
  const newPhotos = data.photos.filter(p=>!p.tempno && !store.uploads[p.id]);
  if (newPhotos.length && typeof imageUploader !== 'function') fail('디시 기본 이미지 업로더를 찾지 못했습니다.');
  if (before.images.length + newPhotos.length > before.uploadLimit) fail('디시 첨부 개수 제한을 초과합니다.');
  for (const p of data.photos) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(p.id)) fail('사진 식별자가 올바르지 않습니다.');
    if (p.tempno) { if (!imported.has(p.tempno)) fail('가져온 디시 사진이 삭제되었습니다.'); continue; }
    if (store.uploads[p.id]) continue;
    if (typeof p.base64 !== 'string' || p.base64.length > 28 * 1024 * 1024 || !['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(p.type)) fail('지원하지 않거나 너무 큰 이미지입니다.');
  }
  const originalDisabled = document.querySelector('.note-editable').getAttribute('contenteditable');
  store.busy = true;
  document.querySelector('.note-editable').setAttribute('contenteditable','false');
  let ownedHtml = before.html;
  try {
    for (const photo of data.photos) {
      if (photo.tempno || store.uploads[photo.id]) continue;
      if (code() !== ownedHtml || subject.value !== before.title) fail('업로드 중 본문이 변경되어 적용을 중단했습니다.');
      const bytes = Uint8Array.from(atob(photo.base64), c=>c.charCodeAt(0));
      if (bytes.length > 20 * 1024 * 1024) fail('사진은 20MB 이하로 넣어 주세요.');
      const ext = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp'}[photo.type];
      const file = new File([bytes],`dcwriter-${photo.id}.${ext}`,{type:photo.type});
      const seen = new Set(images().map(p=>p.tempno));
      // Observe the site's own uploader completion; keep its attachments array and metadata intact.
      const attached = await new Promise((resolve,reject)=>{
        const ns = '.dcWriterUpload'; let timer;
        const clean = () => { observer.disconnect(); clearTimeout(timer); $(document).off(ns); };
        const observer = new MutationObserver(()=>{
          const own = typeof attachments !== 'undefined' ? attachments.find(p=>p.filename===file.name) : null;
          const found = images().find(p=>!seen.has(p.tempno) && (!own || p.tempno===String(own.file_temp_no)));
          if (found) { clean(); resolve(found); }
        });
        observer.observe(document.querySelector('.note-editable'),{childList:true,subtree:true,attributes:true});
        $(document).on('ajaxError'+ns,(_e,_xhr,settings)=>{if (String(settings.url).startsWith('https://upimg.dcinside.com/')) {clean();reject(Error('디시 사진 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.'));}});
        $(document).on('ajaxSuccess'+ns,(_e,_xhr,settings,response)=>{if (String(settings.url).startsWith('https://upimg.dcinside.com/') && response?.files?.some(f=>f.error)) {clean();reject(Error('디시가 사진 업로드를 거절했습니다. 파일 형식과 크기를 확인해 주세요.'));}});
        timer = setTimeout(()=>{store.uncertain=true;clean();reject(Error('사진 업로드 응답을 기다리다 중단했습니다. 초안을 보관하고 디시 글쓰기 탭을 새로고침해 주세요.'));},35000);
        try { memo.summernote('focus'); memo.summernote('createRange').collapse(false).select(); imageUploader(file,document.querySelector('.note-editable')); } catch(e) {clean();reject(e);}
      });
      // The site's asynchronous pHash callback can update an uploaded img after insertion.
      const waitUntil=Date.now()+15000;
      while (typeof phashPending==='number' && phashPending>0 && Date.now()<waitUntil) await new Promise(r=>setTimeout(r,50));
      store.uploads[photo.id] = images().find(p=>p.tempno===attached.tempno) || attached; ownedHtml = code();
    }
    if (code() !== ownedHtml || subject.value !== before.title) fail('본문이 변경되어 적용을 중단했습니다.');
    for (const n of marks) {
      const p = data.photos.find(p=>p.id===n.dataset.dcWriterPhoto);
      const record = p.tempno ? imported.get(p.tempno) : images().find(i=>i.tempno===store.uploads[p.id]?.tempno) || store.uploads[p.id];
      if (!record) fail('업로드된 사진을 찾지 못했습니다. 편집기 상태를 다시 불러와 주세요.');
      const holder = document.createElement('template'); holder.innerHTML=record.html;
      const img = holder.content.querySelector('img'); if (!img || !safeUrl(img.src)) fail('디시 이미지 주소가 올바르지 않습니다.');
      const native = typeof attachments !== 'undefined' ? attachments.find(a=>String(a.file_temp_no)===record.tempno) : null;
      if(native?.phash)img.setAttribute('data-phash',native.phash);
      for (const attr of [...img.attributes]) if (!['src','data-tempno','data-phash','class','alt','width','height','style'].includes(attr.name)) img.removeAttribute(attr.name);
      img.style.maxWidth='100%'; img.style.height='auto'; const ptag=document.createElement('p');ptag.append(img);n.replaceWith(ptag);
    }
    const output = (data.replace ? '' : before.html) + template.innerHTML;
    if (output.length > 65000) fail('디시 편집기 본문 길이 제한에 가깝습니다. 글을 줄여 주세요.');
    memo.summernote('code',output);
    if (data.title && (data.replace || !before.title)) setTitle(data.title);
    store.backup={html:before.html,title:before.title,after:code(),afterTitle:subject.value};
    return {...snapshot(),uploaded:newPhotos.length,photoRefs:Object.fromEntries(data.photos.map(p=>[p.id,p.tempno?imported.get(p.tempno):store.uploads[p.id]]))};
  } catch(e) {
    // Keep completed uploads/attachment records for retry. Never claim rollback of a remote upload.
    if (code() === ownedHtml && subject.value === before.title) memo.summernote('code',before.html);
    throw e;
  } finally {
    document.querySelector('.note-editable').setAttribute('contenteditable',originalDisabled || 'true'); store.busy=false;
  }
  } catch(e) { return {error:String(e.message || '편집기에 적용하지 못했습니다.').slice(0,500)}; }
}

export async function callEditor(tabId, command, payload) {
  const tab = await chrome.tabs.get(tabId);
  if (!isWriteUrl(tab.url)) throw Error('디시 PC 글쓰기 탭을 선택해 주세요.');
  const result = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:editorCommand,args:[command,payload || {}]});
  if(result[0]?.result?.error)throw Error(result[0].result.error);
  if (!result[0]?.result) throw Error('편집기에서 응답을 받지 못했습니다.');
  return result[0].result;
}
