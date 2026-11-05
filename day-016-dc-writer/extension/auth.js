import {ChatGPTConnection as SharedConnection,makeAttempt as sharedAttempt} from './vendor/chatgpt-auth/connection.js';
import {credentialStore} from './credentials.js';
export {b64url,validateCallback,verifyIdToken,jsonRequest,REFRESH_LIFETIME,RENEWAL_WINDOW} from './vendor/chatgpt-auth/connection.js';
const appName="디시 글쓰기 도우미";
export const makeAttempt=(hostId,clientId)=>sharedAttempt(hostId,clientId,{appName});
export class ChatGPTConnection extends SharedConnection {
  constructor(options={}){super({appName,store:credentialStore,...options});}
}

// The panel delegates renewable credentials to the service worker.
export class PanelConnection {
  account=null;pending=false;
  async request(action){const r=await chrome.runtime.sendMessage({type:'oauth:session',action});if(!r?.ok)throw Error(r?.error || 'ChatGPT 연결 상태를 불러오지 못했습니다.');return r.value;}
  async restore(){const s=await this.request('status');this.account=s.account;this.pending=s.pending;return s;}
  begin(){return this.request('begin');}
  cancel(){return this.request('cancel');}
  disconnect(){return this.request('disconnect');}
  accessToken(){return this.request('token');}
}
