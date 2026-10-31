import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatGPTConnection,REFRESH_LIFETIME,RENEWAL_WINDOW} from '../extension/connection.js';

const session=()=>({accessToken:'SYNTHETIC_ACCESS',refreshToken:'SYNTHETIC_REFRESH',clientId:'oaiapp_test',expires:Date.now()+3600000,refreshExpires:Date.now()+REFRESH_LIFETIME,subject:'synthetic',name:'Test account',scopes:['chatgpt.tokens.use.direct']});
function setup(value=session()){
  const memory=value?{chatgptSession:value}:{},transient={},local={chatgptClientId:'oaiapp_test',hostId:'urn:uuid:test'};
  const store={async read(){return structuredClone(memory.chatgptSession || null);},async write(s){if(s)memory.chatgptSession=structuredClone(s);else delete memory.chatgptSession;}};
  const area=data=>({async setAccessLevel(o){assert.equal(o.accessLevel,'TRUSTED_CONTEXTS');},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]));},async set(values){Object.assign(data,structuredClone(values));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}});
  globalThis.chrome={storage:{session:area(transient),local:area(local)}};
  return {memory,transient,local,store,connection:new ChatGPTConnection({store})};
}
test('new owner restores durable session without login or plaintext tokens in Chrome storage',async()=>{
  const {connection,local,store,transient}=setup();assert.equal((await connection.status()).account.name,'Test account');assert.equal(await connection.accessToken(),'SYNTHETIC_ACCESS');
  assert.equal(await new ChatGPTConnection({store}).accessToken(),'SYNTHETIC_ACCESS');assert.ok(!JSON.stringify({local,transient}).includes('SYNTHETIC'));
});
test('simultaneous requests rotate once and next owner uses replacement',async()=>{
  const {connection,memory,store}=setup({...session(),expires:0});let calls=0;
  globalThis.fetch=async(_u,o)=>{calls++;assert.equal(o.body.get('refresh_token'),'SYNTHETIC_REFRESH');return Response.json({access_token:'NEW_ACCESS',refresh_token:'ROTATED',expires_in:3600});};
  assert.deepEqual(await Promise.all([connection.accessToken(),connection.accessToken(),connection.accessToken()]),['NEW_ACCESS','NEW_ACCESS','NEW_ACCESS']);assert.equal(calls,1);assert.equal(memory.chatgptSession.refreshToken,'ROTATED');assert.equal(await new ChatGPTConnection({store}).accessToken(),'NEW_ACCESS');
});
test('temporary network / 5xx / invalid client errors preserve session for retry',async()=>{
  for(const response of [()=>{throw Error('offline');},()=>Response.json({error:'server_error'},{status:503}),()=>Response.json({error:'invalid_client'},{status:400})]){
    const {connection,memory}=setup({...session(),expires:0});globalThis.fetch=async()=>response();await assert.rejects(connection.accessToken());assert.ok(memory.chatgptSession);assert.ok((await connection.status()).account);
  }
});
test('terminal refresh errors clear unusable session but retain registration',async()=>{
  for(const code of ['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']){
    const {connection,memory,local}=setup({...session(),expires:0});globalThis.fetch=async()=>Response.json({error:code},{status:400});await assert.rejects(connection.accessToken(),/다시 연결/);assert.equal(memory.chatgptSession,undefined);assert.equal((await connection.status()).account,null);assert.equal(local.chatgptClientId,'oaiapp_test');
  }
});
test('logout waits for rotation, revokes latest token, cannot resurrect session',async()=>{
  const {connection,memory,store}=setup({...session(),expires:0});let revoked;
  globalThis.fetch=async(u,o)=>{if(u.endsWith('/oauth/token'))return Response.json({access_token:'NEW',refresh_token:'ROTATED',expires_in:3600});if(u.includes('openid-configuration'))return Response.json({revocation_endpoint:'https://auth.openai.com/revoke'});revoked=o.body.get('token');return new Response('',{status:200});};
  const [token,logout]=await Promise.all([connection.accessToken(),connection.disconnect()]);assert.equal(token,'NEW');assert.equal(logout.revoked,true);assert.equal(revoked,'ROTATED');assert.equal(memory.chatgptSession,undefined);await assert.rejects(new ChatGPTConnection({store}).accessToken(),/먼저 연결/);
});
test('logout deletes durable session even when remote revocation fails',async()=>{
  const {connection,memory,store}=setup();globalThis.fetch=async()=>{throw Error('offline');};assert.deepEqual(await connection.disconnect(),{revoked:false});assert.equal(memory.chatgptSession,undefined);assert.equal((await new ChatGPTConnection({store}).status()).account,null);
});
test('pending login survives owner teardown, cancel removes PKCE, stale attempt expires',async()=>{
  const {connection,transient:memory,local,store}=setup(null);await connection.begin();assert.equal((await new ChatGPTConnection({store}).status()).pending,true);assert.ok(memory.chatgptAttempt.verifier);assert.ok(!JSON.stringify(local).includes(memory.chatgptAttempt.verifier));
  await connection.cancel();assert.equal(memory.chatgptAttempt,undefined);assert.equal((await new ChatGPTConnection({store}).status()).pending,false);
  memory.chatgptAttempt={expires:0};assert.equal((await new ChatGPTConnection({store}).status()).pending,false);assert.equal(memory.chatgptAttempt,undefined);
});
test('missing durable session yields signed-out state without discarding registration',async()=>{
  const {connection,local}=setup(null);assert.deepEqual(await connection.status(),{account:null,pending:false});assert.equal(local.chatgptClientId,'oaiapp_test');
});
test('temporary storage-open failure can recover without deleting saved session',async()=>{
  const {store,memory}=setup();let first=true;const connection=new ChatGPTConnection({store:{...store,async read(){if(first){first=false;throw Error('storage unavailable');}return store.read();}}});
  await assert.rejects(connection.status(),/storage unavailable/);assert.ok(memory.chatgptSession);assert.equal((await connection.status()).account.name,'Test account');
});
test('corrupt credentials clear with reconnect notice; stale RAM cannot revive logout',async()=>{
  const {store,memory,transient}=setup();const connection=new ChatGPTConnection({store:{...store,async read(){throw Object.assign(Error('reconnect'),{code:'credential_corrupt'});}}});
  transient.chatgptSession=session();assert.equal((await connection.status()).account,null);assert.equal(transient.chatgptSession,undefined);assert.equal(memory.chatgptSession,undefined);assert.equal(transient.oauthError,'reconnect');
});
test('rotation is not returned until saved and a failed save retries without rotating again',async()=>{
  const {store}=setup({...session(),expires:0});let calls=0,writes=0;
  const connection=new ChatGPTConnection({store:{...store,async write(s){if(++writes===1)throw Error('disk full');return store.write(s);}}});
  globalThis.fetch=async()=>{calls++;return Response.json({access_token:'NEW_ACCESS',refresh_token:'ROTATED',expires_in:3600});};
  await assert.rejects(connection.accessToken(),/disk full/);assert.equal(await connection.accessToken(),'NEW_ACCESS');assert.equal(calls,1);assert.equal((await store.read()).refreshToken,'ROTATED');
});
test('failed durable logout preserves the token for a truthful retry',async()=>{
  const {store,memory}=setup();let writes=0,revoked;
  const connection=new ChatGPTConnection({store:{...store,async write(s){if(++writes===1)throw Error('disk unavailable');return store.write(s);}}});
  globalThis.fetch=async(u,o)=>{if(u.includes('openid-configuration'))return Response.json({revocation_endpoint:'https://auth.openai.com/revoke'});revoked=o.body.get('token');return new Response('',{status:200});};
  await assert.rejects(connection.disconnect(),/disk unavailable/);assert.ok(memory.chatgptSession);assert.ok((await connection.status()).account);assert.equal((await connection.disconnect()).revoked,true);assert.equal(revoked,'SYNTHETIC_REFRESH');assert.equal(memory.chatgptSession,undefined);
});
test('background renewal exposes only timing and serializes with foreground requests',async()=>{
  const refreshExpires=Date.now()+RENEWAL_WINDOW-1000;
  const {connection,memory}=setup({...session(),expires:0,refreshExpires});let calls=0;
  assert.deepEqual(await connection.renewalState(),{expires:refreshExpires,refreshAt:refreshExpires-RENEWAL_WINDOW});
  globalThis.fetch=async()=>{calls++;return Response.json({access_token:'NEW',refresh_token:'ROTATED',expires_in:3600});};
  assert.deepEqual(await Promise.all([connection.renew(),connection.accessToken(),connection.renew()]),[true,'NEW',false]);
  assert.equal(calls,1);assert.equal(memory.chatgptSession.refreshToken,'ROTATED');assert.deepEqual(Object.keys(await connection.renewalState()).sort(),['expires','refreshAt']);
});
test('background renewal is inert after logout, without grant or without renewable credentials',async()=>{
  for(const value of [null,{...session(),refreshToken:undefined},{...session(),scopes:[]}]){
    const {connection}=setup(value);globalThis.fetch=async()=>{throw Error('must not fetch');};assert.equal(await connection.renewalState(),null);assert.equal(await connection.renew(),false);
  }
});
test('background stays quiet for 20 days despite expired access; rotates at 10 days remaining',async()=>{
  let now=2000000000000,calls=0;const issued=now,day=86400000;
  const {store}=setup({...session(),expires:issued+3600000,refreshExpires:issued+REFRESH_LIFETIME});
  const connection=new ChatGPTConnection({store,now:()=>now});
  globalThis.fetch=async()=>{calls++;return Response.json({access_token:'NEW',refresh_token:'ROTATED',expires_in:3600});};
  for(const age of [1,10,19,20-1/day]){now=issued+age*day;assert.equal(await connection.renew(),false);}
  assert.equal(calls,0);now=issued+20*day;assert.equal(await connection.renew(),true);assert.equal(calls,1);
  assert.equal((await store.read()).refreshExpires,now+30*day);assert.deepEqual(await connection.renewalState(),{expires:now+30*day,refreshAt:now+20*day});
});
test('user-requested inference refreshes expired access before background renewal is due',async()=>{
  const {connection,store}=setup({...session(),expires:0});let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({access_token:'ON_DEMAND',refresh_token:'ROTATED',expires_in:3600});};
  assert.equal(await connection.renew(),false);assert.equal(await connection.accessToken(),'ON_DEMAND');assert.equal(calls,1);
  assert.ok((await store.read()).refreshExpires>Date.now()+REFRESH_LIFETIME-1000);
});
test('30-day absence expires the connection without sending a refresh request',async()=>{
  const issued=2000000000000;let now=issued;
  const {store,memory,transient}=setup({...session(),expires:issued+3600000,refreshExpires:issued+REFRESH_LIFETIME});
  globalThis.fetch=async()=>{throw Error('must not refresh expired credentials');};
  now=issued+REFRESH_LIFETIME;
  const connection=new ChatGPTConnection({store,now:()=>now});assert.equal((await connection.status()).account,null);
  assert.equal(await connection.renew(),false);assert.equal(await connection.renewalState(),null);assert.equal(memory.chatgptSession,undefined);assert.match(transient.oauthError,/유효기간/);
  await assert.rejects(connection.accessToken(),/먼저 연결/);
});
test('legacy migration uses original access expiry and never resets lifetime on startup',async()=>{
  const issued=2000000000000;let now=issued+5*86400000;
  const legacy={...session(),expires:issued+3600000};delete legacy.refreshExpires;
  const {store}=setup(legacy);globalThis.fetch=async()=>{throw Error('migration must not fetch');};
  const connection=new ChatGPTConnection({store,now:()=>now});assert.equal((await connection.renewalState()).expires,issued+REFRESH_LIFETIME);
  now+=5*86400000;assert.equal((await new ChatGPTConnection({store,now:()=>now}).renewalState()).expires,issued+REFRESH_LIFETIME);
  assert.equal((await store.read()).refreshExpires,issued+REFRESH_LIFETIME);
});
test('missing or unchanged replacement token does not invent an extended refresh lifetime',async()=>{
  for(const nextRefresh of [undefined,'SYNTHETIC_REFRESH']){
    const refreshExpires=Date.now()+RENEWAL_WINDOW-1000,{connection,store}=setup({...session(),expires:0,refreshExpires});
    globalThis.fetch=async()=>Response.json({access_token:'NEW',refresh_token:nextRefresh,expires_in:3600});
    await connection.accessToken();assert.equal((await store.read()).refreshExpires,refreshExpires);
    await assert.rejects(connection.renew(),/교체를 확인/);
  }
});
