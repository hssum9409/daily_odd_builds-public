import {ChatGPTConnection as CoreConnection,makeAttempt as attempt} from '../src/connection.js';
import {createCredentialStore} from '../src/credentials.js';
export * from '../src/connection.js';
export const {credentialStore,sealSession,unsealSession,validSession}=createCredentialStore({databaseName:'synthetic-auth-tests',encryptionContext:'synthetic-auth-tests:v1'});
export const makeAttempt=(hostId,clientId)=>attempt(hostId,clientId,{appName:'Synthetic test tool'});
export class ChatGPTConnection extends CoreConnection{constructor(options={}){super({appName:'Synthetic test tool',store:credentialStore,...options});}}
