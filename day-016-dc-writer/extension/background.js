import {ChatGPTConnection} from './auth.js';
import {createChromeAuthService,isAllowedSender} from './vendor/chatgpt-auth/chrome.js';
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
const auth=createChromeAuthService({
  connection:new ChatGPTConnection(),callbackPage:null,changedMessage:{type:'oauth:changed'},tabClosedMessage:'로그인 창을 닫았습니다.',
  onLogout:async()=>{await chrome.storage.session.remove('chatgptModel');await chrome.storage.local.remove('chatgptModel');},
  onDiagnostic:async(diagnostic,pending)=>{
    await chrome.storage.session.set({oauthDiagnostic:{...diagnostic,htmlInsteadOfJson:diagnostic.contentType==='text/html'}});
    const message=`OpenAI 로그인 페이지의 요청이 ${diagnostic.contentType==='text/html'?'HTML로 응답했습니다':'실패했습니다'} (HTTP ${diagnostic.status}). 확장의 토큰 교환 전 단계입니다. 로그인 탭에서 오류를 확인하거나 로그인 취소 후 다시 시도해 주세요.`;
    await chrome.runtime.sendMessage({type:'oauth:notice',state:pending.state,message}).catch(()=>{});
  }
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!isAllowedSender(sender,['panel.html']) || message?.type!=='oauth:session')return;
  const actions={status:auth.sessionStatus,token:auth.token,begin:auth.login,cancel:()=>auth.cancel(''),disconnect:auth.logout};
  if(!Object.hasOwn(actions,message.action)){reply({ok:false,error:'지원하지 않는 연결 요청입니다.'});return;}
  actions[message.action]().then(value=>reply({ok:true,value}),error=>reply({ok:false,error:error.message}));return true;
});
