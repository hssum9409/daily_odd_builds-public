import {createCredentialStore} from './vendor/chatgpt-auth/credentials.js';
export {validSession} from './vendor/chatgpt-auth/credentials.js';
export const {credentialStore,sealSession,unsealSession}=createCredentialStore({
  databaseName:"fact-lens-credentials",
  encryptionContext:"fact-lens:credentials:v1"
});
