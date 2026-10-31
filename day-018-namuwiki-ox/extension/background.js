import {ChatGPTConnection} from './connection.js';
import {createChromeAuthService,isAllowedSender} from './vendor/chatgpt-auth/chrome.js';

chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.action.onClicked.addListener(tab=>{if(tab.id)void chrome.storage.session.set({sourceTabId:tab.id});});
const auth=createChromeAuthService({connection:new ChatGPTConnection(),onLogout:async()=>{const saved=await chrome.storage.session.get(null);await chrome.storage.session.remove(Object.keys(saved).filter(key=>key.startsWith('quiz-window-')));}});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!isAllowedSender(sender,['sidepanel.html','auth-result.html']))return;
  const actions={'auth.status':auth.status,'auth.login':auth.login,'auth.cancel':()=>auth.cancel(),'auth.logout':auth.logout,'auth.token':auth.token };
  if(!Object.hasOwn(actions,message?.type))return;
  actions[message.type]().then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;
});
chrome.windows.onRemoved.addListener(id=>{void chrome.storage.session.remove(`quiz-window-${id}`).catch(()=>{});});
