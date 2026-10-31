import {validateCallback} from './connection.js';
import {BackgroundRenewal,RENEWAL_ALARM} from './renewal.js';

export function isAllowedSender(sender,pages){
  return sender.id===chrome.runtime.id && pages.some(path=>sender.url===chrome.runtime.getURL(path));
}

// One owner per extension service worker. This module has no product UI or model settings.
export function createChromeAuthService({connection,setupStorage,onLogout=async()=>{},changedMessage={type:'auth.changed'},callbackPage='auth-result.html',onDiagnostic,tabClosedMessage='로그인 탭을 닫았습니다.'}){
  const renewal=new BackgroundRenewal(connection),notices=new Set();
  let ready,queue=Promise.resolve(),handling=false;
  const initialize=setupStorage || (async()=>{
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  });
  function enqueue(action){
    const result=queue.then(()=>ready ||= initialize().catch(e=>{ready=undefined;throw e;})).then(action);
    queue=result.catch(()=>{});return result;
  }
  const notify=()=>chrome.runtime.sendMessage(changedMessage).catch(()=>{});
  const restore=()=>enqueue(()=>renewal.sync()).catch(()=>{});
  async function clearPending(closeTab=false){
    const {pending}=await chrome.storage.session.get('pending');
    await chrome.storage.session.remove(['pending','oauthDiagnostic']);await chrome.alarms.clear('oauth-timeout');
    if(closeTab && pending?.tabId)await chrome.tabs.remove(pending.tabId).catch(()=>{});
  }
  async function begin(){
    const attempt=await connection.begin();
    try{
      await clearPending(true);await chrome.storage.session.remove('oauthError');
      const tab=await chrome.tabs.create({url:callbackPage?chrome.runtime.getURL(callbackPage):'about:blank',active:true});
      await chrome.storage.session.set({pending:{tabId:tab.id,state:attempt.state,redirectUri:attempt.redirectUri,clientId:attempt.clientId,expires:attempt.expires}});
      await chrome.alarms.create('oauth-timeout',{when:attempt.expires});
      await chrome.tabs.update(tab.id,{url:attempt.url});await notify();
    }catch{await connection.cancel();await clearPending(true);throw Error('로그인 탭을 열지 못했습니다. 다시 시도해 주세요.');}
  }
  async function cancel(message='로그인을 취소했습니다.'){
    await connection.cancel();await clearPending(true);
    if(message)await chrome.storage.session.set({oauthError:message});await notify();
  }
  async function logout(){
    await clearPending(true);const result=await connection.disconnect();await onLogout();
    await chrome.storage.session.remove('oauthError');await notify();return result;
  }
  async function token(){
    try{return await connection.accessToken();}
    catch(error){await renewal.failed().catch(()=>{});if(!connection.account)await notify();throw error;}
  }
  async function status(){
    const value=await connection.status(),{oauthError,oauthDiagnostic}=await chrome.storage.session.get(['oauthError','oauthDiagnostic']);
    return {connected:!!value.account,sharing:!!value.account?.canGenerate,email:value.account?.name || '',pending:value.pending,error:oauthError || '',diagnostic:oauthDiagnostic || null};
  }
  const run=action=>enqueue(async()=>{try{return await action();}finally{await renewal.sync().catch(()=>{});}});
  chrome.webRequest.onBeforeRequest.addListener(details=>{
    if(details.type!=='main_frame' || handling)return;
    void (async()=>{
      const {pending}=await chrome.storage.session.get('pending'),callback=validateCallback(details.url,pending,details.tabId);
      if(!callback || handling)return;handling=true;
      try{
        await clearPending();
        if(callbackPage)await chrome.tabs.update(details.tabId,{url:chrome.runtime.getURL(callbackPage)}).catch(()=>{});
        await run(async()=>{
          try{await connection.finish({state:pending.state,...callback});await chrome.storage.session.remove('oauthError');}
          catch(error){await chrome.storage.session.set({oauthError:error.message});}
          finally{await notify();}
        });
        if(!callbackPage)await chrome.tabs.remove(details.tabId).catch(()=>{});
      }finally{handling=false;}
    })().catch(()=>{});
  },{urls:['http://127.0.0.1/*'],types:['main_frame']});
  chrome.webRequest.onHeadersReceived.addListener(details=>{
    if(details.type!=='xmlhttprequest' && !(details.type==='main_frame' && details.statusCode>=400))return;
    const url=new URL(details.url);if(url.origin!=='https://auth.openai.com' || !url.pathname.startsWith('/api/accounts/'))return;
    const mime=(details.responseHeaders?.find(h=>h.name.toLowerCase()==='content-type')?.value || '').split(';')[0].trim().toLowerCase();
    if(mime!=='text/html' && details.statusCode<500)return;
    void enqueue(async()=>{
      const {pending}=await chrome.storage.session.get('pending');
      if(!pending || pending.tabId!==details.tabId || pending.expires<Date.now() || notices.has(pending.state))return;
      if(notices.size>20)notices.clear();notices.add(pending.state);
      const diagnostic={stage:'provider-login-page',status:details.statusCode,contentType:mime};
      const message=`OpenAI 로그인 페이지가 ${mime==='text/html'?'HTML로 응답했습니다':'요청에 실패했습니다'} (HTTP ${details.statusCode}). 토큰 교환 전 단계입니다. 로그인 탭을 확인하거나 취소 후 다시 시도해 주세요.`;
      if(onDiagnostic)await onDiagnostic(diagnostic,pending,message);
      else{await chrome.storage.session.set({oauthDiagnostic:diagnostic,oauthError:message});await notify();}
    }).catch(()=>{});
  },{urls:['https://auth.openai.com/api/accounts/*'],types:['xmlhttprequest','main_frame']},['responseHeaders']);
  chrome.tabs.onRemoved.addListener(tabId=>{
    void enqueue(async()=>{const {pending}=await chrome.storage.session.get('pending');if(pending?.tabId===tabId)await cancel(tabClosedMessage);}).catch(()=>{});
  });
  chrome.alarms.onAlarm.addListener(alarm=>{
    if(alarm.name==='oauth-timeout')void enqueue(async()=>{const {pending}=await chrome.storage.session.get('pending');if(pending && pending.expires<=Date.now())await cancel('로그인 요청이 만료됐습니다. 다시 연결해 주세요.');}).catch(()=>{});
    if(alarm.name===RENEWAL_ALARM)void enqueue(async()=>{const connected=!!connection.account;await connection.status();await renewal.tick();if(connected&&!connection.account)await notify();}).catch(restore);
  });
  chrome.runtime.onStartup.addListener(restore);chrome.runtime.onInstalled.addListener(restore);
  chrome.windows.onCreated.addListener(restore);chrome.windows.onRemoved.addListener(restore);
  restore();
  return {run,status:()=>run(status),sessionStatus:()=>run(()=>connection.status()),login:()=>run(begin),cancel:message=>run(()=>cancel(message)),logout:()=>run(logout),token:()=>run(token)};
}
