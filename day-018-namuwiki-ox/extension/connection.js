import {ChatGPTConnection as SharedConnection,makeAttempt as sharedAttempt} from './vendor/chatgpt-auth/connection.js';
import {credentialStore} from './credentials.js';
export {b64url,validateCallback,verifyIdToken,jsonRequest,REFRESH_LIFETIME,RENEWAL_WINDOW} from './vendor/chatgpt-auth/connection.js';
const appName="나무위키 OX 퀴즈";
export const makeAttempt=(hostId,clientId)=>sharedAttempt(hostId,clientId,{appName});
export class ChatGPTConnection extends SharedConnection {
  constructor(options={}){super({appName,store:credentialStore,...options});}
}
