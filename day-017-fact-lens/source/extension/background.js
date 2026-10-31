import {ChatGPTConnection} from './connection.js';
import {createChromeAuthService,isAllowedSender} from './vendor/chatgpt-auth/chrome.js';
import {setupStorage} from './auth.js';
import {prepareImageHeaders} from './image-headers.js';
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.action.onClicked.addListener(tab=>{if(tab.id)void chrome.storage.session.set({sourceTabId:tab.id});});
const auth=createChromeAuthService({connection:new ChatGPTConnection(),setupStorage});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!isAllowedSender(sender,['sidepanel.html','auth-result.html']))return;
  const actions={'auth.status':auth.status,'auth.login':auth.login,'auth.cancel':()=>auth.cancel(),'auth.logout':auth.logout,'auth.token':auth.token ,'images.prepare':()=>auth.run(()=>prepareImageHeaders())};
  if(!Object.hasOwn(actions,message?.type))return;
  actions[message.type]().then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;
});
