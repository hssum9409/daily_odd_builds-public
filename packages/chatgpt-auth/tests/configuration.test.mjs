import test from 'node:test';
import assert from 'node:assert/strict';
import {createCredentialStore} from '../src/credentials.js';
import {ChatGPTConnection,makeAttempt} from '../src/connection.js';
import {isAllowedSender} from '../src/chrome.js';

test('apps explicitly supply name and isolated credential namespace',async()=>{
  assert.throws(()=>createCredentialStore(),/required/);
  assert.throws(()=>new ChatGPTConnection(),/required/);
  const attempt=await makeAttempt('host-test',null,{appName:'Sample extension'});
  assert.equal(new URL(attempt.url).searchParams.get('agent_name_hint'),'Sample extension');
  const reconnect=await makeAttempt('host-test','oaiapp_existing',{appName:'Sample extension'});
  assert.equal(new URL(reconnect.url).searchParams.get('client_id'),'oaiapp_existing');
  assert.equal(new URL(reconnect.url).searchParams.has('agent_name_hint'),false);
});
test('the existing v1 encrypted record is readable only with its original app AAD',async()=>{
  const session={accessToken:'synthetic',clientId:'oaiapp_qa',subject:'qa',name:'QA',expires:1234,scopes:[]};
  // Produce the pre-extraction format directly, without calling the new sealer.
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  for(const namespace of ['fact-lens','gpichan-namuwiki-ox','dc-writer']){
    const encryptionContext=namespace+':credentials:v1';
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(encryptionContext)},key,new TextEncoder().encode(JSON.stringify(session)));
    const record=structuredClone({version:1,key,iv,ciphertext});
    const own=createCredentialStore({databaseName:namespace+'-credentials',encryptionContext});
    assert.deepEqual(await own.unsealSession(record),session);
    await assert.rejects(createCredentialStore({databaseName:'other-credentials',encryptionContext:'other:credentials:v1'}).unsealSession(record),e=>e.code==='credential_corrupt');
  }
});
test('only exact allowed extension page senders can request credentials',()=>{
  const previous=globalThis.chrome;
  try{
    globalThis.chrome={runtime:{id:'qa',getURL:path=>'chrome-extension://qa/'+path}};
    assert.equal(isAllowedSender({id:'qa',url:'chrome-extension://qa/panel.html'},['panel.html']),true);
    for(const sender of [{id:'other',url:'chrome-extension://qa/panel.html'},{id:'qa',url:'https://example.test/panel.html'},{id:'qa',url:'chrome-extension://qa/panel.html?fake=1'},{id:'qa',url:'chrome-extension://qa/content.js'}])assert.equal(isAllowedSender(sender,['panel.html']),false);
  }finally{globalThis.chrome=previous;}
});
