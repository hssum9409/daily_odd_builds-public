import {createCredentialStore} from './vendor/chatgpt-auth/credentials.js';
export {validSession} from './vendor/chatgpt-auth/credentials.js';
export const {credentialStore,sealSession,unsealSession}=createCredentialStore({
  databaseName:"gpichan-namuwiki-ox-credentials",
  encryptionContext:"gpichan-namuwiki-ox:credentials:v1"
});
