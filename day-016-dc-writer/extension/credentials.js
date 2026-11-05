import {createCredentialStore} from './vendor/chatgpt-auth/credentials.js';
export {validSession} from './vendor/chatgpt-auth/credentials.js';
export const {credentialStore,sealSession,unsealSession}=createCredentialStore({
  databaseName:"dc-writer-credentials",
  encryptionContext:"dc-writer:credentials:v1"
});
