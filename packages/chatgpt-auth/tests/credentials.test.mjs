import test from 'node:test';
import assert from 'node:assert/strict';
import {sealSession,unsealSession} from './fixture.mjs';
const session={accessToken:'SYNTHETIC_ACCESS_SECRET',refreshToken:'SYNTHETIC_REFRESH_SECRET',clientId:'oaiapp_test',expires:1234,refreshExpires:2592000000,subject:'synthetic-user',name:'Synthetic user',scopes:['chatgpt.tokens.use.direct']};
test('encrypted record round-trips through structured clone with non-exportable key',async()=>{
  const record=await sealSession(session);assert.equal(record.key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',record.key));
  assert.deepEqual(await unsealSession(structuredClone(record)),session);assert.ok(!new TextDecoder().decode(record.ciphertext).includes('SYNTHETIC'));assert.deepEqual(Object.keys(record).sort(),['ciphertext','iv','key','version']);
});
test('each save uses independent key and IV, excludes unapproved fields',async()=>{
  const a=await sealSession({...session,idToken:'SHOULD_NOT_PERSIST',verifier:'SHOULD_NOT_PERSIST'}),b=await sealSession(session);
  assert.notDeepEqual(a.iv,b.iv);assert.notDeepEqual(a.ciphertext,b.ciphertext);assert.deepEqual(await unsealSession(a),session);
});
test('ciphertext/key/schema corruption fails closed with no secrets in error',async()=>{
  const a=await sealSession(session),b=await sealSession(session),changed=structuredClone(a);new Uint8Array(changed.ciphertext)[0]^=1;
  for(const record of [changed,{...a,key:b.key},{...a,version:2},{...a,iv:new Uint8Array(1)},{...a,key:null}])await assert.rejects(unsealSession(record),e=>e.code==='credential_corrupt'&&!e.message.includes('SYNTHETIC'));
  await assert.rejects(sealSession({...session,clientId:'wrong'}),/올바르지/);
  await assert.rejects(sealSession({...session,refreshExpires:Infinity}),/올바르지/);
});
test('legacy records without refresh expiry remain readable for migration',async()=>{
  const legacy={...session};delete legacy.refreshExpires;assert.deepEqual(await unsealSession(await sealSession(legacy)),legacy);
});
