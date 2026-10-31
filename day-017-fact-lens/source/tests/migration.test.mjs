import test from 'node:test';
import assert from 'node:assert/strict';
import { setupStorage } from '../extension/auth.js';
import { REFRESH_LIFETIME } from '../extension/connection.js';
function fixture() {
 const local={registration:{clientId:'oaiapp_old',subject:'old-user'}},session={};let value=null;
 const area=data=>({async setAccessLevel(){},async get(keys){return Object.fromEntries(keys.filter(key=>key in data).map(key=>[key,structuredClone(data[key])]))},async set(values){Object.assign(data,structuredClone(values))},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key]}});
 globalThis.chrome={storage:{local:area(local),session:area(session)}};
 const store={async read(){return structuredClone(value)},async write(next){value=structuredClone(next)}};
 return {local,session,store};
}
const oldAccount=()=>({accessToken:'SYNTHETIC_ACCESS',refreshToken:'SYNTHETIC_REFRESH',clientId:'oaiapp_old',subject:'old-user',email:'test@example.test',expiresAt:Date.now()+3600000,scopes:['chatgpt.tokens.use.direct']});
test('0.1.0 session migrates to vault once, keeps original issuance and registration, clears plaintext',async()=>{
 const {local,session,store}=fixture();session.account=oldAccount();const expires=session.account.expiresAt;
 await setupStorage(store);assert.equal(session.account,undefined);assert.equal(local.chatgptClientId,'oaiapp_old');assert.equal(local.chatgptSubject,'old-user');
 const value=await store.read();assert.equal(value.refreshExpires,expires-3600000+REFRESH_LIFETIME);assert.equal(value.refreshToken,'SYNTHETIC_REFRESH');
 await setupStorage(store);assert.deepEqual(await store.read(),value);assert.ok(!JSON.stringify({local,session}).includes('SYNTHETIC'));
});
test('migration storage failure retains old session for retry; never overwrites a newer durable record',async()=>{
 const {session,store}=fixture();session.account=oldAccount();
 await assert.rejects(setupStorage({...store,async write(){throw Error('QA disk failure')}}));assert.ok(session.account);
 await store.write({newer:true});await setupStorage(store);assert.deepEqual(await store.read(),{newer:true});assert.equal(session.account,undefined);
});
test('pending 0.1.0 PKCE transaction migrates only within its original lifetime',async()=>{
 const {session,store}=fixture();session.pending={tabId:17,state:'qa-state',nonce:'qa-nonce',verifier:'qa-verifier',createdAt:Date.now()};
 await setupStorage(store);assert.equal(session.chatgptAttempt.redirectUri,'http://127.0.0.1:14557/auth/callback');assert.equal(session.chatgptAttempt.verifier,'qa-verifier');assert.equal(session.pending.expires,session.chatgptAttempt.expires);
 const other=fixture();other.session.pending={createdAt:0};await setupStorage(other.store);assert.equal(other.session.pending,undefined);assert.match(other.session.oauthError,/만료/);
});
test('malformed legacy credentials fail closed without leaking token text in notices',async()=>{
 const {session,store}=fixture();session.account={...oldAccount(),clientId:'invalid'};await setupStorage(store);assert.equal(session.account,undefined);assert.equal(await store.read(),null);assert.match(session.oauthError,/다시 연결/);assert.ok(!session.oauthError.includes('SYNTHETIC'));
});
